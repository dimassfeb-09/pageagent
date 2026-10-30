// defuddle-lite: original-code-free page-to-markdown extraction.
// Picks <article>/<main>/largest content block, drops boilerplate, converts
// headings, paragraphs, links, lists, images and tables to markdown.
export function extractMarkdownFromDocument(doc: Document): string {
  const clone = doc.cloneNode(true) as Document;
  const root = clone.documentElement;
  root.querySelectorAll('script, style, nav, header, footer, aside, form, noscript, iframe, svg').forEach((n) => n.remove());
  let main: Element | null = clone.querySelector('article') || clone.querySelector('main');
  if (!main) {
    let best: Element | null = null; let bestLen = 0;
    clone.querySelectorAll('div, section').forEach((el) => {
      const len = (el.textContent || '').trim().length;
      if (len > bestLen) { bestLen = len; best = el; }
    });
    main = best || clone.body;
  }
  const lines: string[] = [];
  const walk = (el: Element, depth: number): void => {
    for (const child of Array.from(el.children)) {
      const tag = child.tagName.toLowerCase();
      const text = (child.textContent || '').replace(/\s+/g, ' ').trim();
      if (!text && tag !== 'img' && tag !== 'table') continue;
      if (/^h[1-6]$/.test(tag)) lines.push(`${'#'.repeat(Number(tag[1]))} ${text}`);
      else if (tag === 'p') lines.push(text);
      else if (tag === 'a') { const href = child.getAttribute('href'); lines.push(href ? `[${text}](${href})` : text); }
      else if (tag === 'img') { const src = child.getAttribute('src'); const alt = child.getAttribute('alt') || ''; if (src) lines.push(`![${alt}](${src})`); }
      else if (tag === 'li') lines.push(`${'  '.repeat(depth)}- ${text}`);
      else if (tag === 'table') {
        child.querySelectorAll('tr').forEach((tr, i) => {
          const cells = Array.from(tr.querySelectorAll('th, td')).map((c) => (c.textContent || '').replace(/\s+/g, ' ').trim());
          if (cells.length) { lines.push(`| ${cells.join(' | ')} |`); if (i === 0) lines.push(`| ${cells.map(() => '---').join(' | ')} |`); }
        });
      } else walk(child, tag === 'ul' || tag === 'ol' ? depth + 1 : depth);
    }
  };
  walk(main, 0);
  const title = clone.querySelector('title')?.textContent?.trim();
  const out = [title ? `# ${title}` : '', ...lines].filter(Boolean).join('\n\n');
  return out.slice(0, 120000);
}
// Injected-page version (self-contained: no imports, safe to pass to executeScript).
export function injectedExtractMarkdown(): string {
  const doc = document;
  const clone = doc.cloneNode(true) as Document;
  clone.querySelectorAll('script, style, nav, header, footer, aside, form, noscript, iframe, svg').forEach((n) => n.remove());
  let main: Element | null = clone.querySelector('article') || clone.querySelector('main');
  if (!main) {
    let best: Element | null = null; let bestLen = 0;
    clone.querySelectorAll('div, section').forEach((el) => {
      const len = (el.textContent || '').trim().length;
      if (len > bestLen) { bestLen = len; best = el; }
    });
    main = best || clone.body;
  }
  const lines: string[] = [];
  const walk = (el: Element, depth: number): void => {
    for (const child of Array.from(el.children)) {
      const tag = child.tagName.toLowerCase();
      const text = (child.textContent || '').replace(/\s+/g, ' ').trim();
      if (!text && tag !== 'img' && tag !== 'table') continue;
      if (/^h[1-6]$/.test(tag)) lines.push('#'.repeat(Number(tag[1])) + ' ' + text);
      else if (tag === 'p') lines.push(text);
      else if (tag === 'a') { const href = child.getAttribute('href'); lines.push(href ? '[' + text + '](' + href + ')' : text); }
      else if (tag === 'img') { const src = child.getAttribute('src'); const alt = child.getAttribute('alt') || ''; if (src) lines.push('![' + alt + '](' + src + ')'); }
      else if (tag === 'li') lines.push('  '.repeat(depth) + '- ' + text);
      else walk(child, tag === 'ul' || tag === 'ol' ? depth + 1 : depth);
    }
  };
  if (main) walk(main, 0);
  const title = clone.querySelector('title')?.textContent?.trim();
  return [title ? '# ' + title : '', ...lines].filter(Boolean).join('\n\n').slice(0, 120000);
}
