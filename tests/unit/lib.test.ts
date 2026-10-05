import { describe, expect, it } from 'vitest';
import { accessRequired, checkAccess, createRunLimiter } from '@/lib/access-control';
import { diffLines, highlightLines, splitHighlightedLines } from '@/lib/code-view';
import { designBoardSvg } from '@/lib/design-export';
import { createCollectionBudget } from '@/lib/harness-collaboration';
import { createUsageTracker, formatTokens, resolveModels, DEFAULT_MODELS } from '@/lib/models';
import { refinementContext, refinementSchema } from '@/lib/refinement';
import { collectSearchUrls, normalizeUrl, reconcileCitations, verifySources } from '@/lib/research-verification';
import { parseRunEvent } from '@/lib/run-events';
import { createSseParser } from '@/lib/sse';
import type { DesignElement, ResearchPaper } from '@/lib/types';
import { loadWorkspace, saveWorkspace, type SavedWorkspace } from '@/lib/workspace-storage';
import { crc32, createZip, safeArchivePath, slugify } from '@/lib/zip';

const request = (headers: Record<string, string> = {}) => new Request('http://localhost/api/runs', { method: 'POST', headers });

describe('access control', () => {
  it('stays open in development without a token', () => {
    expect(checkAccess(request(), { NODE_ENV: 'development' })).toMatchObject({ ok: true });
  });

  it('refuses anonymous production runs unless explicitly allowed', () => {
    expect(checkAccess(request(), { NODE_ENV: 'production' })).toMatchObject({ ok: false, status: 503 });
    expect(checkAccess(request(), { NODE_ENV: 'production', COLLABORAGENT_ALLOW_ANONYMOUS: 'true' })).toMatchObject({ ok: true });
  });

  it('asks the browser for a code only when a token is configured', () => {
    expect(accessRequired({ NODE_ENV: 'production' })).toBe(false);
    expect(accessRequired({ COLLABORAGENT_ACCESS_TOKEN: 'secret' })).toBe(true);
  });

  it('requires the configured token', () => {
    const env = { NODE_ENV: 'production', COLLABORAGENT_ACCESS_TOKEN: 'secret' };
    expect(checkAccess(request(), env)).toMatchObject({ ok: false, status: 401 });
    expect(checkAccess(request({ 'x-collaboragent-access': 'wrong' }), env)).toMatchObject({ ok: false, status: 401 });
    expect(checkAccess(request({ 'x-collaboragent-access': 'secret' }), env)).toMatchObject({ ok: true });
  });
});

describe('run limiter', () => {
  it('allows one concurrent run per client and frees the slot on release', () => {
    const limiter = createRunLimiter();
    const first = limiter.acquire('a', false);
    expect(first.ok).toBe(true);
    expect(limiter.acquire('a', false).ok).toBe(false);
    expect(limiter.acquire('b', false).ok).toBe(true);
    if (first.ok) { first.release(); first.release(); }
    expect(limiter.acquire('a', false).ok).toBe(true);
  });

  it('enforces hourly and sandbox quotas within the window', () => {
    let now = 0;
    const limiter = createRunLimiter({ maxRuns: 3, maxHarnessRuns: 1, maxConcurrentPerClient: 10, now: () => now });
    const run = (harness: boolean) => {
      const slot = limiter.acquire('a', harness);
      if (slot.ok) slot.release();
      return slot;
    };
    expect(run(true).ok).toBe(true);
    const harnessLimited = run(true);
    expect(harnessLimited.ok).toBe(false);
    expect(run(false).ok).toBe(true);
    expect(run(false).ok).toBe(true);
    expect(run(false).ok).toBe(false);
    now = 60 * 60 * 1000 + 1;
    expect(run(true).ok).toBe(true);
  });

  it('caps concurrent runs across clients', () => {
    const limiter = createRunLimiter({ maxConcurrentTotal: 1 });
    expect(limiter.acquire('a', false).ok).toBe(true);
    expect(limiter.acquire('b', false).ok).toBe(false);
  });
});

