/**
 * Compile-time marker — tells the Vite plugin to activate scoped CSS
 * for this component. This call and its import are removed during build
 * (zero runtime cost).
 */
export function useScoped(_styles: string): void {}
