# Documentation

AI Hub Desktop is an Electron shell that hosts several AI services side by
side, each in its own sandboxed `WebContentsView` tab, with a per-service
domain allow-list in front of every network request.

| Document | Contents |
|----------|----------|
| [Architecture](architecture.md) | Process model, module map, IPC surface, tab lifecycle and hibernation. |
| [Design system](design.md) | Liquid Glass tokens, materials, motion and layering. |
| [Configuration](configuration.md) | Every setting, its default and its effect; where state is stored. |
| [Security model](security.md) | What the domain filter does and does not do, permission policy, hardening. |
| [Keyboard shortcuts](keyboard-shortcuts.md) | The full reference shown by the `?` dialog. |
| [Development](development.md) | Setup, scripts, tests, benchmarks, linting, icon regeneration. |
| [Packaging](packaging.md) | electron-builder targets, auto-update, deep links, one-click Windows scripts. |
| [Troubleshooting](troubleshooting.md) | Common problems and how to read the log. |
| [Roadmap](roadmap.md) | Suggested future improvements and their trade-offs. |

Start with [Architecture](architecture.md) if you are new to the codebase.
