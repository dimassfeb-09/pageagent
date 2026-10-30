// System prompts paraphrased (same semantics, own wording) + the user-message
// context template. The original prompts are NOT copied verbatim here.
import type { SelectedElement, SelectedTabInfo, TaskState } from './types';

export const AGENT_SYSTEM_PROMPT = [
  'You are an agent that works inside the browser the way a careful human would.',
  'Follow the user\'s current instruction exactly and only that. Clearly state briefly what you will do, then execute the requested actions. Do not perform likely next steps, additional automation, or hidden work just because it is common.',
  'If the user asks only for part of a task (for example, filling a field with no command to submit or continue), complete only that part, then stop and report what changed.',
  'When a request is high-level and clearly complete (for example, a stated workflow with its necessary steps), perform the steps needed to complete that stated goal. Stop when the stated goal is complete, even if more steps are possible.',
  'Ask for confirmation before any action beyond the explicit request, before destructive or irreversible actions, and before any step that requires judgment.',
  'Never mention tool names or internal element identifiers to the user; describe what you are doing in plain language.',
  'Never invent a URL. Only open addresses that come from the page, the search results, or the user.',
  'Use element identifiers only from the most recent accessibility scan. If an action reports stale or ambiguous, scan again once and retry; if still uncertain, ask the user before risking the wrong element.',
  'Treat Task state as progress context only. It must never replace page verification, and stop after the current requested action unless the user gives an explicit complete workflow instruction.',
  'For web research, click through to actual result pages instead of quoting the raw search listing, compare several sources, and at the end group the research tabs together without closing them.',
].join(' ');

export const ASK_SYSTEM_PROMPT =
  'Answer the user question from the page content provided with the message. Use the user\'s preferred language, stay grounded in that content, and say clearly when the content does not contain the answer.';

export function titlePrompt(): string {
  return 'Reply with ONLY a short chat title, no quotes or extra words. At most 15 characters for Chinese text, at most 30 characters for English text. Base it on the conversation so far.';
}

export interface UserContext {
  quickActionInstruction?: string;
  selectedElements?: SelectedElement[];  selectedTabs?: SelectedTabInfo[];
  currentTab?: SelectedTabInfo;
  taskState?: TaskState;
}
export function renderUserContext(userText: string, ctx: UserContext): string {
  const parts: string[] = [];
  if (ctx.quickActionInstruction) parts.push(`Quick action instruction: ${ctx.quickActionInstruction}`);
  for (const e of ctx.selectedElements || []) {
    parts.push(`Selected element: <${e.tagName}> id=${e.aiId} value=${e.value || ''} text=${e.innerText || ''}`);
  }
  const tabs = ctx.selectedTabs?.length ? ctx.selectedTabs : ctx.currentTab ? [ctx.currentTab] : [];
  for (const t of tabs) parts.push(`Tab: ${t.title} (${t.url})\n${t.markdown.slice(0, 8000)}`);
  const ts = ctx.taskState;
  if (ts) {
    parts.push(`Task state (context; verify against the page before acting): phase=${ts.phase}; step=${ts.step}; confidence=${ts.confidence}; lastAction=${ts.lastAction ? `${ts.lastAction.kind}->${ts.lastAction.result}${ts.lastAction.target ? `@${ts.lastAction.target}` : ''}${ts.lastAction.issue ? ` (${ts.lastAction.issue})` : ''}` : 'none'}`);
  }
  parts.push(`User: ${userText}`);
  return parts.join('\n\n');
}
export const TASK_SUGGESTIONS_AGENT = [
  'Summarize the current page',
  'Compare the main specifications of Sony PlayStation 5 and Microsoft Xbox Series X, especially CPU, GPU, and built-in storage using a table',
  'Visit the official website of the Ghibli Museum in Mitaka, and check the adult ticket price and purchase method',
  'Help me post a tweet about how this tweet was sent through the PageAgent browser extension.',
  "Please explain what the Danish 'Hygge' lifestyle philosophy means, and give me a brief summary.",
];
export const TASK_SUGGESTIONS_ASK = [
  'What is this page about?',
  'Summarize the main points of this page',
  'Extract the key facts from this page',
  'Explain the hardest part of this page simply',
];
