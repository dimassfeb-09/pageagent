// Standalone content script (no framework, no imports): hover overlay picker.
// Hover: green outline + tag chip. Click: stamp data-ai-id, sanitize the
// outerHTML (drop script/style/event handlers), send "getSelectedElement",
// then deactivate. Esc or Ctrl/Cmd+Q cancels.
(() => {
  let active = false;
  let overlay: HTMLDivElement | null = null;
  let chip: HTMLDivElement | null = null;
  let hovered: HTMLElement | null = null;

  function sanitize(el: HTMLElement): string {
    const clone = el.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('script, style').forEach((n) => n.remove());
    clone.querySelectorAll('*').forEach((n) => {
      Array.from(n.attributes).forEach((a) => { if (a.name.startsWith('on')) n.removeAttribute(a.name); });
    });
    Array.from(clone.attributes).forEach((a) => { if (a.name.startsWith('on')) clone.removeAttribute(a.name); });
    return clone.outerHTML.slice(0, 8000);
  }
  function onMove(e: MouseEvent) {
    const el = e.target as HTMLElement | null;
    if (!el || el === overlay || el === chip) return;
    hovered = el;
    const r = el.getBoundingClientRect();
    if (!overlay) return;
    overlay.style.left = `${r.left + window.scrollX}px`;
    overlay.style.top = `${r.top + window.scrollY}px`;
    overlay.style.width = `${r.width}px`;
    overlay.style.height = `${r.height}px`;
    if (chip) { chip.textContent = el.tagName.toLowerCase(); chip.style.left = `${r.left + window.scrollX}px`; chip.style.top = `${r.top + window.scrollY - 20}px`; }
  }
  function onClick(e: MouseEvent) {
    e.preventDefault(); e.stopPropagation();
    const el = hovered || (e.target as HTMLElement | null);
    if (!el) return;
    let aiId = el.getAttribute('data-ai-id') || '';
    if (!aiId) { aiId = 'ai-id-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36); el.setAttribute('data-ai-id', aiId); }
    const value = (el as HTMLInputElement).value || '';
    chrome.runtime.sendMessage({
      type: 'getSelectedElement',
      success: true, aiId,
      outerHTML: sanitize(el),
      tagName: el.tagName.toLowerCase(),
      innerText: (el.innerText || '').slice(0, 500),
      value,
    });
    stop();
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'q')) { e.preventDefault(); stop(); }
  }
  function start() {
    if (active) return;
    active = true;
    overlay = document.createElement('div');
    overlay.style.cssText = 'position:absolute;pointer-events:none;outline:2px solid #47885a;outline-offset:1px;z-index:2147483647;';
    chip = document.createElement('div');
    chip.style.cssText = 'position:absolute;pointer-events:none;background:#47885a;color:#fff;font:11px sans-serif;padding:2px 6px;border-radius:4px;z-index:2147483647;';
    document.body.appendChild(overlay); document.body.appendChild(chip);
    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKey, true);
  }
  function stop() {
    if (!active) return;
    active = false;
    document.removeEventListener('mousemove', onMove, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKey, true);
    overlay?.remove(); chip?.remove(); overlay = null; chip = null; hovered = null;
  }
  (window as unknown as Record<string, unknown>).elementSelectorStart = start;
  (window as unknown as Record<string, unknown>).elementSelectorStop = stop;
  (window as unknown as Record<string, unknown>).elementSelectorToggle = () => (active ? stop() : start());
  (window as unknown as Record<string, unknown>).elementSelectorDestroy = stop;
})();
