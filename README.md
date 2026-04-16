# AI Hub Desktop

AI Hub Desktop is a powerful, multi-tab Electron application designed to consolidate your favorite AI services (like ChatGPT, Claude, Gemini) into a single, polished interface.

## Features Added

* **WebContentsView Architecture:** Uses Electron's native `WebContentsView` instead of the deprecated `webview` tag for improved performance, stability, and lower memory footprint per tab.
* **Hibernation State Management:** Safely background inactive tabs limiting CPU usage footprint drastically.
* **Tray & Global Shortcuts:** Access your AI tools quickly with `CmdOrCtrl+Shift+A` or via the minimal System Tray context.
* **Domain Blocking Logic:** Prevents unintended navigation escapes to protect privacy during your AI usage seamlessly out of the box.
* **State Persistence:** Tabs and user settings persist across app closures safely.
* **Quick Start UI & Custom Setup:** Light vs dark theme handling with drag & drop pinning capabilities internally driven.

## Setup

```bash
npm install
npm run start &
```

## Tests

Run Jest testing for the block logic:

```bash
npm test
```

## Building

Uses electron-builder out of the box.

```bash
npm run build
```
