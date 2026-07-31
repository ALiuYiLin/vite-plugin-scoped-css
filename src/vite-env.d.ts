/// <reference types="vite/client" />

declare module 'virtual:scoped-css' {
  export function useScoped(styles: string): void;
}

// CSS default-import returns the hash string (used by scoped plugin)
declare module '*.css' {
  const css: string;
  export default css;
}

declare module '*.css?scoped' {
  const hash: string;
  export default hash;
}
