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
