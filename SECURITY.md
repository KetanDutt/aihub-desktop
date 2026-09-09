# Security policy

## Supported versions

| Version | Supported |
|---------|-----------|
| 1.1.x   | Yes       |
| < 1.1   | No        |

## Reporting a vulnerability

Please do **not** open a public issue for security problems. Email the
maintainer (see the repository profile) or open a private security advisory on
GitHub, including:

- a description of the issue and the affected version,
- steps or a proof-of-concept to reproduce it,
- the impact you believe it has.

You should receive an acknowledgement within a few days. We will coordinate a
fix and a disclosure timeline with you.

## What we consider in scope

- Sandbox / context-isolation escapes,
- ways to bypass the domain allow-list from the renderer,
- remote-code-execution or arbitrary file read/write via IPC,
- supply-chain issues in the bundled data or build pipeline.

Out of scope: the behaviour of the third-party AI services themselves, and
anything that requires the user to disable *Domain blocking* first.

See [docs/security.md](docs/security.md) for the threat model.
