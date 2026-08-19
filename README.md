# Inertia.js DevTools

Browser DevTools panel for inspecting Inertia.js requests, page props, route metadata, response bodies, and client-side page state. Runs in Chrome and Firefox.

Full documentation, including installation and enabling the server-side recorder, lives at [inertiajs.com/docs/devtools](https://inertiajs.com/docs/devtools).

Both browsers build from the same sources, each into its own directory:

```bash
pnpm build:chrome         # dist-chrome/
pnpm build:firefox        # dist-firefox/
```

Loading a build, where the two targets differ, and how each one is submitted to its store are
covered in [BROWSERS.md](BROWSERS.md).

## License

Inertia.js DevTools is open-sourced software licensed under the MIT license.
