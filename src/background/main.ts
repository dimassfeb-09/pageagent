// Background service worker: serves the "ai-stream" port.
// - sendMessages: streams an OpenAI-compatible chat/completions call, and
//   when the model emits tool_calls it asks the sidepanel to execute them,
//   feeds results back, and loops (max 100 steps, AbortController = Stop).
// - generateTitle: same model, non-streaming title only.
// - abort: cancels the in-flight run.
import { streamChat, isQuotaError, type LlmMessage, type ToolDef } from '../lib/llm';

interface ModelRef { provider: string; modelId: string; baseUrl: string; apiKey?: string }

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true }).catch(() => undefined);
});
chrome.action?.onClicked.addListener((tab: { id?: number; windowId?: number }) => {
  if (tab.windowId !== undefined) chrome.sidePanel?.open({ windowId: tab.windowId }).catch(() => undefined);
});

// --- Presence keep-alive (opt-in, "Tetap aktif" toggle in the panel) -------
// The content script pings us every ~1.5s while the toggle is on. We keep a
// chrome.debugger session attached to that tab and dispatch a tiny trusted
// mouse move (Input.dispatchMouseEvent). Unlike synthetic DOM events, CDP
// input is trusted (isTrusted === true), so isTrusted-based idle detectors
// see real activity. Costs: Chrome shows a "PageAgent is debugging this
// tab" infobar while attached, and attach fails while DevTools is open on
// the tab (reported back, retried after 10s).
const presenceDebug: { lastPingAt: string | null; lastError: string; attachedTabs: number[]; emulation: { focus: boolean; lifecycle: boolean } } = { lastPingAt: null, lastError: '', attachedTabs: [], emulation: { focus: false, lifecycle: false } };
(globalThis as unknown as Record<string, unknown>).__pageagentPresence = presenceDebug;
const presenceTabs = new Set<number>();
const presenceAttachFailedAt = new Map<number, number>();
const presenceEmulation = new Map<number, { focus: boolean; lifecycle: boolean; lastApplied: number }>();
chrome.debugger?.onDetach?.addListener((source: { tabId?: number }) => {
  if (source.tabId !== undefined) {
    presenceTabs.delete(source.tabId); presenceEmulation.delete(source.tabId); presenceDebug.attachedTabs = [...presenceTabs];
    if (presenceTabs.size === 0) presenceDebug.emulation = { focus: false, lifecycle: false };
  }
});
// Keep a debugged tab out of Chrome's idle lifecycle: focus emulation makes
// hasFocus-gated work keep running in a background tab, and forcing the
// lifecycle state to "active" keeps the tab from being frozen/discarded.
// Applied on attach and re-applied at most every 10s (a navigation can land
// the new document back in a throttled state). Each command is best-effort:
// Page.setWebLifecycleState is experimental and may not exist on every
// Chrome build — a missing command must never break the mouse jitter.
async function ensurePresenceEmulation(tabId: number): Promise<void> {
  const now = Date.now();
  const st = presenceEmulation.get(tabId) ?? { focus: false, lifecycle: false, lastApplied: 0 };
  if (now - st.lastApplied < 10_000) return;
  st.lastApplied = now;
  try { await chrome.debugger.sendCommand({ tabId }, 'Emulation.setFocusEmulationEnabled', { enabled: true }); st.focus = true; }
  catch { st.focus = false; }
  try { await chrome.debugger.sendCommand({ tabId }, 'Page.setWebLifecycleState', { state: 'active' }); st.lifecycle = true; }
  catch { st.lifecycle = false; }
  presenceEmulation.set(tabId, st);
  presenceDebug.emulation = { focus: st.focus, lifecycle: st.lifecycle };
}
chrome.runtime.onMessage.addListener((msg: { type?: string; x?: number; y?: number }, sender: { tab?: { id?: number } }, sendResponse: (r: unknown) => void) => {
  if (msg?.type === 'presence-ping') { void handlePresencePing(msg, sender, sendResponse); return true; }
  if (msg?.type === 'presence-stop') {
    const id = sender.tab?.id;
    if (id !== undefined) {
      presenceTabs.delete(id); presenceEmulation.delete(id); presenceDebug.attachedTabs = [...presenceTabs];
      if (presenceTabs.size === 0) presenceDebug.emulation = { focus: false, lifecycle: false };
      // Best-effort restore: stop emulating focus so the tab behaves normally.
      void chrome.debugger.sendCommand({ tabId: id }, 'Emulation.setFocusEmulationEnabled', { enabled: false }).catch(() => undefined);
      void chrome.debugger.detach({ tabId: id }).catch(() => undefined);
    }
    sendResponse({ ok: true });
    return false;
  }
  return false;
});
async function handlePresencePing(msg: { x?: number; y?: number }, sender: { tab?: { id?: number } }, sendResponse: (r: unknown) => void) {
  const tabId = sender.tab?.id;
  if (tabId === undefined) { sendResponse({ ok: false, error: 'no-tab' }); return; }
  const x = Math.round(msg.x ?? 0), y = Math.round(msg.y ?? 0);
  const dispatch = () => chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', clickCount: 0 });
  try {
    if (!presenceTabs.has(tabId)) {
      const failedAt = presenceAttachFailedAt.get(tabId) ?? 0;
      if (Date.now() - failedAt < 10_000) { sendResponse({ ok: false, error: 'attach-backoff' }); return; }
      await chrome.debugger.attach({ tabId }, '1.3');
      presenceTabs.add(tabId); presenceDebug.attachedTabs = [...presenceTabs];
      await ensurePresenceEmulation(tabId);
    } else {
      await ensurePresenceEmulation(tabId);
    }
    try { await dispatch(); }
    catch {
      // Session died (e.g. service worker restarted): re-attach once.
      presenceTabs.delete(tabId);
      await chrome.debugger.attach({ tabId }, '1.3');
      presenceTabs.add(tabId); presenceDebug.attachedTabs = [...presenceTabs];
      await ensurePresenceEmulation(tabId);
      await dispatch();
    }
    presenceDebug.lastPingAt = new Date().toISOString(); presenceDebug.lastError = '';
    sendResponse({ ok: true });
  } catch (e) {
    presenceTabs.delete(tabId); presenceDebug.attachedTabs = [...presenceTabs];
    presenceAttachFailedAt.set(tabId, Date.now());
    const err = e instanceof Error ? e.message : 'attach-failed';
    presenceDebug.lastError = err;
    sendResponse({ ok: false, error: err });
  }
}

