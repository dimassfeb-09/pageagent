# PageAgent

AI agent in your browser. BYOK Chrome extension (React + TypeScript + Tailwind + Vite).

Repository: https://github.com/dimassfeb-09/pageagent

## Demo

https://github.com/user-attachments/assets/00e4f009-6e20-4625-9041-61405cf072ca


## Install

```bash
git clone https://github.com/dimassfeb-09/pageagent.git
cd pageagent
npm install
npm run build
```

## Load unpacked extension (step by step)

1. Open Chrome and go to `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked**.
4. Select the `dist/` folder from this project.
5. PageAgent icon appears in the toolbar; open it with the icon or `Ctrl+J` / `Cmd+J`.

## Dev

```bash
npm run dev
```

## Presence (anti-inactive)

Two layers keep a tab looking active while the agent works in the background:

1. **Visibility spoof (always on)** — `src/content/presence.ts` runs in the
   MAIN world at `document_start`, before any page script. It reports
   `document.visibilityState === 'visible'`, `document.hidden === false`,
   `document.hasFocus() === true`, and swallows `visibilitychange` / `blur`
   events while the tab is really hidden. This defeats detectors that rely
   on the Page Visibility API. It cannot hide timer/rAF throttling, and a
   deep descriptor audit of `Document.prototype` can still spot it.
2. **Trusted-input keep-alive (opt-in, "Tetap aktif" button)** — while on,
   the content script pings the background every ~1.5s and the background
   dispatches a tiny mouse move via `chrome.debugger` (`Input.dispatchMouseEvent`).
   Unlike synthetic DOM events, CDP input is trusted (`isTrusted === true`),
   so idle detectors keep seeing real activity. On attach (and re-applied at
   most every 10s, since a navigation can re-throttle the new document) it
   also sends `Emulation.setFocusEmulationEnabled` (hasFocus-gated work keeps
   running in a background tab) and `Page.setWebLifecycleState: "active"`
   (tab is not frozen/discarded). Both are best-effort — the lifecycle
   command is experimental and may not exist on every Chrome build. Chrome
   shows a "PageAgent is debugging this tab" banner while attached, and
   attaching fails while DevTools is open on the tab. Needs the `debugger`
   permission.