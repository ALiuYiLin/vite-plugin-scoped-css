import type { Plugin } from 'vite';
import * as parser from '@babel/parser';
import _traverse from '@babel/traverse';
import _generate from '@babel/generator';
import * as t from '@babel/types';
import path from 'node:path';
import crypto from 'node:crypto';

// Babel 8 uses ESM-style .default in CommonJS
const traverse = (_traverse as any).default || _traverse;
const generate = (_generate as any).default || _generate;

/* ─── hash ─────────────────────────────────── */

function getHash(absPath: string): string {
  return crypto.createHash('md5').update(absPath).digest('hex').slice(0, 8);
}

/* ─── CSS transform ────────────────────────── */

function transformScopedCSS(css: string, hash: string): string {
  const attr = `[data-v-${hash}]`;
  const result: string[] = [];
  let i = 0;

  while (i < css.length) {
    const braceIdx = css.indexOf('{', i);
    if (braceIdx === -1) {
      result.push(css.slice(i));
      break;
    }

    const beforeBrace = css.slice(i, braceIdx);
    const trimmed = beforeBrace.trim();

    // Skip @keyframes / @font-face / @import / @charset / @namespace
    if (/@(keyframes|font-face|import|charset|namespace)/i.test(trimmed)) {
      const end = findMatchingBrace(css, braceIdx);
      result.push(css.slice(i, end + 1));
      i = end + 1;
      continue;
    }

    const closeIdx = findMatchingBrace(css, braceIdx);
    const body = css.slice(braceIdx, closeIdx + 1);
    const transformedSelector = transformSelector(beforeBrace, attr);

    result.push(transformedSelector + body);
    i = closeIdx + 1;
  }

  return result.join('');
}

