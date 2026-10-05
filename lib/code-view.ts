import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import css from 'highlight.js/lib/languages/css';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import markdown from 'highlight.js/lib/languages/markdown';
import python from 'highlight.js/lib/languages/python';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';

hljs.registerLanguage('bash', bash);
hljs.registerLanguage('css', css);
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('json', json);
hljs.registerLanguage('markdown', markdown);
hljs.registerLanguage('python', python);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('yaml', yaml);

const EXTENSIONS: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  css: 'css', scss: 'css', html: 'xml', htm: 'xml', svg: 'xml', xml: 'xml',
  json: 'json', md: 'markdown', py: 'python', sh: 'bash', bash: 'bash',
  yml: 'yaml', yaml: 'yaml',
};

const MAX_HIGHLIGHT_CHARS = 120_000;

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]!);
}

export function languageForFile(path: string) {
  return EXTENSIONS[path.split('.').at(-1)?.toLowerCase() ?? ''];
}

/**
 * Splits highlighted HTML into per-line fragments, closing and reopening
 * spans that cross line breaks so every line is well-formed on its own.
 */
export function splitHighlightedLines(html: string) {
  const lines: string[] = [];
  const open: string[] = [];
  let current = '';
  const tagPattern = /<span[^>]*>|<\/span>|\n|[^<\n]+|</g;
  for (const match of html.matchAll(tagPattern)) {
    const token = match[0];
    if (token === '\n') {
      lines.push(current + '</span>'.repeat(open.length));
      current = open.join('');
    } else if (token.startsWith('<span')) {
      open.push(token);
      current += token;
    } else if (token === '</span>') {
      open.pop();
      current += token;
    } else {
      current += token;
    }
  }
  lines.push(current + '</span>'.repeat(open.length));
  return lines;
}

/** Returns one HTML string per source line. Output is escaped by highlight.js or here. */
export function highlightLines(content: string, path: string) {
  const language = languageForFile(path);
  if (!language || content.length > MAX_HIGHLIGHT_CHARS) return content.split('\n').map(escapeHtml);
  try {
    return splitHighlightedLines(hljs.highlight(content, { language, ignoreIllegals: true }).value);
  } catch {
    return content.split('\n').map(escapeHtml);
  }
}

export type DiffLine = { kind: 'same' | 'added' | 'removed'; text: string };

const MAX_DIFF_CELLS = 4_000_000;

/** Line diff by longest common subsequence; returns null when the files are too large to diff. */
export function diffLines(before: string, after: string): DiffLine[] | null {
  const a = before.split('\n');
  const b = after.split('\n');
  // Trim the shared prefix and suffix so typical edits stay cheap.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA -= 1; endB -= 1; }
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  if ((midA.length + 1) * (midB.length + 1) > MAX_DIFF_CELLS) return null;

  const width = midB.length + 1;
  const table = new Uint32Array((midA.length + 1) * width);
  for (let i = midA.length - 1; i >= 0; i -= 1) {
    for (let j = midB.length - 1; j >= 0; j -= 1) {
      table[i * width + j] = midA[i] === midB[j]
        ? table[(i + 1) * width + j + 1] + 1
        : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
    }
  }
  const middle: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < midA.length && j < midB.length) {
    if (midA[i] === midB[j]) { middle.push({ kind: 'same', text: midA[i] }); i += 1; j += 1; }
    else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) { middle.push({ kind: 'removed', text: midA[i] }); i += 1; }
    else { middle.push({ kind: 'added', text: midB[j] }); j += 1; }
  }
  while (i < midA.length) { middle.push({ kind: 'removed', text: midA[i] }); i += 1; }
  while (j < midB.length) { middle.push({ kind: 'added', text: midB[j] }); j += 1; }

  return [
    ...a.slice(0, start).map((text) => ({ kind: 'same' as const, text })),
    ...middle,
    ...a.slice(endA).map((text) => ({ kind: 'same' as const, text })),
  ];
}
