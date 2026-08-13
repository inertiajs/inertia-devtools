export const browser: typeof chrome = (globalThis as { browser?: typeof chrome }).browser ?? globalThis.chrome

/**
 * Whether this browser strands the tab an app-scheme link (`vscode:`, `phpstorm:`) opens.
 *
 * Chrome hands the url to the OS handler and discards that tab. Firefox keeps it, blank, with
 * no handle for the panel to close it by. `src/panel/lib/appScheme.ts` is the only reader.
 */
export const STRANDS_APP_SCHEME_TABS = 'browser' in globalThis
