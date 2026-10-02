// Augment the global for the dev handle and the page-level probes.
declare global {
  interface Window {
    __game?: { store: import("../src/core/store").GameStore; navigate: (s: string) => void };
    __name?: (f: unknown) => unknown;
    __lvBefore?: number;
    __t0?: number;
  }
}
export {};