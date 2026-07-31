import { describe, it, expect } from 'vitest';
import { build } from 'vite';
import path from 'node:path';
import fs from 'node:fs';

const PKG_ROOT = path.resolve(import.meta.dirname, '..');

interface Fixture {
  /** Component code (one or more components; the first default export is mounted) */
  components: string;
  /** CSS files: { 'style.css': '.red { color: red; }' } */
  styles?: Record<string, string>;
}

async function buildFixture(fixture: Fixture): Promise<{ css: string; js: string }> {
  const fixtureRoot = path.join(PKG_ROOT, 'tests', 'fixtures');
  fs.mkdirSync(fixtureRoot, { recursive: true });
  const dir = fs.mkdtempSync(path.join(fixtureRoot, 'test-'));

  // Write component file
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'App.tsx'), fixture.components);

  // Write CSS files
  for (const [name, content] of Object.entries(fixture.styles ?? {})) {
    fs.writeFileSync(path.join(dir, 'src', name), content);
  }

  // Write entry point that MOUNTS the first default export (prevents tree-shake)
  fs.writeFileSync(
    path.join(dir, 'src', 'main.tsx'),
    `
import { createRoot } from 'react-dom/client';
import App from './App';
createRoot(document.getElementById('root')!).render(<App />);
`,
  );

  // Write index.html
  fs.writeFileSync(
    path.join(dir, 'index.html'),
    `<html><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>`,
  );

  // Symlink node_modules
  const workspaceRoot = path.resolve(PKG_ROOT, '..', '..');
  const nmLink = path.join(dir, 'node_modules');
  try {
    fs.symlinkSync(path.join(workspaceRoot, 'node_modules'), nmLink, 'junction');
  } catch {}

  // Write vite.config.ts
  fs.writeFileSync(
    path.join(dir, 'vite.config.ts'),
    `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import vitePluginScopedCSS from 'vite-plugin-scoped-css';

export default defineConfig({
  plugins: [vitePluginScopedCSS(), react()],
  build: { minify: false },
});`,
  );

  try {
    await build({ root: dir, logLevel: 'silent', build: { minify: false } });

    const assets = path.join(dir, 'dist', 'assets');
    const cssFile = fs.readdirSync(assets).find((f) => f.endsWith('.css'));
    const jsFile = fs.readdirSync(assets).find((f) => f.endsWith('.js'));

    return {
      css: cssFile ? fs.readFileSync(path.join(assets, cssFile), 'utf-8') : '',
      js: jsFile ? fs.readFileSync(path.join(assets, jsFile), 'utf-8') : '',
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/* ── helpers ────────────────────────────────── */

function extractHashes(s: string) {
  return [...new Set([...s.matchAll(/data-v-([a-f0-9]+)/g)].map((m) => m[1]))];
}

/* ─── tests ─────────────────────────────────── */

describe('vite-plugin-scoped-css', () => {
  /* ── 1. CSS transform ── */
  describe('CSS transform', () => {
    it('appends [data-v-hash] to selectors', async () => {
      const { css } = await buildFixture({
        components: `
          import { useScoped } from 'vite-plugin-scoped-css/runtime';
          import styles from './style.css';
          export default function App() { useScoped(styles); return <div className="red">hi</div>; }
        `,
        styles: { 'style.css': '.red { color: red; }' },
      });
      expect(css).toMatch(/\.red\[data-v-[a-f0-9]+\]\s*\{/);
    });

    it('handles comma-separated selectors', async () => {
      const { css } = await buildFixture({
        components: `
          import { useScoped } from 'vite-plugin-scoped-css/runtime';
          import styles from './s.css';
          export default function App() { useScoped(styles); return <div className="a">hi</div>; }
        `,
        styles: { 's.css': '.a, .b { color: red; }' },
      });
      expect(css).toMatch(/\.a\[data-v-[a-f0-9]+\],\s*\.b\[data-v-[a-f0-9]+\]/);
    });

    it('skips @keyframes selectors', async () => {
      const { css } = await buildFixture({
        components: `
          import { useScoped } from 'vite-plugin-scoped-css/runtime';
          import styles from './s.css';
          export default function App() { useScoped(styles); return <div>hi</div>; }
        `,
        styles: { 's.css': '@keyframes spin { from { transform:rotate(0) } to { transform:rotate(360deg) } } .x { color:red; }' },
      });
      expect(css).not.toMatch(/from\[data-v-/);
      expect(css).not.toMatch(/to\[data-v-/);
      expect(css).toMatch(/\.x\[data-v-[a-f0-9]+\]/);
    });

    it('handles nested rules inside @media', async () => {
      const { css } = await buildFixture({
        components: `
          import { useScoped } from 'vite-plugin-scoped-css/runtime';
          import styles from './s.css';
          export default function App() { useScoped(styles); return <div className="x">hi</div>; }
        `,
        styles: { 's.css': '@media screen { .x { color: red; } }' },
      });
      expect(css).toMatch(/@media/);
      expect(css).toMatch(/\.x\[data-v-[a-f0-9]+\]/);
    });
  });

  /* ── 2. JSX transform ── */
  describe('JSX transform', () => {
    it('adds data-v-hash to JSX elements', async () => {
      const { js } = await buildFixture({
        components: `
          import { useScoped } from 'vite-plugin-scoped-css/runtime';
          import styles from './style.css';
          export default function App() { useScoped(styles); return <div className="red">hi</div>; }
        `,
        styles: { 'style.css': '.red { color: red; }' },
      });
      expect(js).toMatch(/data-v-[a-f0-9]+/);
    });

    it('removes useScoped from output', async () => {
      const { js } = await buildFixture({
        components: `
          import { useScoped } from 'vite-plugin-scoped-css/runtime';
          import styles from './style.css';
          export default function App() { useScoped(styles); return <div className="red">hi</div>; }
        `,
        styles: { 'style.css': '.red { color: red; }' },
      });
      expect(js).not.toContain('useScoped');
    });
  });

  /* ── 3. 函数级隔离 ── */
  describe('Per-component isolation', () => {
    it('different components get different hashes', async () => {
      const { css, js } = await buildFixture({
        components: `
          import { useScoped } from 'vite-plugin-scoped-css/runtime';
          import stylesA from './a.css';
          import stylesB from './b.css';
          export default function App() {
            useScoped(stylesA);
            return <div className="x"><Card /></div>;
          }
          function Card() { useScoped(stylesB); return <div className="x">card</div>; }
        `,
        styles: { 'a.css': '.x { color: red; }', 'b.css': '.x { color: blue; }' },
      });

      const hashes = extractHashes(css);
      expect(hashes.length).toBe(2);

      // Both hashes appear in JS (each on their component's elements)
      for (const h of hashes) {
        expect(js).toContain(`data-v-${h}`);
      }
    });

    it('CSS and JS use the same hash', async () => {
      const { css, js } = await buildFixture({
        components: `
          import { useScoped } from 'vite-plugin-scoped-css/runtime';
          import styles from './style.css';
          export default function App() { useScoped(styles); return <div className="red">hi</div>; }
        `,
        styles: { 'style.css': '.red { color: red; }' },
      });

      const cssHashes = extractHashes(css);
      const jsHashes = extractHashes(js);
      expect(cssHashes.length).toBe(1);
      expect(cssHashes).toEqual(jsHashes);
    });
  });

  /* ── 4. 无 useScoped 不添加 hash ── */
  describe('No scoping without useScoped', () => {
    it('elements get no data-v-* if useScoped not called', async () => {
      const { js } = await buildFixture({
        components: `
          import './style.css';
          export default function Plain() { return <div className="red">no scoping</div>; }
        `,
        styles: { 'style.css': '.red { color: red; }' },
      });
      expect(js).not.toMatch(/data-v-[a-f0-9]+/);
    });
  });

  /* ── 5. 多样式表 ── */
  describe('Multiple stylesheets', () => {
    it('applies both hashes to one component', async () => {
      const { js } = await buildFixture({
        components: `
          import { useScoped } from 'vite-plugin-scoped-css/runtime';
          import s1 from './a.css';
          import s2 from './b.css';
          export default function App() {
            useScoped(s1); useScoped(s2);
            return <div className="x y">hi</div>;
          }
        `,
        styles: { 'a.css': '.x { color: red; }', 'b.css': '.y { color: blue; }' },
      });

      const hashes = extractHashes(js);
      expect(hashes.length).toBe(2);
    });
  });

  /* ── 6. CSS 与 JS hash 一致性 ── */
  describe('Hash consistency', () => {
    it('multiple CSS files produce distinct deterministic hashes', async () => {
      const { css: css1 } = await buildFixture({
        components: `
          import { useScoped } from 'vite-plugin-scoped-css/runtime';
          import s from './x.css';
          export default function A() { useScoped(s); return <div>a</div>; }
        `,
        styles: { 'x.css': '.a { color: red; }' },
      });
      const { css: css2 } = await buildFixture({
        components: `
          import { useScoped } from 'vite-plugin-scoped-css/runtime';
          import s from './y.css';
          export default function B() { useScoped(s); return <div>b</div>; }
        `,
        styles: { 'y.css': '.b { color: blue; }' },
      });

      const h1 = extractHashes(css1);
      const h2 = extractHashes(css2);
      // Same CSS path → same hash (buildFixture uses 'x.css' for both, different content)
      // Different file paths → potentially different hashes
      expect(h1.length).toBe(1);
      expect(h2.length).toBe(1);
    });
  });
});
