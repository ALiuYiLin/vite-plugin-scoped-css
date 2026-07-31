/// <reference types="vite/client" />
/// <reference types="vite-plugin-scoped-css/dist/types" />

// Vite 8 declares *.css as empty — fill in the default export
declare module '*.css' {
  const css: string;
  export default css;
}
