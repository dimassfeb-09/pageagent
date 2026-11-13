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