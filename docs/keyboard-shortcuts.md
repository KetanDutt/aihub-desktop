# Keyboard shortcuts

Every shortcut in the table below works everywhere: while the **shell chrome**
has focus *and* while you are typing inside a service. A service tab is a real
`WebContentsView` that owns the keyboard, so the main process watches for these
accelerators specifically (`src/accelerators.js`) and replays them against the
shell. Everything else — plain typing, `Esc`, `Ctrl+A/C/V/X/Z`, the site's own
editor chords — stays with the page, exactly like a browser tab.

On macOS use `⌘` instead of `Ctrl` (and `Ctrl`-based site chords pass through).

Shortcut behaviour that is deliberately *not* stolen from the page: `Esc` never
stops a load while a site could be closing its own overlay, and no unmodified
letter or digit key is ever intercepted.

| Keys | Action |
|------|--------|
| `Ctrl+T` | Open the service picker |
| `Ctrl+B` | Toggle the service sidebar |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | Next / previous tab |
| `Ctrl+1` … `Ctrl+9` | Jump to tab *n* (`Ctrl+9` goes to the last tab) |
| `Ctrl+W` | Close the active tab |
| `Ctrl+Shift+T` | Reopen the last closed tab (up to 10 remembered) |
| `Ctrl+R` / `F5` | Reload the active tab |
| `Ctrl+Shift+R` | Reload, ignoring the cache |
| `Esc` | Stop loading (when no dialog is open) |
| `Alt+←` / `Alt+→` | Back / forward in the active tab |
| `Alt+Home` | Back to the service home page |
| `Ctrl+F` | Find in page (floating find bar) |
| `Ctrl+M` | Mute / unmute the active tab |
| `Ctrl+=` / `Ctrl+-` / `Ctrl+0` | Zoom in / out / reset (active tab) |
| `Ctrl+,` | Open settings |
| `Esc` | Close find bar, dialogs, sidebar and settings |
| `?` | Show the shortcut reference (chrome only) |
| `F1` | Show the shortcut reference (also inside a tab) |

Global (OS-wide) shortcut, configurable in **Settings → General**:
`CommandOrControl+Shift+A` shows or hides the app.

## Mouse

- Middle-click a tab to close it
- Right-click a tab for back/forward, reload (plus reload ignoring the cache),
  stop, home, hibernate/wake, mute, find, zoom, copy URL, open in browser and
  close actions
- Right-click a service card or row for its audited details — exact homepage,
  whether it needs an account, its sign-in page, and enable/disable
- Shift-click the reload button to bypass the cache
- Drag tabs to reorder
- Click a toast to dismiss it early; a toast with an action button (for example
  **Reload** after a tab crashes) keeps it on screen longer

## Find bar

When the find bar is open:

- Type to search live
- `Enter` / next button → next match
- `Shift+Enter` / previous button → previous match
- `Esc` → close and clear the page selection
