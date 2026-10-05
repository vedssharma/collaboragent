import type { ResearchPaper, ResearchSource } from './types';

type LooseToolResult = { toolName?: string; output?: unknown };
type LooseStep = { toolResults?: readonly LooseToolResult[] };

/** Canonical form used only for comparison; the returned sources keep their original URL. */
export function normalizeUrl(value: string) {
  try {
    const url = new URL(value);
    url.hash = '';
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
    const path = url.pathname.replace(/\/+$/, '');
    return `${url.protocol}//${url.host}${path}${url.search}`;
  } catch {
    return null;
  }
}

/** Collects every URL the web-search tool actually returned during a run. */
export function collectSearchUrls(steps: readonly LooseStep[], toolName = 'webSearch') {
  const urls = new Set<string>();
  for (const step of steps) {
    for (const result of step.toolResults ?? []) {
      if (result.toolName !== toolName) continue;
      const output = result.output as { results?: Array<{ url?: unknown }> } | undefined;
      for (const item of output?.results ?? []) {
        if (typeof item.url !== 'string') continue;
        const normalized = normalizeUrl(item.url);
        if (normalized) urls.add(normalized);
      }
    }
  }
  return urls;
}

/**
 * Keeps only sources whose URL came back from the search tool. The model is
 * told never to invent URLs; this enforces it instead of trusting it.
 */
export function verifySources<T extends Pick<ResearchSource, 'id' | 'url'>>(sources: readonly T[], searchUrls: ReadonlySet<string>) {
  const verified: T[] = [];
  const rejected: T[] = [];
  const seen = new Set<string>();
  for (const source of sources) {
    const normalized = normalizeUrl(source.url);
    if (!normalized || !searchUrls.has(normalized) || seen.has(source.id)) rejected.push(source);
    else {
      seen.add(source.id);
      verified.push(source);
    }
  }
  return { verified, rejected };
}

/** Drops citations to sources outside the verified packet and reports what changed. */
export function reconcileCitations(paper: ResearchPaper, sourceIds: ReadonlySet<string>) {
  const removedIds = new Set<string>();
  const uncitedSections: string[] = [];
  const sections = paper.sections.map((section) => {
    const kept = section.sourceIds.filter((id) => {
      if (sourceIds.has(id)) return true;
      removedIds.add(id);
      return false;
    });
    const unique = [...new Set(kept)];
    if (unique.length === 0) uncitedSections.push(section.heading);
    return { ...section, sourceIds: unique };
  });
  return { paper: { ...paper, sections }, removedIds: [...removedIds], uncitedSections };
}