function findMatchingBrace(css: string, openIdx: number): number {
  let depth = 0;
  for (let i = openIdx; i < css.length; i++) {
    if (css[i] === '{') depth++;
    if (css[i] === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return css.length - 1;
}

function transformSelector(selectorText: string, attr: string): string {
  const trimmed = selectorText.trim();

  // Don't modify at-rule preludes
  if (/^@/.test(trimmed)) return selectorText;

  // Don't modify keyframe selectors
  if (/^(from|to|\d+%)\s*$/i.test(trimmed)) return selectorText;

  // Split by comma
  const parts = selectorText.split(',');
  const transformed = parts.map((part) => {
    const p = part.trim();
    if (!p) return part;
    if (/^@/.test(p) || /^(from|to|\d+%)\s*$/i.test(p)) return part;
    if (/^:(root|host)/i.test(p)) return part;

    const leading = part.match(/^\s*/)?.[0] ?? '';
    const trailing = part.match(/\s*$/)?.[0] ?? '';
    return leading + p + attr + trailing;
  });

  return transformed.join(',');
}

/* ─── JSX / Babel transform ────────────────── */

function scopedBabelPlugin(
  _filename: string,
  resolveImportPath: (importSource: string) => string,
) {
  // Map: enclosing function node → hashes belonging to that function
  const fnHashes = new Map<any, string[]>();

  return function babelPlugin() {
    return {
      visitor: {
        Program(programPath: any) {
          // --- Pass 1: detect useScoped calls, associate with enclosing function ---
          programPath.traverse({
            ImportDeclaration(impPath: any) {
              const source: string = impPath.node.source.value;

              // Handle useScoped import sources → remove once calls are stripped
              if (
                source === 'virtual:scoped-css' ||
                source === 'vite-plugin-scoped-css' ||
                source === 'vite-plugin-scoped-css/runtime'
              ) {
                impPath.node.specifiers = impPath.node.specifiers.filter(
                  (spec: any) => {
                    const binding = impPath.scope.getBinding(
                      spec.local?.name ?? spec.exported?.name,
                    );
                    if (!binding) return true;
                    const refCount = (binding.referencePaths || []).length;
                    return refCount > 0;
                  },
                );
                if (impPath.node.specifiers.length === 0) {
                  impPath.remove();
                }
                return;
              }

              // Only process CSS imports
              if (!source.endsWith('.css')) return;
              if (source.includes('?scoped')) return;

              const specifiers = impPath.node.specifiers;
              if (specifiers.length === 0) return;

              for (const spec of specifiers) {
                const binding = impPath.scope.getBinding(
                  spec.local?.name ?? spec.exported?.name,
                );
                if (!binding) continue;

                let usedByUseScoped = false;
                const refsToRemove: any[] = [];
                let enclosingFn: any = null;

                for (const ref of binding.referencePaths || []) {
                  const callExpr = ref.parentPath;
                  if (
                    callExpr.isCallExpression?.() &&
                    callExpr.node.callee?.name === 'useScoped'
                  ) {
                    usedByUseScoped = true;
                    // Find the enclosing function for this useScoped call
                    enclosingFn = callExpr.getFunctionParent();
                    // Remove useScoped(x) expression statement
                    const stmt = callExpr.findParent(
                      (p: any) =>
                        (p.isExpressionStatement?.() || p.isStatement?.()) ??
                        false,
                    );
                    if (stmt) {
                      refsToRemove.push(stmt);
                    }
                  }
                }

                if (usedByUseScoped) {
                  const absPath = resolveImportPath(source);
                  const hash = getHash(absPath);

                  // Associate hash with the enclosing function
                  if (enclosingFn) {
                    const list = fnHashes.get(enclosingFn.node) ?? [];
                    list.push(hash);
                    fnHashes.set(enclosingFn.node, list);
                  }

                  // Rewrite import source to include ?scoped
                  impPath.node.source.value = source + '?scoped';
                  impPath.node.source.extra = undefined;

                  // Remove the used specifier (styles), keep others
                  const filtered = impPath.node.specifiers.filter(
                    (s: any) => s !== spec,
                  );
                  impPath.node.specifiers = filtered;

                  if (filtered.length === 0) {
                    impPath.node.importKind = 'value';
                  }

                  // Remove useScoped() call statements
                  for (const ref of refsToRemove) {
                    ref.remove();
                  }
                }
              }
            },
          });

          if (fnHashes.size === 0) return;

          // --- Pass 2: add data-v-hash per enclosing function ---
          programPath.traverse({
            JSXElement(jsxPath: any) {
              if (
                jsxPath.node.openingElement.name?.type === 'JSXFragment'
              )
                return;

              // Find which function encloses this JSX element
              const enclosingFn = jsxPath.getFunctionParent();
              if (!enclosingFn) return;

              const hashes = fnHashes.get(enclosingFn.node);
              if (!hashes || hashes.length === 0) return;

              const dataAttrs = hashes.map((h: string) => `data-v-${h}`);
              const opening = jsxPath.node.openingElement;
              const attrs: any[] = opening.attributes || [];

              for (const attrName of dataAttrs) {
                const already = attrs.some(
                  (a: any) =>
                    a.type === 'JSXAttribute' && a.name?.name === attrName,
                );
                if (!already) {
                  opening.attributes.push(
                    t.jsxAttribute(
                      t.jsxIdentifier(attrName),
                      t.stringLiteral(''),
                    ),
                  );
                }
              }
            },
          });
        },
      },
    };
  };
}

/* ─── Runtime re-export ──────────────────── */

export { useScoped } from './runtime.js';

/* ─── Plugin export ────────────────────────── */

export default function vitePluginScopedCSS(): Plugin[] {
  const hashCache = new Map<string, string>();

  function resolveCssPath(importSource: string, importer: string): string {
    const dir = path.dirname(importer);
    const resolved = path.resolve(dir, importSource);
    // Normalize to forward slashes (Vite convention on all platforms)
    return resolved.split('?')[0].replace(/\\/g, '/');
  }

  /* ── Plugin A: Virtual module ─── */
  const virtualPlugin: Plugin = {
    name: 'scoped-css:virtual',
    resolveId(id) {
      if (id === 'virtual:scoped-css') return '\0virtual:scoped-css';
      return null;
    },
    load(id) {
      if (id === '\0virtual:scoped-css') {
        return `
          export function useScoped(_styles) {
            // compile-time marker — removed during build
          }
        `;
      }
      return null;
    },
  };

  /* ── Plugin B: CSS transform ─── */
  const cssPlugin: Plugin = {
    name: 'scoped-css:css',
    enforce: 'pre',
    applyToEnvironment() {
      // Apply to all environments (browser build, SSR, etc.)
      return true;
    },
    async transform(code, id) {
      if (!id.includes('.css')) return null;
      if (!id.includes('?scoped')) return null;

      const cleanPath = id.split('?')[0].replace(/\\/g, '/');
      const hash = hashCache.get(cleanPath) ?? getHash(cleanPath);
      hashCache.set(cleanPath, hash);

      const transformed = transformScopedCSS(code, hash);

      return {
        code: transformed,
        map: null,
      };
    },
  };

  /* ── Plugin C: JSX / TSX transform ─── */
  const jsxPlugin: Plugin = {
    name: 'scoped-css:jsx',
    enforce: 'pre',
    async transform(code, id) {
      if (!/\.(tsx|jsx)$/.test(id)) return null;
      if (id.includes('node_modules')) return null;

      // Quick skip
      if (!code.includes('useScoped')) return null;
      if (!code.includes('.css')) return null;

      let ast: any;
      try {
        ast = parser.parse(code, {
          sourceType: 'module',
          plugins: ['typescript', 'jsx'],
          sourceFilename: id,
        });
      } catch {
        return null;
      }

      const babelPluginFn = scopedBabelPlugin(id, (importSource: string) =>
        resolveCssPath(importSource, id),
      );

      const pluginResult = babelPluginFn();
      const visitor = pluginResult.visitor;

      traverse(ast, {
        Program(path: any) {
          visitor.Program(path);
        },
      });

      const output = generate(ast, {}, code);

      const hasChanged =
        output.code.includes('?scoped') || output.code.includes('data-v-');

      if (!hasChanged) return null;

      return {
        code: output.code,
        map: null,
      };
    },
  };

  return [virtualPlugin, cssPlugin, jsxPlugin];
}