chrome.runtime.onConnect.addListener((port: any) => {
  if (port.name !== 'ai-stream') return;
  let controller: AbortController | null = null;
  const waiting = new Map<string, (result: unknown) => void>();
  port.onMessage.addListener((msg: { type?: string; [k: string]: unknown }) => {
    if (msg.type === 'tool-result' && typeof msg.id === 'string') {
      waiting.get(msg.id)?.(msg.result); waiting.delete(msg.id);
    }
    if (msg.type === 'abort') controller?.abort();
    if (msg.type === 'generateTitle') void handleTitle(msg, port);
    if (msg.type === 'sendMessages') void handleChat(msg, port);
  });
  port.onDisconnect.addListener(() => controller?.abort());

  async function handleTitle(msg: { [k: string]: unknown }, port: { postMessage: (m: unknown) => void }) {
    const model = msg.model as ModelRef;
    const messages = msg.messages as LlmMessage[];
    const ctl = new AbortController();
    let title = '';
    for await (const ev of streamChat({ baseUrl: model.baseUrl, apiKey: model.apiKey, model: model.modelId, messages, signal: ctl.signal })) {
      if (ev.kind === 'text' && ev.text) title += ev.text;
      if (ev.kind === 'error') { port.postMessage({ type: 'title-error', error: ev.error }); return; }
    }
    port.postMessage({ type: 'title', title: title.trim().slice(0, 60) });
  }

  async function handleChat(msg: { [k: string]: unknown }, port: { postMessage: (m: unknown) => void }) {
    const model = msg.model as ModelRef;
    const tools = msg.tools as ToolDef[] | undefined;
    const history = [...(msg.messages as LlmMessage[])];
    controller = new AbortController();
    const signal = controller.signal;
    try {
      for (let step = 0; step < 100; step++) {
        if (signal.aborted) { port.postMessage({ type: 'aborted' }); return; }
        let text = ''; let reasoning = ''; let madeToolCall = false;
        const toolCalls: { id: string; name: string; args: Record<string, unknown> }[] = [];
        let streamError: { error: string; status?: number } | null = null;
        for await (const ev of streamChat({ baseUrl: model.baseUrl, apiKey: model.apiKey, model: model.modelId, messages: history, tools, signal })) {
          if (ev.kind === 'reasoning' && ev.text) { reasoning += ev.text; port.postMessage({ type: 'reasoning', text: ev.text }); }
          if (ev.kind === 'text' && ev.text) { text += ev.text; port.postMessage({ type: 'text', text: ev.text }); }
          if (ev.kind === 'tool-call' && ev.name) { madeToolCall = true; toolCalls.push({ id: ev.id || `call-${step}`, name: ev.name, args: ev.args || {} }); }
          if (ev.kind === 'error') { streamError = { error: ev.error || 'error', status: ev.status }; break; }
        }
        if (streamError) {
          const se = streamError as { error: string; status?: number };
          if (se.status !== undefined && isQuotaError(se.status, se.error)) port.postMessage({ type: 'error', code: 'QUOTA_EXCEEDED', error: se.error });
          else port.postMessage({ type: 'error', error: se.error });
          return;
        }
        if (!madeToolCall) { port.postMessage({ type: 'done', text }); return; }
        history.push({ role: 'assistant', content: text || null, reasoning_content: reasoning || undefined, tool_calls: toolCalls.map((c) => ({ id: c.id, type: 'function' as const, function: { name: c.name, arguments: JSON.stringify(c.args) } })) });
        for (const call of toolCalls) {
          port.postMessage({ type: 'tool-call', id: call.id, name: call.name, args: call.args });
          const result = await new Promise<unknown>((resolve) => {
            waiting.set(call.id, resolve);
            // If the port dies, unblock with an error so the worker never hangs.
            const timer = setTimeout(() => { waiting.delete(call.id); resolve({ error: 'sidepanel disconnected' }); }, 120_000);
            const orig = waiting.get(call.id);
            waiting.set(call.id, (r) => { clearTimeout(timer); orig?.(r); });
          });
          if (signal.aborted) { port.postMessage({ type: 'aborted' }); return; }
          history.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
          port.postMessage({ type: 'tool-done', id: call.id, result });
        }
      }
      port.postMessage({ type: 'max-steps' });
    } catch (e) {
      if ((e as Error).name !== 'AbortError') port.postMessage({ type: 'error', error: e instanceof Error ? e.message : 'unknown error' });
      else port.postMessage({ type: 'aborted' });
    }
  }
});
