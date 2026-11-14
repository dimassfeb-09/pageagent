// Presence spoof (MAIN world, document_start): makes the page's own
// visibility/focus APIs report "active" even when the tab is in the
// background, so activity detectors that rely on the Page Visibility API
// (visibilitychange / document.hidden / document.hasFocus / window blur)
// do not flag the tab as inactive while the agent keeps working.
//
// How it works:
// - Runs in the MAIN world at document_start, before any page script, so
//   the overrides are in place before the site's listeners attach.
// - Overrides live on Document.prototype (NOT as own properties on the
//   document instance), and the replacement getters/functions carry a
//   native-looking toString, so naive tamper checks do not trip.
// - visibilitychange / blur events are only swallowed while the tab is
//   REALLY hidden (read through the saved original getter); when the tab
//   is genuinely visible, events flow normally, so form blur validation
//   and other legit handlers keep working.
//
// Honest limits (do not claim more than this):
// - A deep descriptor audit of Document.prototype can still spot the
//   override (Function.prototype.toString.call(getter) reveals the source).
// - requestAnimationFrame stops and timers get throttled in a truly hidden
//   tab — no page script can change that. Timing-based detectors can still
//   notice the gap.
// - Only trusted input counts as activity for isTrusted-based idle
//   detectors. Synthetic events are flagged. Trusted input needs the
//   opt-in debugger keep-alive ("Tetap aktif" toggle), not this file.
(() => {
  try {
    const w = window as unknown as Record<string, unknown>;
    if (w.__pageagentPresenceInstalled) return;
    w.__pageagentPresenceInstalled = true;

    const docProto = Document.prototype;
    const origHiddenDesc = Object.getOwnPropertyDescriptor(docProto, 'hidden');
    const origVisDesc = Object.getOwnPropertyDescriptor(docProto, 'visibilityState');
    const realHidden = (): boolean => {
      try {
        if (origHiddenDesc?.get) return !!origHiddenDesc.get.call(document);
      } catch { /* fall through */ }
      try {
        if (origVisDesc?.get) return origVisDesc.get.call(document) === 'hidden';
      } catch { /* fall through */ }
      return false;
    };
    const nativeToString = (label: string) => () => `function ${label}() { [native code] }`;

    const visGet = function () { return 'visible'; } as () => string;
    (visGet as unknown as { toString: () => string }).toString = nativeToString('get visibilityState');
    const hidGet = function () { return false; } as () => boolean;
    (hidGet as unknown as { toString: () => string }).toString = nativeToString('get hidden');
    Object.defineProperty(docProto, 'visibilityState', { get: visGet, configurable: true, enumerable: true });
    Object.defineProperty(docProto, 'hidden', { get: hidGet, configurable: true, enumerable: true });

    const hasFocusFn = function () { return true; } as () => boolean;
    (hasFocusFn as unknown as { toString: () => string }).toString = nativeToString('hasFocus');
    try {
      Object.defineProperty(docProto, 'hasFocus', { value: hasFocusFn, configurable: true, writable: true });
    } catch { /* keep the native one rather than break the page */ }

    // Swallow the "you left" events, but only while really hidden.
    const blockIfHidden = (e: Event) => {
      if (realHidden()) { e.stopImmediatePropagation(); e.stopPropagation(); }
    };
    window.addEventListener('visibilitychange', blockIfHidden, true);
    document.addEventListener('visibilitychange', blockIfHidden, true);
    window.addEventListener('blur', blockIfHidden, true);
  } catch { /* presence is best-effort; never break the page */ }
})();
