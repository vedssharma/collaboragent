import { describe, expect, it, vi } from 'vitest';
import type { RunEventInput } from '@/lib/types';

// Every agent's structured output, keyed by the output name it requests.
const outputs: Record<string, unknown> = {
  Collaboragent_architecture_plan: {
    summary: 'Plan', architecture: ['One page'],
    workstreams: [{ owner: 'codex', goal: 'Build', deliverables: ['index.html'] }], acceptanceCriteria: ['Works'],
  },
  Collaboragent_ux_research: { direction: 'Simple', userNeeds: ['Speed'], uxPrinciples: ['Clarity'], risks: [] },
  Collaboragent_design_research: { direction: 'Readable', userNeeds: ['Scan'], uxPrinciples: ['Contrast'], risks: [] },
  Collaboragent_project_artifacts: {
    summary: 'Built', decisions: ['Plain HTML'],
    files: [{ path: 'index.html', language: 'HTML', purpose: 'Page', content: '<h1>Hi</h1>' }],
  },
  Collaboragent_design_direction: { concept: 'Calm', audience: 'Patients', visualPrinciples: ['Space', 'Hierarchy'], palette: ['#112233', '#445566', '#778899'] },
  Collaboragent_design_board: {
    title: 'Board', subtitle: 'Sub', background: '#ffffff', rationale: 'Why',
    elements: Array.from({ length: 5 }, (_, index) => ({
      id: `el-${index}`, kind: 'card', x: index * 10, y: 10, width: 8, height: 8, text: `Card ${index}`,
      fill: '#ffffff', stroke: '#000000', textColor: '#111111', rotation: 0, owner: 'codex',
    })),
  },
  Collaboragent_research_outline: { thesis: 'T', researchQuestions: ['Q1', 'Q2'], sectionPlan: ['A', 'B', 'C'], evidenceStandards: ['Primary', 'Recent'] },
  Collaboragent_source_research: {
    synthesis: 'Evidence', tensions: ['Some'],
    sources: [
      { id: 'src-real-a', title: 'A', url: 'https://example.org/a', publisher: 'Org', summary: 'S' },
      { id: 'src-real-b', title: 'B', url: 'https://example.org/b', publisher: 'Org', summary: 'S' },
      { id: 'src-real-c', title: 'C', url: 'https://example.org/c', publisher: 'Org', summary: 'S' },
      { id: 'src-invented', title: 'Fake', url: 'https://invented.example/x', publisher: 'Nobody', summary: 'S' },
    ],
  },
  Collaboragent_research_paper: {
    title: 'Paper', subtitle: 'Sub', abstract: 'A'.repeat(130), conclusion: 'C'.repeat(130),
    sections: ['one', 'two', 'three'].map((id) => ({
      id, heading: id, paragraphs: ['P'.repeat(110), 'Q'.repeat(110)],
      sourceIds: id === 'three' ? ['src-invented'] : ['src-real-a'],
    })),
  },
};

const reviewCalls = new Map<string, number>();
function review(name: string) {
  // The first review of each run asks for changes; the re-review approves.
  const count = (reviewCalls.get(name) ?? 0) + 1;
  reviewCalls.set(name, count);
  return {
    verdict: count === 1 ? 'changes-requested' : 'approved', score: count === 1 ? 60 : 90, summary: 'Review',
    checks: [{ name: 'Quality', passed: count > 1, note: 'n' }], risks: [], nextStep: 'Ship',
  };
}

vi.mock('ai', async (importOriginal) => {
  const ai = await importOriginal<typeof import('ai')>();
  const { MockLanguageModelV4 } = await import('ai/test');
  const usage = {
    inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 5, text: 5, reasoning: 0 },
  };
  const model = (modelId: string) => new MockLanguageModelV4({
    modelId,
    doGenerate: async (options) => {
      const name = options.responseFormat?.type === 'json' ? options.responseFormat.name ?? '' : '';
      const searched = options.prompt.some((message) => message.role === 'tool');
      if (name === 'Collaboragent_source_research' && !searched) {
        return {
          content: [{ type: 'tool-call', toolCallId: 'search-1', toolName: 'webSearch', input: JSON.stringify({ query: 'topic' }) }],
          finishReason: { unified: 'tool-calls', raw: undefined }, usage, warnings: [],
        };
      }
      const output = name.endsWith('_review') ? review(name) : outputs[name];
      if (!output) throw new Error(`No mock output for ${name}`);
      return { content: [{ type: 'text', text: JSON.stringify(output) }], finishReason: { unified: 'stop', raw: undefined }, usage, warnings: [] };
    },
  });
  const webSearch = ai.tool({
    inputSchema: (await import('zod')).z.object({ query: (await import('zod')).z.string() }),
    execute: async () => ({
      id: 'search',
      results: ['a', 'b', 'c'].map((slug) => ({ title: slug, url: `https://example.org/${slug}`, snippet: '' })),
    }),
  });
  return { ...ai, gateway: Object.assign(model, { tools: { perplexitySearch: () => webSearch } }) };
});

async function run(workType: 'coding' | 'design' | 'research') {
  const { runLiveCollaboration } = await import('@/lib/live-collaboration');
  const events: RunEventInput[] = [];
  await runLiveCollaboration({ prompt: 'Mission', workType, signal: new AbortController().signal, emit: (event) => events.push(event) });
  return events;
}

describe('live pipelines with mocked models', () => {
  it('coding: builds, revises after review and reports usage', async () => {
    const events = await run('coding');
    expect(events[0].type).toBe('run');
    expect(events.filter((event) => event.type === 'file').map((event) => event.message)).toEqual(['Created index.html', 'Revised index.html']);
    expect(events.some((event) => event.resetArtifacts)).toBe(true);
    const complete = events.at(-1)!;
    expect(complete.type).toBe('complete');
    expect(complete.detail).toContain('revised once after review');
    // architect, researcher, builder, review, revision, re-review
    expect(complete.usage).toEqual({ inputTokens: 60, outputTokens: 30, calls: 6 });
  });

  it('design: replaces the draft board with the revision', async () => {
    const events = await run('design');
    const resetIndex = events.findIndex((event) => event.resetArtifacts);
    expect(resetIndex).toBeGreaterThan(0);
    expect(events.slice(resetIndex).filter((event) => event.type === 'canvas')).toHaveLength(5);
    expect(events.at(-1)?.type).toBe('complete');
  });

  it('research: drops invented sources and citations', async () => {
    const events = await run('research');
    const sources = events.flatMap((event) => event.type === 'source' ? [event.source.id] : []);
    expect(sources).toEqual(['src-real-a', 'src-real-b', 'src-real-c']);
    expect(events.some((event) => event.message.startsWith('Discarded 1 source'))).toBe(true);
    const papers = events.flatMap((event) => event.type === 'paper' ? [event.paper] : []);
    expect(papers.length).toBe(2);
    for (const paper of papers) {
      expect(paper.sections.flatMap((section) => section.sourceIds)).not.toContain('src-invented');
    }
    expect(events.some((event) => event.message === 'Citation check found unsupported references')).toBe(true);
    expect(events.at(-1)?.type).toBe('complete');
  });

  it('stops when the run is aborted', async () => {
    const { runLiveCollaboration } = await import('@/lib/live-collaboration');
    const controller = new AbortController();
    controller.abort();
    await expect(runLiveCollaboration({ prompt: 'x', workType: 'coding', signal: controller.signal, emit: () => undefined }))
      .rejects.toThrow('Run cancelled');
  });
});