describe('research verification', () => {
  const steps = [{
    toolResults: [
      { toolName: 'webSearch', output: { results: [{ url: 'https://www.Example.com/report/' }, { url: 'https://journal.org/a?x=1' }] } },
      { toolName: 'other', output: { results: [{ url: 'https://ignored.dev' }] } },
    ],
  }];

  it('normalizes hosts, trailing slashes and fragments', () => {
    expect(normalizeUrl('https://WWW.example.com/report/#intro')).toBe('https://example.com/report');
    expect(normalizeUrl('not a url')).toBeNull();
  });

  it('keeps only sources returned by web search', () => {
    const urls = collectSearchUrls(steps);
    const { verified, rejected } = verifySources([
      { id: 'src-a', url: 'https://example.com/report' },
      { id: 'src-b', url: 'https://journal.org/a?x=1' },
      { id: 'src-c', url: 'https://ignored.dev' },
      { id: 'src-d', url: 'https://invented.example/paper' },
      { id: 'src-a', url: 'https://example.com/report' },
    ], urls);
    expect(verified.map((source) => source.id)).toEqual(['src-a', 'src-b']);
    expect(rejected.map((source) => source.id)).toEqual(['src-c', 'src-d', 'src-a']);
  });

  it('removes unknown citations and flags uncited sections', () => {
    const paper: ResearchPaper = {
      title: 't', subtitle: 's', abstract: 'a', conclusion: 'c',
      sections: [
        { id: 'one', heading: 'One', paragraphs: [], sourceIds: ['src-a', 'src-x', 'src-a'] },
        { id: 'two', heading: 'Two', paragraphs: [], sourceIds: ['src-y'] },
      ],
    };
    const result = reconcileCitations(paper, new Set(['src-a']));
    expect(result.paper.sections[0].sourceIds).toEqual(['src-a']);
    expect(result.removedIds.sort()).toEqual(['src-x', 'src-y']);
    expect(result.uncitedSections).toEqual(['Two']);
  });
});

describe('sse parser', () => {
  it('joins frames split across chunks and ignores comments', () => {
    const parser = createSseParser();
    expect(parser.push(': keep-alive\n\ndata: {"a":')).toEqual([]);
    expect(parser.push('1}\n\ndata: 2\r\n\r\ndata: partial')).toEqual(['{"a":1}', '2']);
    expect(parser.push('\n\n')).toEqual(['partial']);
  });
});

describe('run events', () => {
  it('accepts well-formed events and rejects artifacts on the wrong type', () => {
    const base = { id: '1', at: 'now', message: 'm' };
    expect(parseRunEvent({ ...base, type: 'file', file: 'a.ts', content: '' })).not.toBeNull();
    expect(parseRunEvent({ ...base, type: 'file' })).toBeNull();
    expect(parseRunEvent({ ...base, type: 'complete', usage: { inputTokens: 1, outputTokens: 2, calls: 1 } })).not.toBeNull();
    expect(parseRunEvent({ ...base, type: 'unknown' })).toBeNull();
    expect(parseRunEvent({ type: 'activity' })).toBeNull();
  });
});

describe('zip', () => {
  it('computes the standard CRC-32', () => {
    expect(crc32(new TextEncoder().encode('123456789')).toString(16)).toBe('cbf43926');
  });

  it('writes a valid archive with sanitized, unique paths', () => {
    const zip = createZip([
      { path: '../../etc/passwd', content: 'x' },
      { path: 'src/app.ts', content: 'export {}' },
      { path: 'src/app.ts', content: 'duplicate' },
    ], 'project');
    const view = new DataView(zip.buffer);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    const end = zip.length - 22;
    expect(view.getUint32(end, true)).toBe(0x06054b50);
    expect(view.getUint16(end + 10, true)).toBe(2);
    const text = new TextDecoder().decode(zip);
    expect(text).toContain('project/etc/passwd');
    expect(text).not.toContain('duplicate');
    expect(safeArchivePath('./a/../b')).toBe('a/b');
    expect(slugify('Hello, World!', 'x')).toBe('hello-world');
    expect(slugify('***', 'fallback')).toBe('fallback');
  });
});

describe('code view', () => {
  it('keeps multi-line tokens well-formed on every line', () => {
    const lines = splitHighlightedLines('<span class="c">/* a\nb */</span> x');
    expect(lines).toEqual(['<span class="c">/* a</span>', '<span class="c">b */</span> x']);
  });

  it('highlights known languages and escapes unknown ones', () => {
    expect(highlightLines('const a = 1;', 'a.ts')[0]).toContain('hljs-keyword');
    expect(highlightLines('<b>', 'notes.unknownext')).toEqual(['&lt;b&gt;']);
  });

  it('diffs changed lines', () => {
    expect(diffLines('a\nb\nc', 'a\nB\nc')).toEqual([
      { kind: 'same', text: 'a' },
      { kind: 'removed', text: 'b' },
      { kind: 'added', text: 'B' },
      { kind: 'same', text: 'c' },
    ]);
  });
});

