// Classic (non-module) content script entry. Uses dynamic import() to load the
// ESM bundle, which Chrome's content-script loader accepts.
(() => {
  try {
    const url = chrome.runtime.getURL('injected-ui.js');
    import(url).catch((e) => console.error('PageAgent load failed', e));
  } catch (e) {
    console.error('PageAgent bootstrap failed', e);
  }
})();

// Presence keep-alive loop (opt-in via the panel's "Tetap aktif" toggle).
// While the toggle is on (page-origin localStorage flag), ping the background
// every ~1.5s; the background dispatches a tiny trusted mouse move through
// chrome.debugger, so isTrusted-based idle detectors see real activity even
// when the tab is in the background. Content-script timers keep running at
// ~1s granularity in hidden tabs, which is fast enough for typical idle
// thresholds. No-op unless the user enabled the toggle.
(() => {
  try {
    let lastX = -1, lastY = -1, flip = false, jitterWasOn = false;
    window.addEventListener('mousemove', (e) => { lastX = e.clientX; lastY = e.clientY; }, true);
    const sendStop = () => {
      try { chrome.runtime.sendMessage({ type: 'presence-stop' }, () => { void chrome.runtime.lastError; }); } catch { /* ignore */ }
    };
    window.addEventListener('pagehide', () => { if (jitterWasOn) { jitterWasOn = false; sendStop(); } });
    setInterval(() => {
      try {
        if (window.localStorage.getItem('pageagent.presenceJitter') !== 'true') {
          // Toggle was switched off (the flag is per-origin, so every tab
          // of this origin detaches its own debugger session here).
          if (jitterWasOn) { jitterWasOn = false; sendStop(); }
          return;
        }
        jitterWasOn = true;
        const w = window.innerWidth || 1280, h = window.innerHeight || 900;
        flip = !flip;
        const x = Math.max(0, Math.min(w - 1, (lastX >= 0 ? lastX : w / 2) + (flip ? 2 : -2)));
        const y = Math.max(0, Math.min(h - 1, lastY >= 0 ? lastY : h / 2));
        chrome.runtime.sendMessage({ type: 'presence-ping', x, y }).catch(() => undefined);
      } catch { /* ignore */ }
    }, 1500);
  } catch { /* never break the page */ }
})();