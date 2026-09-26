import { marked } from 'marked';
import DOMPurify from 'dompurify';

marked.setOptions({ gfm: true, breaks: true });

const KNOWN_LANG = new Set(['diff', 'bash', 'sh', 'json']);

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function highlightDiff(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      const esc = escapeHtml(line);
      if (line.startsWith('+') && !line.startsWith('+++')) return `<span class="md-diff-add">${esc}</span>`;
      if (line.startsWith('-') && !line.startsWith('---')) return `<span class="md-diff-del">${esc}</span>`;
      return esc;
    })
    .join('\n');
}

function highlightJson(text: string): string {
  const re = /("(?:\\.|[^"\\])*")(\s*:)?/g;
  let out = '';
  let last = 0;
  for (const match of text.matchAll(re)) {
    const index = match.index ?? 0;
    out += escapeHtml(text.slice(last, index));
    const word = escapeHtml(match[1] ?? '');
    out += match[2] ? `<span class="md-key">${word}</span>${match[2]}` : `<span class="md-str">${word}</span>`;
    last = index + match[0].length;
  }
  return out + escapeHtml(text.slice(last));
}

function highlightBash(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      const hash = line.indexOf('#');
      if (hash >= 0 && (hash === 0 || line[hash - 1] === ' ')) {
        return `${escapeHtml(line.slice(0, hash))}<span class="md-comment">${escapeHtml(line.slice(hash))}</span>`;
      }
      return escapeHtml(line);
    })
    .join('\n');
}

function highlight(lang: string, text: string): string {
  if (lang === 'diff') return highlightDiff(text);
  if (lang === 'json') return highlightJson(text);
  if (lang === 'bash' || lang === 'sh') return highlightBash(text);
  return escapeHtml(text);
}

function renderCode(text: string, lang: string): string {
  if (lang === 'mermaid') {
    return `<div class="md-mermaid"><pre class="md-mermaid-src">${escapeHtml(text)}</pre></div>`;
  }
  const label = KNOWN_LANG.has(lang) ? lang : lang;
  const head = label ? `<div class="md-code-lang">${escapeHtml(label)}</div>` : '';
  return `<div class="md-codeblock">${head}<pre class="md-code"><code>${highlight(lang, text)}</code></pre></div>`;
}

marked.use({
  renderer: {
    code({ text, lang }) {
      return renderCode(text, (lang || '').trim().toLowerCase());
    }
  }
});

/** 流式过程中最后一个没闭合的围栏先当源码，不交给 Mermaid。 */
function splitOpenFence(text: string): { done: string; pending: string } {
  let openAt = -1;
  let open = false;
  let i = 0;
  while (i < text.length) {
    const at = text.indexOf('```', i);
    if (at < 0) break;
    if (!open) {
      open = true;
      openAt = at;
    } else {
      open = false;
      openAt = -1;
    }
    i = at + 3;
  }
  if (open && openAt >= 0) return { done: text.slice(0, openAt), pending: text.slice(openAt) };
  return { done: text, pending: '' };
}

export function renderChatMarkdown(text: string): string {
  const { done, pending } = splitOpenFence(text || '');
  const html = marked.parse(done, { async: false }) as string;
  const tail = pending ? `<pre class="md-code md-pending"><code>${escapeHtml(pending)}</code></pre>` : '';
  return DOMPurify.sanitize(html + tail, { USE_PROFILES: { html: true } });
}
