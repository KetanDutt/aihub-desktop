# Service catalogue

Everything the menus need to describe a service *before* its tab has ever
loaded — the exact homepage, whether it needs an account, where its sign-in page
is, which domains it may reach, and an icon — lives in one generated file:

```
data/catalog.json        one record per service
assets/icons/<id>.<ext>  the cached icon for that service
```

Both are produced by `scripts/audit-services.js` and consumed at runtime by
`src/catalog.js`.

## Why it is generated

The shell renderer's CSP is `img-src 'self' data:`, so it can never load a
remote image. Previously every icon was fetched by the main process on first
paint and cached per user. That is a network round trip per service on a fresh
install, it leaks a request to each site before you have opened it, and it shows
initials placeholders until it completes.

Pre-auditing moves that work to build time: the catalogue ships with the app, so
the tab strip, the sidebar and the service picker paint complete and instantly,
offline, on the very first launch.

## Regenerating

```bash
npm run services:audit          # offline (default) — safe anywhere, no network
npm run services:audit:online   # also probe the live sites
npm run services:check          # fail if catalog.json is stale (CI)
```

**Offline** is the default so a build box, CI or an air-gapped machine can always
regenerate. Every field is derived from data already in the repo
(`services.json`, `rules.json`, `logins.json`, `adapters.json`) and each icon is
a deterministic monogram in the service's brand colour.

**`--online`** upgrades that: it requests each service's homepage, follows
redirects to learn the real landing URL, reads the `<link rel="icon">` tags and
caches the best real favicon it finds. A previously downloaded real favicon is
never replaced by a monogram, and a failed probe never fails the run — the
offline value is kept.

The one-click build (`npm run one-click-build`) runs the offline audit
automatically, so a release always ships a catalogue consistent with its data
files.

## Record shape

```jsonc
{
  "id": "chatgpt",
  "name": "ChatGPT",
  "homepage": "https://chatgpt.com/",        // where a tab opens
  "catalogUrl": "https://chatgpt.com/",      // the raw services.json URL
  "loginUrl": "https://chatgpt.com/auth/login",
  "requiresLogin": true,
  "type": "Conversational AI",
  "privacy": "Conversations may be reviewed…",
  "color": "10a37f",
  "authDomains": ["chatgpt.com", "openai.com", …],  // rules + cookie domains
  "hasLoginProfile": true,                   // has a logins.json fingerprint
  "hasApiAdapter": true,                     // the local API can drive it
  "icon": "assets/icons/chatgpt.svg",
  "iconSource": "monogram",                  // or "favicon"
  "probe": { "checkedAt": "…", "reachable": true, "status": 200, … }
}
```

`homepage` prefers the login profile's `homeUrl` over the plain catalogue URL,
because that is the post-redirect landing page (`/new`, `/app`, `/chat`) — a tab
opens straight on the chat surface instead of bouncing through a marketing page.

## Runtime use

`src/catalog.js` reads the file once and caches it. It has no Electron and no
network dependency, so it is unit-tested directly (`tests/catalog.test.js`).

- `get-services` returns the normal service list **enriched** with the catalogue
  fields, so the renderer gets icons and homepages in the response it already
  makes.
- `get-favicon` checks the catalogue first and only falls back to the live
  fetcher (`src/favicon.js`) for a service the audit does not know.
- `get-service-details` returns one full record, used by the service details
  context menu.
- `navHome` sends a tab back to its catalogue homepage.

A missing, stale or corrupt `catalog.json` is never fatal: the loader returns
`null` and the app falls back to the previous live-fetch behaviour. Icon paths
are normalised before reading, so a hand-edited catalogue cannot escape the icon
directory.

## Adding a service

1. Add it to `data/services.json` (and `rules.json`, plus `logins.json` /
   `adapters.json` when relevant) as described in `AGENTS.md`.
2. Run `npm run services:audit` (add `--online` to pull its real favicon).
3. Commit the updated `data/catalog.json` and the new `assets/icons/<id>.*`.

`tests/catalog.test.js` asserts the catalogue covers exactly the services in
`services.json`, that each icon file exists, and that every sign-in service has
a login URL — so a forgotten regeneration fails CI.
