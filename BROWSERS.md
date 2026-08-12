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

One suite covers both browsers. The specs in `tests/e2e/shared` never name a browser: the Playwright
project name picks a driver, so the same test runs twice. Specs that need a browser-only capability
live under `tests/e2e/firefox`, and the project config includes those only in Firefox, so `shared/`
stays honest about running in both browsers.

```bash
pnpm test:e2e                      # both browser projects
pnpm test:e2e:chrome               # Chrome only
pnpm test:e2e:firefox              # Firefox only
```

Each test launches a fresh browser session and profile, and its fixture closes that exact runtime in
teardown. Both projects may run in one Playwright process because Selenium and the operating system
own the transport endpoints; the harness has no endpoint allocator.

Playwright is the test runner here, not the browser: it loads extensions into Chromium alone, so both
browsers are driven through `selenium-webdriver` (`tests/e2e/drivers/`). Selenium Manager, which ships
inside that package, downloads and caches both browsers and both drivers as matched pairs, so there is
nothing to install and no version to keep in step. `SE_FORCE_BROWSER_DOWNLOAD` is set in
`drivers/fixtures.ts` so it downloads rather than picking up a local install, and that matters:

- Stable Chrome refuses `--load-extension`. A local install starts fine and silently carries no
  extension, so the tests need Chrome for Testing.
- Playwright's bundled Firefox does not inject extension content scripts at all. Entries still arrive,
  because those come from `webRequest` in the background, while page state stays empty and every
  `visitId` and `batchId` is null. `shared/instrumentation.spec.ts` asserts a `visitId` precisely so
  that a browser which drops content scripts fails instead of reporting green.

Background state is read through the messages the panel itself uses (`panel:hydrate` and
`panel:hydrate-page-state`), sent from an extension page. A Chrome service worker and a Firefox event
page answer those identically, so no browser debugging protocol is involved. Both are started lazily,
which is why a session waits for the background to answer before the first navigation:
`webRequest.onHeadersReceived` is what records an entry, and a navigation that beats it awake is
never seen.

An unexpected test result triggers proportional failure capture before teardown. The fixture records
the active URL and title, all window handles, browser warnings, and one active-window screenshot.
Each read is best-effort, so diagnostic failure does not replace the original test failure.

Firefox retains two privileged WebDriver seams. Geckodriver's `--allow-system-access` service switch
allows a temporary extension page to be opened from Firefox's browser context and allows the
Firefox-only `devtools-panel.spec.ts` to open the real toolbox, find and select the registered Inertia
tool, and wait for its panel to render. Page warnings come from WebDriver BiDi, while parent-process
warnings are read from Firefox's console API storage.

The rest of the harness is functional: `app.ts`, `extension.ts`, and `panel.ts` expose the small
cross-browser operations used by scenarios, `waits.ts` owns observation helpers, and `fixtures.ts`
creates and tears down one runtime per test.

Chrome still has one explicit manual boundary. Its headless DevTools frontend runs the extension's
DevTools entry page but does not expose custom panels to WebDriver. A unit test therefore locks the
`panels.create` call and tab-specific URL, while the shared suite exercises the built panel directly.
The first manual smoke step remains the proof that Chrome registers the panel in the real toolbox.

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
