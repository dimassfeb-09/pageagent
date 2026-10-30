// One OpenAI-compatible chat/completions client (streaming SSE + tool_calls).
// Gemini uses Google's OpenAI-compatible endpoint, so no second client is needed.
export interface LlmMessage { role: string; content: string | null | Array<{ type: string; text?: string; image_url?: { url: string } }>; reasoning_content?: string; tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[]; tool_call_id?: string; name?: string }
export interface ToolDef { type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } }
export interface StreamEvent {
  kind: 'text' | 'reasoning' | 'tool-call' | 'error' | 'done';
  text?: string; name?: string; id?: string; args?: Record<string, unknown>; error?: string; status?: number;
}
export const isQuotaError = (status: number, text: string) =>
  status === 429 || /quota|rate limit|insufficient/i.test(text);

export async function* streamChat(opts: {
  baseUrl: string; apiKey?: string; model: string; messages: LlmMessage[]; tools?: ToolDef[]; signal: AbortSignal;
}): AsyncGenerator<StreamEvent> {
  const url = `${opts.baseUrl.replace(/\/$/, '')}/chat/completions`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.apiKey) headers.Authorization = `Bearer ${opts.apiKey}`;
  const body = JSON.stringify({ model: opts.model, messages: opts.messages, tools: opts.tools, stream: true, temperature: 0.3 });
  let res: Response | null = null;
  let lastError = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    if (opts.signal.aborted) { yield { kind: 'error', error: 'aborted' }; return; }
    try {
      res = await fetch(url, { method: 'POST', headers, signal: opts.signal, body });
    } catch (e) {
      lastError = e instanceof Error ? e.message : 'network error';
      if (attempt < 2) { await new Promise((r) => setTimeout(r, 300 * (attempt + 1))); continue; }
      yield { kind: 'error', error: lastError }; return;
    }
    if (res.ok && res.body) break;
    const text = await res.text().catch(() => '');
    lastError = text.slice(0, 500) || `HTTP ${res.status}`;
    if ((res.status === 429 || res.status >= 500) && attempt < 2) {
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
      res = null; continue;
    }
    yield { kind: 'error', error: lastError, status: res.status }; return;
  }
  if (!res || !res.body) { yield { kind: 'error', error: lastError || 'no response' }; return; }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  const pending: Record<number, { id: string; name: string; args: string }> = {};
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, idx); buf = buf.slice(idx + 2);
        for (const line of chunk.split('\n')) {
          const data = line.startsWith('data:') ? line.slice(5).trim() : '';
          if (!data || data === '[DONE]') continue;
          let json: { choices?: { delta?: { content?: string; reasoning_content?: string; reasoning?: string; tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[] }; finish_reason?: string }[] };
          try { json = JSON.parse(data); } catch { continue; }
          const delta = json.choices?.[0]?.delta;
          const reasoning = delta?.reasoning_content ?? delta?.reasoning;
          if (reasoning) yield { kind: 'reasoning', text: reasoning };
          if (delta?.content) yield { kind: 'text', text: delta.content };
          for (const tc of delta?.tool_calls ?? []) {
            const slot = (pending[tc.index] ??= { id: '', name: '', args: '' });
            if (tc.id) slot.id = tc.id;
            if (tc.function?.name) slot.name = tc.function.name;
            if (tc.function?.arguments) slot.args += tc.function.arguments;
          }
          if (json.choices?.[0]?.finish_reason === 'tool_calls') {
            for (const slot of Object.values(pending)) {
              let args: Record<string, unknown> = {};
              try { args = JSON.parse(slot.args || '{}'); } catch { /* keep {} */ }
              yield { kind: 'tool-call', id: slot.id, name: slot.name, args };
            }
          }
        }
      }
    }
  } catch (e) {
    if ((e as Error).name !== 'AbortError') yield { kind: 'error', error: e instanceof Error ? e.message : 'stream error' };
  }
  yield { kind: 'done' };
}
export const TOOL_DEFS: ToolDef[] = [
  { type: 'function', function: { name: 'openNewTabWithURL', description: 'Open a URL in a new tab and wait for it to finish loading.', parameters: { type: 'object', properties: { url: { type: 'string' }, reason: { type: 'string' } }, required: ['url'] } } },
  { type: 'function', function: { name: 'getTabContent', description: 'Extract markdown content from tabs.', parameters: { type: 'object', properties: { tabIds: { type: 'array', items: { type: 'number' } } }, required: ['tabIds'] } } },
  { type: 'function', function: { name: 'findAccessableElementsFromTab', description: 'List clickable/input elements of a tab with ai-ids.', parameters: { type: 'object', properties: { tabId: { type: 'number' } }, required: ['tabId'] } } },
  { type: 'function', function: { name: 'clickElementByAiID', description: 'Click the element with the given ai-id only when the user explicitly asked to click that element or its implied page action is a stated goal. Never use for an unstated next step; ask the user first.', parameters: { type: 'object', properties: { id: { type: 'string' }, tabId: { type: 'number' } }, required: ['id', 'tabId'] } } },
  { type: 'function', function: { name: 'inputTextByAiID', description: 'Type the requested text into the element with the given ai-id only for the field the user asked to fill. Do not click, submit, or continue with further page actions unless explicitly requested; ask first.', parameters: { type: 'object', properties: { id: { type: 'string' }, tabId: { type: 'number' }, text: { type: 'string' } }, required: ['id', 'tabId', 'text'] } } },
  { type: 'function', function: { name: 'waitTabLoadFinished', description: 'Wait until a tab finishes loading.', parameters: { type: 'object', properties: { tabId: { type: 'number' } }, required: ['tabId'] } } },
  { type: 'function', function: { name: 'closeTab', description: 'Close tabs.', parameters: { type: 'object', properties: { tabIds: { type: 'array', items: { type: 'number' } } }, required: ['tabIds'] } } },
  { type: 'function', function: { name: 'getElementPropertiesByAiID', description: 'Read src/href/value of elements by ai-id.', parameters: { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' } }, tabId: { type: 'number' } }, required: ['ids', 'tabId'] } } },
  { type: 'function', function: { name: 'insertCSSToTab', description: 'Insert CSS into a tab.', parameters: { type: 'object', properties: { tabId: { type: 'number' }, css: { type: 'string' } }, required: ['tabId', 'css'] } } },
  { type: 'function', function: { name: 'removeCSSToTab', description: 'Remove previously inserted CSS from a tab.', parameters: { type: 'object', properties: { tabId: { type: 'number' }, css: { type: 'string' } }, required: ['tabId', 'css'] } } },
  { type: 'function', function: { name: 'groupTabs', description: 'Group tabs under a title and color.', parameters: { type: 'object', properties: { tabIds: { type: 'array', items: { type: 'number' } }, title: { type: 'string' }, color: { type: 'string' } }, required: ['tabIds', 'title'] } } },
  { type: 'function', function: { name: 'getAllTabs', description: 'List all open tabs (id and title).', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'scrollToBottom', description: 'Smooth-scroll a tab to the bottom.', parameters: { type: 'object', properties: { tabId: { type: 'number' } }, required: ['tabId'] } } },
  { type: 'function', function: { name: 'openSearchTab', description: 'Open a browser search results tab.', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } } },
  { type: 'function', function: { name: 'downloadTabToMarkdown', description: 'Download a tab as a markdown file.', parameters: { type: 'object', properties: { tabId: { type: 'number' } }, required: ['tabId'] } } },
  { type: 'function', function: { name: 'downloadAllImagesInTab', description: 'Download all images of a tab as a ZIP file.', parameters: { type: 'object', properties: { tabId: { type: 'number' } }, required: ['tabId'] } } },
  { type: 'function', function: { name: 'getBrowserHistory', description: 'Read browser history (requires the history permission).', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'displayTaskReport', description: 'Show the final task report to the user.', parameters: { type: 'object', properties: {} } } },
];
