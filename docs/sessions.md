# Logins, cookies and anti-bot hardening

Two related problems, one subsystem: an embedded browser is *bad* at staying
signed in, and it is *obvious* that it is an embedded browser. Both make the
services treat you like a bot.

Code: `src/loginstate.js` (detection, pure), `src/logins.js` (monitor),
`src/sessionstore.js` (cookie cache), `src/cookies.js` (cookie primitives),
`src/stealth.js` + `src/fingerprint.js` (hardening).
Settings live in **Settings ▸ Sessions**.

---

## 1. Detecting the login

Each service has a *fingerprint* in `data/logins.json`: the cookie names that
prove a live session (`__Secure-next-auth.session-token` for ChatGPT, `xs` +
`c_user` for Meta, `SAPISID`/`__Secure-1PSID` for Google …), the domains they
live on, an optional pair of read-only DOM selectors, and the sign-in URL.

Every tab and every cookie change triggers a debounced check, which classifies
the service as:

| State | Evidence |
|-------|----------|
| `logged-in` | a session cookie from the fingerprint is present and unexpired (optionally confirmed by the DOM) |
| `logged-out` | the fingerprint cookie is missing, the page shows a login wall, or the tab is on a sign-in/OAuth URL |
| `challenge` | a bot-challenge interstitial (`/cdn-cgi/challenge-platform`, Turnstile, hCaptcha) — explicitly **not** a logout |
| `unknown` | no fingerprint and no page signal |

`classify()` is pure and unit-tested; the monitor only gathers inputs and acts on
the verdict. States are persisted (`sessionStates`, internal) because "you were
signed in yesterday" is the only thing that makes re-login safe to automate.

### Why a sign-in page can beat a cookie

Redirect chains bounce through `/signin` even with a healthy session, so a
sign-in URL *plus* a live cookie reports `unknown` at low confidence instead of
declaring you logged out. A burst of cookie writes is coalesced (800–1500 ms) so
one login produces one state change, not twelve.

## 2. Keeping the login (cookie + browser-data cache)

Chromium drops **session cookies** — those without `expirationDate` — when the
process exits. Several AI services keep their auth token in exactly such a
cookie, which is the classic "signed out after every restart". The store fixes it
in three layers:

1. **Pin.** Session cookies are re-stamped with a bounded expiry
   (`SESSION.COOKIE_PIN_LIFETIME_MS`, 30 days) so Chromium persists them itself.
   A cookie that already expires *later* is never shortened — we do not extend a
   token a service deliberately kept short-lived.
2. **Snapshot.** A JSON snapshot per service is written to
   `<userData>/sessions/<service>.cookies.json`, mode `0600`, encrypted with the
   OS keychain through `safeStorage` when one is available (`AIE1` magic header).
   Written on every state change, every 10 minutes, and on quit.
3. **Replay.** Before the first tab navigates on the next launch, the snapshot is
   merged back in. Cookies that already exist live are left alone — a fresher
   token always wins over the cache.

localStorage, IndexedDB and service workers are Chromium's own persistent store;
they ride along in the same profile. Nothing here is synced anywhere: the cache
never leaves your machine, and the renderer only ever sees *counts* and
timestamps, never cookie values.

**Keep-alive.** A background ping (`session.fetch` on the service's own origin,
with credentials, once per `keepAliveMinutes`) makes the provider roll its token
forward before it lapses, then re-pins and re-snapshots. Only services that are
actually `logged-in` are pinged, and the sweep paces itself (250 ms between
services).

### Re-login on open

At startup, after the replay, the monitor re-checks every service that has a tab
or a previous record. Where a session that *was* `logged-in` is now
`logged-out`, the app opens that service's sign-in page — reusing the tab if it
is already open (and waking it from hibernation), otherwise opening a new one —
and tells you which services need a click-through. It never nags on:

* a first run (no previous record),
* a `challenge` state (the user may be mid-verification),
* a repeat inside the 5-minute grace window.

Turn it off with **Re-login on open** (`autoRelogin`).

### Per-service profiles (optional)

