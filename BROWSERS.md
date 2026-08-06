# Browsers

Chrome and Firefox ship from the same sources. `manifest.config.ts` generates a manifest per target
and `vite.config.ts` writes each build into its own directory. Neither browser is the default: every
build names its target, so there is no bare `pnpm build`.

```bash
pnpm build:chrome         # production build into dist-chrome/
pnpm dev:chrome           # watch build into dist-chrome/

pnpm build:firefox        # production build into dist-firefox/
pnpm dev:firefox          # watch build into dist-firefox/
```

Load the Chrome build through `chrome://extensions` → "Load unpacked" → pick `dist-chrome/`. Load
the Firefox one through `about:debugging#/runtime/this-firefox` → "Load Temporary Add-on" → pick
`dist-firefox/manifest.json`. Temporary add-ons are removed when Firefox closes.

Validate the Firefox bundle the way [addons.mozilla.org](https://addons.mozilla.org/developers/)
(AMO, Mozilla's add-on store) will. CI runs this on every build, and it is worth running by hand
after touching the manifest:

```bash
pnpm dlx web-ext@10 lint --source-dir dist-firefox --self-hosted
```

Two warnings are expected and harmless, so they do not fail the run: `UNSAFE_VAR_ASSIGNMENT` (Vue's
runtime assigns `innerHTML`) and `KEY_FIREFOX_ANDROID_UNSUPPORTED_BY_MIN_VERSION` (Firefox for
Android has no DevTools, so the panel is desktop-only regardless). Anything the validator counts as
an error does fail it.

## Where the targets differ

Chrome is the browser the code was written against, so every entry below is a Firefox constraint the
Chrome build inherits.

- **No service worker.** Firefox has no MV3 `background.service_worker` ([bug 1573659](https://bugzil.la/1573659)),
  so its manifest points `background.scripts` at the same `background.js`, which runs as an event
  page. It is bundled dependency-free for Chrome already, which is what makes that possible. Event
  pages are suspended when idle just like the worker, so nothing may assume in-memory state
  survives.
- **No DNR enum objects.** Chrome exposes `declarativeNetRequest.ResourceType`, `RuleActionType` and
  `HeaderOperation` as runtime enums; Firefox does not. `src/background/tabRules.ts` uses the wire
  strings both accept, because reading a missing enum member would throw inside the `try` and
  silently leave the tab header rule uninstalled.
- **Host permissions are revocable.** Firefox prompts for `<all_urls>` at install, but the user can
  turn access off per site at any time, which kills content scripts, `webRequest` and the DNR rule in
  one go. `src/panel/lib/useHostAccess.ts` detects that and the panel shows a banner instead of
  looking like an app without a recorder.
- **The DevTools page is resolved relatively.** Firefox resolves the panel path against the
  DevTools page's own URL rather than the extension root, and rejects an extension-absolute URL
  outright, so `devtools.html` sits at the root of the build to keep one relative path correct in
  both browsers. The panel icon stays empty: Chrome renders the title alone and Firefox falls back to
  the manifest icon.
- **Panel theme follows the OS, not DevTools.** The panel styles off `prefers-color-scheme`, and
  Firefox does not map its DevTools theme onto it, so a dark DevTools on a light desktop shows a
  light panel. The theme toggle in the panel header overrides it.
- **`world: "MAIN"` sets the version floor.** Firefox honours it from 128. Its manifest asks for 140
  because that is where `data_collection_permissions` is understood. Chrome's floor is 116, where MV3
  service workers and DNR session rules landed.

## Automated coverage

Chrome carries the e2e suite. Firefox gets one smoke test, `tests/e2e/firefox/smoke.firefox.spec.ts`,
run as the `firefox` Playwright project: it installs `dist-firefox/`, drives a visit in the app and
asserts the visit is recorded and rendered as a timeline row.

It cannot share the Chrome fixtures, because Playwright loads extensions in Chromium only. Instead it
talks Firefox's Remote Debugging Protocol (`tests/e2e/firefox/rdp.ts`, ~150 lines, the same channel
`web-ext` uses) to install a temporary add-on, to read background state where Chrome uses
`serviceWorker.evaluate`, and to read the panel's DOM. That last one is not a shortcut: Playwright
never attaches to a privileged `moz-extension://` page, not even one the extension opens itself, so
the panel is opened by the extension and inspected over RDP. The `moz-extension` origin is made
predictable by seeding `extensions.webextensions.uuids` in the profile, since Firefox otherwise
assigns a fresh uuid per install.

Everything past "does it record and render" stays manual, so run the checklist below before a
release.

## Manual smoke checklist

Run `pnpm build:firefox`, load the add-on, start the e2e app
(`tests/e2e/app`: `php artisan serve --port=13337` plus its own `pnpm dev` on `:4242`) or any Inertia
app in dev mode, then walk through:

1. **Recording.** Open DevTools → Inertia tab, navigate the app. Entries appear with status, method,
   component and duration. This alone proves `webRequest.onHeadersReceived` sees the
   `x-inertia-devtools-id` header and that the background fetch to
   `{origin}/_inertia/devtools/entries/{id}` returns with credentials over plain HTTP.
2. **Tab header.** Reload once (the first response of a newly proven host is unstamped), then check
   the app receives `x-inertia-devtools-tab` on later requests. This is the DNR session rule; if the
   header never arrives the rule was rejected.
3. **Props and page state.** Props tab shows values with prop-type metadata, Page tab shows the
   client page object. Proves the MAIN-world script, the postMessage bridge and pairing.
4. **Lineage and batching.** Trigger a partial reload, a deferred prop and a prefetch-then-visit.
   Rows group into batches and the prefetch is marked consumed. Proves the interceptor registry is
   reachable from the MAIN world.
5. **Dev-mode banner.** Point at a production build of an app and confirm the "not running in dev
   mode" banner appears rather than an empty panel.
6. **Host access banner.** Extensions button → turn off access for the site → the panel shows the
   "no access to this site" banner. Turn it back on and it disappears without reopening DevTools.
7. **Suspension.** Leave DevTools open and idle for a few minutes, then navigate again: new entries
   still arrive after the event page has been suspended and restarted.

## Store submission

The Release workflow attaches both zips to the GitHub release:
`inertia-devtools-extension-chrome-<version>.zip` goes to the
[Chrome Web Store](https://chrome.google.com/webstore/devconsole) and
`inertia-devtools-extension-firefox-<version>.zip` to AMO. Both are uploaded by hand.

AMO needs two things Chrome does not:

- The bundle is minified, so a source-code archive plus build instructions go with the submission:
  Node 24, pnpm 11, `pnpm install --frozen-lockfile && pnpm build:firefox`, output in
  `dist-firefox/`.
- `browser_specific_settings.gecko.data_collection_permissions` declares `none`. Keep it accurate:
  everything the panel shows is fetched from the inspected app and stays on the machine.

The Gecko extension id and the version floor live in `manifest.config.ts` and must not change once
listed.
