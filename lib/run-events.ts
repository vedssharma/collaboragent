import { z } from 'zod';
import type { DesignElement, ResearchPaper, ResearchSource } from './types';

/**
 * The run event protocol shared by the server pipelines, the browser and the
 * tests. Artifact payloads only travel on their own event type, and the
 * browser validates every event before applying it.
 */

const agentId = z.enum(['claude', 'codex', 'gemini', 'reviewer']);
const hexOrCss = z.string().max(40);

const designElementSchema: z.ZodType<DesignElement> = z.object({
  id: z.string().max(80),
  kind: z.enum(['frame', 'card', 'circle', 'text', 'sticky', 'connector', 'icon', 'badge']),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  text: z.string(),
  fill: hexOrCss,
  stroke: hexOrCss,
  textColor: hexOrCss,
  rotation: z.number(),
  owner: agentId,
});

const researchSourceSchema: z.ZodType<ResearchSource> = z.object({
  id: z.string(),
  title: z.string(),
  url: z.string().url(),
  publisher: z.string(),
  publishedAt: z.string().optional(),
  summary: z.string(),
});

const researchPaperSchema: z.ZodType<ResearchPaper> = z.object({
  title: z.string(),
  subtitle: z.string(),
  abstract: z.string(),
  sections: z.array(z.object({
    id: z.string(),
    heading: z.string(),
    paragraphs: z.array(z.string()),
    sourceIds: z.array(z.string()),
  })),
  conclusion: z.string(),
});

const baseFields = {
  id: z.string(),
  at: z.string(),
  mode: z.enum(['live', 'harness']).optional(),
  workType: z.enum(['coding', 'design', 'research']).optional(),
  agentId: agentId.optional(),
  status: z.enum(['queued', 'thinking', 'working', 'reviewing', 'done']).optional(),
  message: z.string(),
  detail: z.string().optional(),
  model: z.string().optional(),
  progress: z.number().min(0).max(100).optional(),
  taskId: z.string().optional(),
  cursor: z.object({ line: z.number(), column: z.number() }).optional(),
  checks: z.object({ passed: z.number(), total: z.number() }).optional(),
  /** Token totals for the run's model calls, reported on completion. */
  usage: z.object({ inputTokens: z.number(), outputTokens: z.number(), calls: z.number() }).optional(),
  /** Clears this workspace's artifacts before the events that follow replace them. */
  resetArtifacts: z.boolean().optional(),
};

export const runEventSchema = z.discriminatedUnion('type', [
  z.object({
    ...baseFields,
    type: z.literal('file'),
    file: z.string().min(1),
    content: z.string().optional(),
    language: z.string().optional(),
  }),
  z.object({ ...baseFields, type: z.literal('canvas'), element: designElementSchema, designTitle: z.string().optional() }),
  z.object({ ...baseFields, type: z.literal('source'), source: researchSourceSchema }),
  z.object({ ...baseFields, type: z.literal('paper'), paper: researchPaperSchema }),
  z.object({ ...baseFields, type: z.enum(['run', 'agent-status', 'activity', 'task', 'complete', 'error']) }),
]);

export type RunEvent = z.infer<typeof runEventSchema>;
export type RunEventType = RunEvent['type'];

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** What a pipeline emits; the route adds id, timestamp and mode. */
export type RunEventInput = DistributiveOmit<RunEvent, 'id' | 'at' | 'mode'>;

export function parseRunEvent(value: unknown) {
  const parsed = runEventSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