**Isolate sessions per service** (`isolateSessions`) moves each service into
`persist:aihub-<id>`, which lets you wipe one account without touching the rest
and stops cross-service tracking via shared cookies. It is opt-in because it also
disables cross-service sign-on: signing into Gemini will no longer sign you into
Copilot. Existing tabs must be closed and reopened for the switch to take effect.

## 3. Anti-bot hardening

Four layers, cheapest first. All of it is gated on one setting
(`antiBotHardening`), and none of it weakens a security boundary.

1. **Process flags** — `--disable-blink-features=AutomationControlled`, applied
   before the app is ready. This is what removes `navigator.webdriver = true` at
   the Blink level, before any script runs.
2. **Session identity** — the UA loses `Electron/41.1.1` and `aihub-desktop`,
   keeping Chromium's real version (a UA that disagrees with engine behaviour is
   a gift to a detector). `Accept-Language` and every `Sec-CH-UA*` client hint
   are rewritten on every request to agree with it, case-folded so the same hint
   is never sent twice, and `electron-*`/`aihub-*` headers are dropped. Loopback
   and unparseable URLs are left untouched.
3. **Renderer patch** — injected through CDP `Page.addScriptToEvaluateOnNewDocument`,
   i.e. *before* page scripts, in the page's main world, which is the only
   ordering that matters. It covers `navigator.webdriver`, `languages`,
   `platform`, `hardwareConcurrency`, `deviceMemory`, `maxTouchPoints`,
   `userAgentData` (with `getHighEntropyValues`), plugins/mimeTypes,
   `window.chrome`, `permissions.query`, WebGL vendor/renderer strings and screen
   metrics. Every patched member keeps a native-looking `Function.prototype
   .toString`, and each patch is individually `try/catch`ed — a detectable patch
   is worse than none. When the debugger is unavailable (DevTools open), the
   same source is applied at `dom-ready` instead, and the tab still works.
4. **Behaviour** — a bot challenge is waited out with exponential backoff and
   jitter, capped at 3 automated reloads, and never counted as a logout. Text
   this app types for you (`antiBotHumanize`) goes out in small runs with
   human-length pauses, focus events and pointer coordinates with an offset,
   instead of one `input` event carrying 4 kB.

The profile behind all of this is derived from a **persisted seed**
(`<userData>/data/fingerprint.json`), not from a fresh `Math.random()`: a
fingerprint that changes every launch is a stronger bot signal than an honest
one, and it also breaks fingerprint-based login persistence.

### Canvas noise is off by default

`antiBotCanvasNoise` perturbs `toDataURL()` read-back. It is opt-in because the
same canvas hash that identifies a bot also identifies *you* to your provider —
noising it can make the login you just cached look like a new device. Off is the
correct default for this app.

## 4. What this never does

* No credentials are stored, read, or autofilled. Nothing in the app sees a
  password: the cache holds cookies that the browser already holds, and the
  sign-in flow is always completed by you, in the page, with your provider.
* No captcha solving, no proxy rotation, no fingerprint "spoofing" beyond
  removing the app's own tells, no rate-avoidance tricks for scraping.
* No elevated privileges for the injected patch: it is the same sandboxed,
  context-isolated renderer, and the patch only *reads and normalises* what a
  normal Chrome would report.
* Cleared on request: **Sessions ▸ Clear cookies and cached sessions** deletes
  cookies, storage *and* the snapshot files, per service or everywhere, so a
  sign-out is really a sign-out.

Automating a service you are signed into can still violate its terms of service.
This layer exists to stop the *client* from looking like a robot; whether you
point it at anything a provider prohibits is your call, and your account.

## Troubleshooting

| Symptom | Look at |
|---------|---------|
| Signed out after every restart | Sessions panel: `N cached snapshot(s)` should be non-zero; check the log for `Unable to snapshot cookies`. |
| "Session expired" nag on every launch | The provider rotated its cookie name. Add the new name to `<userData>/data/logins.json` (copies override the bundled file) and reopen. |
| A service flags the browser anyway | Check `Settings ▸ Sessions` hardening line: `0 tab(s) patched` means CDP was busy (DevTools open) — close DevTools and reload the tab. |
| Endless challenge loop | By design it stops after 3 reloads. Solve it once by hand; the retry budget resets as soon as the page is clean. |
| SSO stopped working across services | `isolateSessions` is on — that is the trade-off. |
