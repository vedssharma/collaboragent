import { z } from 'zod';
import type { DesignElement, ResearchPaper, ResearchSource, WorkType } from './types';

const STORAGE_KEY = 'collaboragent.workspace.v1';
// Stay well inside the ~5 MB per-origin localStorage budget.
const MAX_BYTES = 2_000_000;

const byWorkType = <T extends z.ZodType>(schema: T) => z.object({ coding: schema, design: schema, research: schema });

const savedWorkspaceSchema = z.object({
  workType: z.enum(['coding', 'design', 'research']),
  missions: byWorkType(z.string()),
  drafts: byWorkType(z.string()),
  artifactMissions: byWorkType(z.string()),
  files: z.object({
    active: z.string(),
    order: z.array(z.string()),
    contents: z.record(z.string(), z.string()),
    languages: z.record(z.string(), z.string()),
  }),
  design: z.object({ title: z.string(), elements: z.array(z.custom<DesignElement>((value) => typeof value === 'object' && value !== null && 'id' in value)) }),
  research: z.object({
    sources: z.array(z.custom<ResearchSource>((value) => typeof value === 'object' && value !== null && 'url' in value)),
    paper: z.custom<ResearchPaper>((value) => typeof value === 'object' && value !== null && 'sections' in value).nullable(),
  }),
});

export type SavedWorkspace = z.infer<typeof savedWorkspaceSchema> & { workType: WorkType };

export function loadWorkspace(storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage): SavedWorkspace | null {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = savedWorkspaceSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Returns false when the workspace could not be saved (storage blocked or too large). */
export function saveWorkspace(workspace: SavedWorkspace, storage: Pick<Storage, 'setItem'> | undefined = globalThis.localStorage) {
  try {
    const serialized = JSON.stringify(workspace);
    if (serialized.length > MAX_BYTES || !storage) return false;
    storage.setItem(STORAGE_KEY, serialized);
    return true;
  } catch {
    return false;
  }
}

export function clearWorkspace(storage: Pick<Storage, 'removeItem'> | undefined = globalThis.localStorage) {
  try { storage?.removeItem(STORAGE_KEY); } catch { /* nothing saved */ }
}
