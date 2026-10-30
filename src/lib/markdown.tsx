// Markdown renderer producing the Chatspace message structure:
// .message-text with <p>/<ul>/<li>/<strong>/<em>/<code>, and fenced code as
// .code-block > .code-head (language + copy button) + <pre><code>.
// Deliberately no shiki/mermaid — see README. Written from scratch.
import React, { useState } from 'react';
import { Copy } from 'lucide-react';

function inline(text: string, keyPrefix: string): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g);
  return parts.map((p, i) => {
    if (p.startsWith('**') && p.endsWith('**')) return <strong key={`${keyPrefix}-${i}`}>{p.slice(2, -2)}</strong>;
    if (p.startsWith('*') && p.endsWith('*') && p.length > 2) return <em key={`${keyPrefix}-${i}`}>{p.slice(1, -1)}</em>;
    if (p.startsWith('`') && p.endsWith('`')) return <code key={`${keyPrefix}-${i}`}>{p.slice(1, -1)}</code>;
    const m = p.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (m) return <a key={`${keyPrefix}-${i}`} href={m[2]} target="_blank" rel="noreferrer">{m[1]}</a>;
    return <React.Fragment key={`${keyPrefix}-${i}`}>{p}</React.Fragment>;
  });
}

export function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(code); } catch { /* clipboard unavailable */ }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="code-block">
      <div className="code-head">
        <span>{lang || 'code'}</span>
        <button type="button" className="icon-btn copy-code" title={copied ? 'Copied' : 'Copy code'} aria-label={copied ? 'Copied' : 'Copy code'} onClick={copy}>
          <Copy size={14} />
        </button>
      </div>
      <pre><code>{code}</code></pre>
    </div>
  );
}

const splitCells = (line: string) => line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
const isSepRow = (line: string) => /^\|?[\s:|-]+\|?$/.test(line.trim()) && line.includes('-');

export const Markdown = React.memo(function Markdown({ text }: { text: string }): React.ReactElement {
  const blocks: React.ReactNode[] = [];
  const lines = text.split('\n');
  let i = 0; let inCode = false; let codeBuf: string[] = []; let codeLang = '';
  const flushCode = () => { blocks.push(<CodeBlock key={`code-${blocks.length}`} lang={codeLang} code={codeBuf.join('\n')} />); codeBuf = []; codeLang = ''; };
  while (i < lines.length) {
    const line = lines[i];
    const fence = line.trim().match(/^```(\S*)\s*$/);
    if (fence) { if (inCode) { flushCode(); inCode = false; } else { inCode = true; codeLang = fence[1] || ''; } i++; continue; }
    if (inCode) { codeBuf.push(line); i++; continue; }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { blocks.push(React.createElement(`h${h[1].length}`, { key: `h-${i}` }, inline(h[2], `h${i}`))); i++; continue; }
    if (/^\s*[-*]\s+/.test(line)) { const items: string[] = []; while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*[-*]\s+/, '')); i++; } blocks.push(<ul key={`ul-${i}`}>{items.map((it, j) => <li key={j}>{inline(it, `li${i}-${j}`)}</li>)}</ul>); continue; }
    if (/^\s*\d+[.)]\s+/.test(line)) { const items: string[] = []; while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*\d+[.)]\s+/, '')); i++; } blocks.push(<ol key={`ol-${i}`}>{items.map((it, j) => <li key={j}>{inline(it, `oli${i}-${j}`)}</li>)}</ol>); continue; }
    if (line.trim().startsWith('|') && i + 1 < lines.length && isSepRow(lines[i + 1])) {
      const header = splitCells(line); const rows: string[][] = []; i += 2;
      while (i < lines.length && lines[i].trim().startsWith('|')) { rows.push(splitCells(lines[i])); i++; }
      blocks.push(
        <table key={`tbl-${i}`}>
          <thead><tr>{header.map((c, j) => <th key={j}>{inline(c, `th${i}-${j}`)}</th>)}</tr></thead>
          <tbody>{rows.map((r, ri) => <tr key={ri}>{header.map((_, j) => <td key={j}>{inline(r[j] ?? '', `td${i}-${ri}-${j}`)}</td>)}</tr>)}</tbody>
        </table>,
      );
      continue;
    }
    if (/^[-*_]{3,}\s*$/.test(line.trim())) { blocks.push(<hr key={`hr-${i}`} />); i++; continue; }
    if (line.trim().startsWith('>')) { const q: string[] = []; while (i < lines.length && lines[i].trim().startsWith('>')) { q.push(lines[i].trim().replace(/^>\s?/, '')); i++; } blocks.push(<blockquote key={`bq-${i}`}>{q.map((qLine, qi) => <p key={qi} style={{ margin: '4px 0' }}>{inline(qLine, `bq-${i}-${qi}`)}</p>)}</blockquote>); continue; }
    blocks.push(<p key={i}>{inline(line, `p${i}`)}</p>); i++;
  }
  if (inCode) flushCode();
  return <div className="message-text">{blocks}</div>;
});
