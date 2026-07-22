export const browser: typeof chrome = (globalThis as { browser?: typeof chrome }).browser ?? globalThis.chrome
