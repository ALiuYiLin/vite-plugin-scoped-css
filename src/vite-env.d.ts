/// <reference types="vite/client" />

// Vite 8 declares '*.css' as an empty module — fill in the default export
declare module '*.css' {
  const css: string;
  export default css;
}

declare module '*.css?scoped' {
  const hash: string;
  export default hash;
}