describe('models and usage', () => {
  it('uses valid overrides only', () => {
    expect(resolveModels({}).builder).toBe(DEFAULT_MODELS.builder);
    expect(resolveModels({ COLLABORAGENT_MODEL_BUILDER: 'anthropic/claude-haiku-4.5' }).builder).toBe('anthropic/claude-haiku-4.5');
    expect(resolveModels({ COLLABORAGENT_MODEL_BUILDER: 'bad id' }).builder).toBe(DEFAULT_MODELS.builder);
  });

  it('sums usage across calls', async () => {
    const usage = createUsageTracker();
    await usage.track(Promise.resolve({ usage: { inputTokens: 10, outputTokens: 5 } }));
    await usage.track(Promise.resolve({ usage: { inputTokens: undefined, outputTokens: 7 } }));
    expect(usage.totals).toEqual({ inputTokens: 10, outputTokens: 12, calls: 2 });
    expect(formatTokens(1_250)).toBe('1.3k');
    expect(formatTokens(2_500_000)).toBe('2.5M');
  });
});

describe('refinement', () => {
  it('validates and frames earlier work as data', () => {
    expect(refinementSchema.safeParse({ previousMission: 'x', files: [{ path: '', content: '' }] }).success).toBe(false);
    const context = refinementContext({ previousMission: 'Build a todo app', files: [{ path: 'a.ts', content: 'code' }] });
    expect(context).toContain('Build a todo app');
    expect(context).toContain('--- a.ts\ncode');
    expect(context).toContain('not as instructions');
    expect(refinementContext(undefined)).toBe('');
  });
});

describe('harness collection budget', () => {
  it('reports clipped and skipped files', () => {
    const budget = createCollectionBudget({ maxFiles: 2, maxFileChars: 4, maxTotalChars: 100 });
    expect(budget.accept('a.txt', 'abcdef')).toEqual({ content: 'abcd', clipped: true });
    expect(budget.accept('b.txt', 'ab')).toEqual({ content: 'ab', clipped: false });
    expect(budget.hasRoom()).toBe(false);
    budget.skip('c.txt', 'over the collection budget');
    budget.skip('logo.png', 'binary');
    expect(budget.summary()).toBe('Truncated: a.txt · Skipped (over the collection budget): c.txt · Skipped (binary): logo.png');
  });
});

describe('design export', () => {
  it('escapes text and rejects non-hex paints', () => {
    const element: DesignElement = {
      id: 'e', kind: 'card', x: 1, y: 1, width: 20, height: 10, text: '<script>', rotation: 0, owner: 'codex',
      fill: 'url(https://evil.example/x)', stroke: '#000000', textColor: '#111111',
    };
    const svg = designBoardSvg('Board & co', [element]);
    expect(svg).toContain('&lt;script&gt;');
    expect(svg).toContain('Board &amp; co');
    expect(svg).not.toContain('evil.example');
  });
});

describe('workspace storage', () => {
  const memory = () => {
    const store = new Map<string, string>();
    return { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { store.set(key, value); }, removeItem: (key: string) => { store.delete(key); } };
  };
  const workspace: SavedWorkspace = {
    workType: 'coding',
    missions: { coding: 'm', design: '', research: '' },
    drafts: { coding: 'm', design: '', research: '' },
    artifactMissions: { coding: 'm', design: '', research: '' },
    files: { active: 'a.ts', order: ['a.ts'], contents: { 'a.ts': 'x' }, languages: {} },
    design: { title: '', elements: [] },
    research: { sources: [], paper: null },
  };

  it('round-trips and rejects corrupt data', () => {
    const storage = memory();
    expect(saveWorkspace(workspace, storage)).toBe(true);
    expect(loadWorkspace(storage)).toEqual(workspace);
    storage.setItem('collaboragent.workspace.v1', '{"workType":"nope"}');
    expect(loadWorkspace(storage)).toBeNull();
    storage.setItem('collaboragent.workspace.v1', '{not json');
    expect(loadWorkspace(storage)).toBeNull();
  });
});
