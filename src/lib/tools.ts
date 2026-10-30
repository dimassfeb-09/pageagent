// Tool executors run in the sidepanel (chrome.scripting context), per spec.
// Injected page functions are fully self-contained (no imports/closures)
// so chrome.scripting can serialize them.
import { injectedExtractMarkdown } from './defuddle-lite';

const isWebUrl = (url?: string) => !!url && /^https?:\/\//.test(url);
export const needPageError = (url?: string) =>
  isWebUrl(url) ? null : { error: 'Not a web page' };
export const needAccessError = { error: 'NEED_PAGE_CONTENT_ACCESS_PERMISSION' };

export function injectedFindElements(): { type: string; content: string; id: string; shadowDepth: number }[] {
  const out: { type: string; content: string; id: string; shadowDepth: number }[] = [];
  const selector = 'a, button, input, textarea, select, option, label, [contenteditable="true"], [aria-label], [role], [tabindex], [data-action], [data-id], .opt, .clickable, [onclick]';
  const MAX = 300;
  const roots: { root: ParentNode; depth: number }[] = [];
  const seen = new Set<Node>();
  function collectRoots(root: ParentNode, depth: number) {
    if (depth > 3 || seen.has(root)) return;
    seen.add(root);
    roots.push({ root, depth });
    // open shadow roots only; closed roots stay inaccessible by design
    (Array.from((root instanceof Document ? root.documentElement : root).querySelectorAll('*')) as Element[]).forEach((el) => {
      if (el.shadowRoot && !seen.has(el.shadowRoot)) collectRoots(el.shadowRoot, depth + 1);
    });
  }
  collectRoots(document, 0);
  // CSS selector cannot reliably see React/Vue event-only click targets. Treat obvious pointer targets as candidates, but keep it scoped to common containers so large pages cannot overrun the cap.
  for (const { root, depth } of roots) {
    const candidateSet = new Set<Element>();
    try { Array.from(root.querySelectorAll(selector)).forEach((el) => candidateSet.add(el)); } catch { continue; }
    try {
      Array.from(root.querySelectorAll('div, span, li, p, td, th')).forEach((el) => {
        const style = window.getComputedStyle(el);
        if ((style.cursor === 'pointer' || style.cursor === 'move') && el.textContent?.trim()) candidateSet.add(el);
      });
      Array.from(root.querySelectorAll('[class]')).forEach((el) => {
        const klass = String(el.className || '');
        if (/(^|\s)(btn|button|click|cta|cta-|action|submit|tombol)(\s|$)/i.test(klass) && el.textContent?.trim()) candidateSet.add(el);
      });
    } catch { /* retain deterministic selector result */ }
    for (const el of candidateSet) {
      if (out.length >= MAX) return out;
      const html = el as HTMLElement;
      const tag = html.tagName.toLowerCase();
      const style = window.getComputedStyle(html);
      const rect = html.getBoundingClientRect();
      const isRootFixed = html.offsetParent === null && html.tagName !== 'BODY';
      if (isRootFixed && (style.display === 'none' || style.visibility === 'hidden')) continue;
      if (rect.width <= 0 || rect.height <= 0) continue;
      if (style.opacity === '0' && tag !== 'input') continue;
      if (tag === 'img') {
        const alt = html.getAttribute('alt') || html.getAttribute('aria-label') || '';
        if (!alt) continue;
      }
      if (tag === 'a') {
        const href = html.getAttribute('href') || '';
        if (!href || /^(javascript:|mailto:|tel:|data:|blob:|about:|chrome:|#)/.test(href)) continue;
      }
      if (tag === 'input' && (html.getAttribute('type') || '').toLowerCase() === 'hidden') continue;
      let id = html.getAttribute('data-ai-id') || '';
      if (!id) { id = 'ai-id-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36); html.setAttribute('data-ai-id', id); }
      const nearbyLabel = (el as HTMLElement).closest('label')?.innerText || '';
      const content = (html.getAttribute('aria-label') || html.getAttribute('title') || html.getAttribute('placeholder') || (tag === 'input' || tag === 'textarea' || tag === 'select' ? (html as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).value : html.innerText) || html.getAttribute('alt') || html.getAttribute('title') || nearbyLabel || '').replace(/\s+/g, ' ').trim().slice(0, 200);
      // Form controls often have no visible text; only form controls may pass with a blank value.
      if (!content && !html.getAttribute('role') && !html.getAttribute('tabindex') && tag !== 'input' && tag !== 'textarea' && tag !== 'select') continue;
      let type = 'button';
      if (tag === 'a') type = 'link';
      else if (tag === 'input') type = 'input';
      else if (tag === 'textarea') type = 'textarea';
      else if (tag === 'select') type = 'select';
      else if (tag === 'option') type = 'option';
      else if (tag === 'label') type = 'label';
      else if (tag === 'img') type = 'image';
      else if (html.getAttribute('contenteditable') === 'true') type = 'contentEditable';
      // Keep the AI handle short while saving a semantic fallback identity. Inputs are keyed by stable page attributes rather than text that React/Vue may change while typing.
      const locator = [
        tag,
        type,
        String(html.getAttribute('role') || '').toLowerCase(),
        String(html.getAttribute('type') || '').toLowerCase(),
        String(html.getAttribute('name') || '').toLowerCase(),
        String(html.getAttribute('id') || '').toLowerCase(),
        String(html.getAttribute('aria-label') || '').trim().toLowerCase(),
        String(html.getAttribute('placeholder') || '').trim().toLowerCase(),
        (html.getAttribute('contenteditable') === 'true') ? 'contenteditable' : '',
        (type !== 'input' && type !== 'select' && type !== 'option') ? content.slice(0, 96).trim().toLowerCase() : '',
      ].map((v) => String(v || '').replace(/\s+/g, ' ').trim()).join('|');
      html.setAttribute('data-pageagent-locator', locator);
      out.push({ type, content, id, shadowDepth: depth });
      const stateOwner = globalThis as any;
      if (!stateOwner.__pageagentLocatorMap) stateOwner.__pageagentLocatorMap = new Map();
      stateOwner.__pageagentLocatorMap.set(id, { id, tag, type, locator, content });
    }
  }
  return out;
}
export function injectedClick(id: string): { clicked: boolean; href?: string; stale?: boolean; disabled?: boolean; issue?: string; covering?: string } {
  // Self-duplicate because chrome.scripting serializes only this function, not module scope.
  const resolver = (targetId: string, rescued = false): any => {
    let node = document.querySelector('[data-ai-id="' + targetId + '"]') as HTMLElement | null;
    if (node) return node;
    if (rescued) return null;
    const stateOwner = globalThis as any;
    const prior = stateOwner.__pageagentLocatorMap?.get?.(targetId);
    if (!prior || !prior.locator) return null;
    const roots: { root: ParentNode; depth: number }[] = [];
    const seen = new Set<Node>();
    const collect = (root: ParentNode, depth: number) => {
      if (depth > 3 || seen.has(root)) return;
      seen.add(root);
      roots.push({ root, depth });
      const holder = (root instanceof Document ? root.documentElement : root) as Element;
      Array.from(holder.querySelectorAll('*')).forEach((el) => {
        if (el.shadowRoot && !seen.has(el.shadowRoot)) collect(el.shadowRoot, depth + 1);
      });
    };
    collect(document, 0);
    const matches: HTMLElement[] = [];
    for (const item of roots) {
      for (const el of Array.from(item.root.querySelectorAll('[data-pageagent-locator]'))) {
        const html = el as HTMLElement;
        if (html.getAttribute('data-pageagent-locator') === prior.locator) matches.push(html);
      }
    }
    if (matches.length !== 1) return null;
    const found = matches[0];
    found.setAttribute('data-ai-id', targetId);
    return found;
  };
  const el = resolver(id);
  if (!el) return { clicked: false, stale: true };
  el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  const disabled = (el as HTMLButtonElement | HTMLInputElement).disabled === true || el.getAttribute('aria-disabled') === 'true';
  if (disabled) return { clicked: false, disabled: true, issue: 'disabled' };
  const rect = el.getBoundingClientRect();
  const cover = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
  if (cover && cover !== el && !el.contains(cover)) return { clicked: false, issue: 'covered', covering: cover.tagName.toLowerCase() };
  const href = el.tagName.toLowerCase() === 'a' ? (el.getAttribute('href') || undefined) : undefined;
  if (href && /^https?:\/\//.test(href)) return { clicked: true, href };
  el.click();
  return { clicked: true };
}
export function injectedInput(id: string, text: string): { ok: boolean; stale?: boolean; value?: string; reason?: string; available?: unknown; selected?: string; disabled?: boolean } {
  // Self-duplicate by necessity above; scanning only happens once here.
  // Always resolve first; if the original AI id disappeared after rerender, try semantic matching. This does one lookup only and never scans indefinitely.
  const restoreTarget = (): HTMLElement | null => {
    const found = document.querySelector('[data-ai-id="' + id + '"]') as HTMLElement | null;
    if (found) return found;
    const stateOwner = globalThis as any;
    const prior = stateOwner.__pageagentLocatorMap?.get?.(id);
    if (!prior?.locator) return null;
    const seen = new Set<Node>();
    const roots: { root: ParentNode }[] = [];
    const collect = (root: ParentNode, depth: number) => {
      if (depth > 3 || seen.has(root)) return;
      seen.add(root);
      roots.push({ root });
      const holder = root instanceof Document ? root.documentElement : root;
      Array.from((holder as Element).querySelectorAll('*')).forEach((el) => { if (el.shadowRoot && !seen.has(el.shadowRoot)) collect(el.shadowRoot, depth + 1); });
    };
    collect(document, 0);
    const matches: HTMLElement[] = [];
    for (const r of roots) {
      Array.from(r.root.querySelectorAll('[data-pageagent-locator]')).forEach((el) => {
        if ((el as HTMLElement).getAttribute('data-pageagent-locator') === prior.locator) matches.push(el as HTMLElement);
      });
    }
    if (matches.length !== 1) return null;
    const rescued = matches[0];
    rescued.setAttribute('data-ai-id', id);
    return rescued;
  };
  const el = restoreTarget();
  if (!el) return { ok: false, stale: true };
  el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  if (el.getAttribute('contenteditable') === 'true') {
    el.focus();
    const sel = window.getSelection();
    if (sel) { sel.selectAllChildren(el); }
    document.execCommand('delete');
    if (!document.execCommand('insertText', false, text)) el.textContent = text;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return { ok: true };
  }
  if (el.tagName.toLowerCase() === 'select') {
    const select = el as HTMLSelectElement;
    const wanted = String(text).trim();
    const opts = Array.from(select.options);
    const matched =
      opts.find((o) => o.value === wanted) ||
      opts.find((o) => o.textContent.trim() === wanted) ||
      opts.find((o) => o.value.toLowerCase() === wanted.toLowerCase()) ||
      opts.find((o) => o.textContent.trim().toLowerCase() === wanted.toLowerCase()) ||
      opts.find((o) => o.textContent.trim().toLowerCase().includes(wanted.toLowerCase()));
    if (!matched) {
      return {
        ok: false,
        stale: false,
        reason: 'option-not-found',
        available: opts.slice(0, 15).map((o) => ({ value: o.value, text: o.textContent.trim() })),
      };
    }
    select.value = matched.value;
    select.focus();
    select.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
    select.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
    const selectedText = select.options[select.selectedIndex]?.textContent?.trim() || select.value;
    return { ok: true, value: select.value, selected: selectedText };
  }
  const input = el as HTMLInputElement | HTMLTextAreaElement;
  let fill = String(text);
  if (input.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(fill.trim())) {
    const parsed = new Date(fill.trim());
    if (!Number.isNaN(parsed.getTime())) fill = parsed.toISOString().slice(0, 10);
  }
  const checkbox = input.type === 'checkbox' || input.type === 'radio';
  let expectedChecked = false;
  if (checkbox) { expectedChecked = /^(true|yes|on|1)$/i.test(fill.trim()); (input as HTMLInputElement).checked = expectedChecked; }
  else {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')?.set
      || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (setter) setter.call(input, fill); else input.value = fill;
  }
  input.focus();
  input.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
  input.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));

  // Verify the native state once. Controlled components can reject a value (disabled, read-only, invalid min/type); in that case do one explicit retry.
  const readValue = () => checkbox ? (input as HTMLInputElement).checked : input.value;
  const wanted = checkbox ? expectedChecked : fill;
  let matched = (readValue() as unknown) === wanted;
  if (!matched && !checkbox) {
    input.value = fill;
    input.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
    input.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
    matched = input.value === fill;
  }
  if (!matched) {
    return { ok: false, stale: false, reason: 'value-not-applied', value: String(readValue()) };
  }
  return { ok: true, value: String(readValue()) };
}
export function injectedProps(ids: string[]): { aiId: string; src?: string; href?: string; value?: string }[] {
  return ids.map((id) => {
    const el = document.querySelector('[data-ai-id="' + id + '"]') as HTMLImageElement | HTMLAnchorElement | HTMLInputElement | null;
    if (!el) return { aiId: id };
    const r: { aiId: string; src?: string; href?: string; value?: string } = { aiId: id };
    if ((el as HTMLImageElement).src) r.src = (el as HTMLImageElement).src;
    if ((el as HTMLAnchorElement).href) r.href = (el as HTMLAnchorElement).href;
    if ('value' in el) r.value = (el as HTMLInputElement).value;
    return r;
  });
}
export function injectedScrollBottom(): { ok: boolean } {
  window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
  return { ok: true };
}
export function injectedCollectImages(): string[] {
  const urls = new Set<string>();
  document.querySelectorAll('img').forEach((img) => {
    if (img.complete && img.naturalWidth > 0 && /^https?:\/\//.test(img.src)) urls.add(img.src);
  });
  document.querySelectorAll('div, section, header, footer, article, aside, main, .hero, .banner, .background, .cover, .image, [style*=background], [class*=bg-], [class*=background]').forEach((el) => {
    const bg = window.getComputedStyle(el).backgroundImage;
    const m = bg && bg.match(/url\(["']?(https?:[^"')]+)["']?\)/);
    if (m) urls.add(m[1]);
  });
  return [...urls];
}
async function exec<T>(tabId: number, func: (...args: never[]) => T, args: unknown[] = []): Promise<T> {
  const res = await chrome.scripting.executeScript({ target: { tabId }, func, args });
  return res?.[0]?.result as T;
}
async function tabOf(tabId: number) { return chrome.tabs.get(tabId); }
export async function waitTabLoadFinished(tabId: number, timeoutMs = 30000): Promise<{ success: boolean }> {
  const start = Date.now();
  for (;;) {
    try { const t = await tabOf(tabId); if (t.status === 'complete') return { success: true }; } catch { return { success: false }; }
    if (Date.now() - start > timeoutMs) return { success: false };
    await new Promise((r) => setTimeout(r, 500));
  }
}
export function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
// Minimal ZIP writer (STORE method, no compression) + CRC32, dependency-free.
const CRC_TABLE = (() => { const t: number[] = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(bytes: Uint8Array): number { let c = 0xffffffff; for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
export function buildZip(files: { name: string; data: Uint8Array }[]): Blob {
  const local: number[] = []; const central: number[] = []; let offset = 0;
  const push = (arr: number[], bytes: number[]) => bytes.forEach((b) => arr.push(b));
  const u16 = (v: number) => [v & 0xff, (v >> 8) & 0xff];
  const u32 = (v: number) => [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff];
  const enc = new TextEncoder();
  for (const f of files) {
    const name = enc.encode(f.name); const crc = crc32(f.data);
    push(local, [...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(crc), ...u32(f.data.length), ...u32(f.data.length), ...u16(name.length), ...u16(0), ...name, ...f.data]);
    push(central, [...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(crc), ...u32(f.data.length), ...u32(f.data.length), ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset), ...name]);
    offset += 30 + name.length + f.data.length;
  }
  const centralOffset = offset;
  push(local, [...central, ...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(central.length), ...u32(centralOffset), ...u16(0)]);
  return new Blob([new Uint8Array(local)], { type: 'application/zip' });
}

export const GROUP_COLORS = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'brown', 'gray', 'black', 'white'] as const;

/** Execute one of the 16 agent tools. Throws/returns {error} objects per spec. */
export async function executeTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const tabId = args.tabId as number | undefined;
  switch (name) {
    case 'openNewTabWithURL': {
      const url = String(args.url || '');
      if (!isWebUrl(url)) return needAccessError;
      const tab = await chrome.tabs.create({ url });
      await waitTabLoadFinished(tab.id);
      return { tab: { id: tab.id, url: tab.url, title: tab.title } };
    }
    case 'getTabContent': {
      const contents = [];
      for (const id of (args.tabIds as number[])) {
        const t = await tabOf(id).catch(() => null);
        if (!t || !isWebUrl(t.url)) return needAccessError;
        const markdown = await exec(id, injectedExtractMarkdown);
        contents.push({ tabId: id, title: t.title, url: t.url, markdown });
      }
      return { contents };
    }
    case 'findAccessableElementsFromTab': return { elements: await exec(tabId!, injectedFindElements) };
    case 'clickElementByAiID': {
      const targetId = String(args.id || '');
      const r = await exec(tabId!, injectedClick, [targetId]);
      if (!r.clicked) return { ok: false, kind: 'click', target: targetId, error: r.stale ? 'element-not-found' : r.issue || 'click-not-possible', stale: r.stale === true, issue: r.issue, covering: r.covering };
      if (r.href) { const tab = await chrome.tabs.create({ url: r.href }); return { ok: true, kind: 'click', target: targetId, shouldWaitTabLoadFinished: true, tabId: tab.id, href: r.href }; }
      return { ok: true, kind: 'click', target: targetId, clicked: true };
    }
    case 'inputTextByAiID': return await exec(tabId!, injectedInput, [String(args.id), String(args.text)]);
    case 'waitTabLoadFinished': return await waitTabLoadFinished(tabId!);
    case 'closeTab': { for (const id of (args.tabIds as number[])) await chrome.tabs.remove(id); return { closed: true }; }
    case 'getElementPropertiesByAiID': return await exec(tabId!, injectedProps, [args.ids as string[]]);
    case 'insertCSSToTab': await chrome.scripting.insertCSS({ target: { tabId: tabId! }, css: String(args.css) }); return { ok: true };
    case 'removeCSSToTab': await chrome.scripting.removeCSS({ target: { tabId: tabId! }, css: String(args.css) }); return { ok: true };
    case 'groupTabs': {
      const groupId = await chrome.tabs.group({ tabIds: args.tabIds as number[] });
      await chrome.tabGroups.update(groupId, { title: String(args.title), color: (args.color as string) || 'cyan' });
      return { groupId };
    }
    case 'getAllTabs': { const tabs = await chrome.tabs.query({}); return { tabs: tabs.map((t: { id: number; title: string }) => ({ id: t.id, title: t.title })) }; }
    case 'scrollToBottom': {
      const t = await tabOf(tabId!).catch(() => null);
      if (!t || !isWebUrl(t.url)) return { error: 'Not a web page' };
      return await exec(tabId!, injectedScrollBottom);
    }
    case 'openSearchTab': { const tab = await chrome.tabs.create({}); await chrome.search.query({ text: String(args.query), tabId: tab.id }); return { tabId: tab.id }; }
    case 'downloadTabToMarkdown': {
      const t = await tabOf(tabId!).catch(() => null);
      if (!t || !isWebUrl(t.url)) return { error: 'Not a web page' };
      const markdown = await exec(tabId!, injectedExtractMarkdown);
      const name = `${(t.title || 'page').slice(0, 30)}.md`;
      downloadBlob(name, new Blob([markdown], { type: 'text/markdown' }));
      return { downloaded: name };
    }
    case 'downloadAllImagesInTab': {
      const t = await tabOf(tabId!).catch(() => null);
      if (!t || !isWebUrl(t.url)) return { error: 'Not a web page' };
      const urls = await exec(tabId!, injectedCollectImages);
      try {
        const files: { name: string; data: Uint8Array }[] = [];
        for (let i = 0; i < urls.length; i++) {
          const res = await fetch(urls[i]); if (!res.ok) continue;
          const buf = new Uint8Array(await res.arrayBuffer());
          const ext = urls[i].split('?')[0].split('.').pop()?.slice(0, 4) || 'bin';
          files.push({ name: `image-${i + 1}.${ext}`, data: buf });
        }
        if (!files.length) throw new Error('no downloadable images');
        downloadBlob('images.zip', buildZip(files));
        return { count: files.length, format: 'zip' };
      } catch {
        // Fallback documented in README: download one by one.
        urls.forEach((u) => { const a = document.createElement('a'); a.href = u; a.download = ''; a.target = '_blank'; a.click(); });
        return { count: urls.length, format: 'individual' };
      }
    }
    case 'getBrowserHistory': return { error: 'NEED_BROWSER_HISTORY_PERMISSION' };
    case 'displayTaskReport': return { received: true };
    default: return { error: `unknown tool ${name}` };
  }
}
/** Extra executor (not a model tool): focus a tab. */
export async function goToTab(tabId: number): Promise<void> {
  const t = await chrome.tabs.get(tabId);
  await chrome.tabs.update(tabId, { active: true });
  if (t.windowId) await chrome.windows.update(t.windowId, { focused: true });
}
export async function getTabMarkdown(tabId: number): Promise<{ title: string; url: string; markdown: string } | null> {
  const t = await tabOf(tabId).catch(() => null);
  if (!t || !isWebUrl(t.url)) return null;
  return { title: t.title, url: t.url, markdown: await exec(tabId, injectedExtractMarkdown) };
}
export async function listOpenTabs(): Promise<{ id: number; title: string; url: string; favIconUrl?: string }[]> {
  const tabs = await chrome.tabs.query({});
  return tabs.map((t: { id: number; title: string; url: string; favIconUrl?: string }) => ({ id: t.id, title: t.title, url: t.url, favIconUrl: t.favIconUrl }));
}
