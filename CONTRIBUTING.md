# Contributing

Thanks for helping make AI Hub Desktop better.

## Getting set up

```bash
npm install
npm run doctor   # verify your environment
npm start
```

## Before you open a PR

- `npm run check` (ESLint + Jest) must pass.
- Add or update tests for behaviour changes; pure logic belongs in a
  dependency-free module so it can run under the Jest stub.
- Keep IPC channel names in `src/constants.js#IPC`.
- Do not introduce `innerHTML` with dynamic data or relax the CSP.
- Update the docs (`docs/`) and `CHANGELOG.md` for user-visible changes.

## Adding a service

Services and their allow-lists ship in `data/services.json` and
`data/rules.json` (and are refreshed from the remote catalogue at runtime).

1. Add `[name, url, type, privacy, colour]` to `services.json`.
2. Add the matching `service_domains` entry to `rules.json` using the id
   produced by `slugify(name)` (lowercase, alphanumerics only).
3. Run `npm test` - a consistency test verifies that every service has rules.

## Commit style

Short imperative subjects ("Fix tray quit on Windows"). Group related changes;
keep unrelated refactors in separate commits.

## Code of conduct

Be kind. This is a small community project; assume good faith and keep
feedback constructive.
