// Main entry — vite.config.ts imports the plugin factory here
declare module 'vite-plugin-scoped-css' {
  export function useScoped(styles: string): void;
  const plugin: (options?: Record<string, never>) => import('vite').Plugin[];
  export default plugin;
}

// Runtime entry — app code imports useScoped from here (zero Babel deps)
declare module 'vite-plugin-scoped-css/runtime' {
  export function useScoped(styles: string): void;
}

// Virtual module — backward compat
declare module 'virtual:scoped-css' {
  export function useScoped(styles: string): void;
}

// CSS query module — `import styles from './style.css?scoped'` resolves to hash string
declare module '*.css?scoped' {
  const hash: string;
  export default hash;
}
