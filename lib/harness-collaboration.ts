import { HarnessAgent } from '@ai-sdk/harness/agent';
import type { HarnessAgentSession } from '@ai-sdk/harness/agent';
import { createClaudeCode } from '@ai-sdk/harness-claude-code';
import { createCodex } from '@ai-sdk/harness-codex';
import { createVercelSandbox } from '@ai-sdk/sandbox-vercel';
import { getSandboxOptions } from './provider-config';
import { resolveModels } from './models';
import { gateway, Output, ToolLoopAgent } from 'ai';
import { z } from 'zod';
import type { AgentId, RunEvent } from '@/lib/types';
import type { Refinement } from '@/lib/refinement';
import { safeArchivePath } from '@/lib/zip';

const RESEARCH_MODEL = resolveModels().researcher;
const CLAUDE_PORT = 4000;
const CODEX_PORT = 4001;
const WORK_DIR = 'Collaboragent-workspace';
export const MAX_COLLECTED_FILES = 60;
export const MAX_FILE_CHARS = 48_000;
export const MAX_TOTAL_CHARS = 400_000;

/**
 * Tracks what is streamed back from the sandbox so nothing is dropped
 * silently: every file that is skipped or clipped is reported to the user.
 */
export function createCollectionBudget({
  maxFiles = MAX_COLLECTED_FILES,
  maxFileChars = MAX_FILE_CHARS,
  maxTotalChars = MAX_TOTAL_CHARS,
} = {}) {
  let totalChars = 0;
  let collected = 0;
  const clipped: string[] = [];
  const skipped: Array<{ path: string; reason: string }> = [];
  return {
    get collected() { return collected; },
    hasRoom: () => collected < maxFiles && totalChars < maxTotalChars,
    skip(path: string, reason: string) { skipped.push({ path, reason }); },
    accept(path: string, content: string) {
      const isClipped = content.length > maxFileChars;
      const kept = isClipped ? content.slice(0, maxFileChars) : content;
      if (totalChars + kept.length > maxTotalChars) {
        skipped.push({ path, reason: 'over the collection budget' });
        return null;
      }
      totalChars += kept.length;
      collected += 1;
      if (isClipped) clipped.push(path);
      return { content: kept, clipped: isClipped };
    },
    summary() {
      const parts: string[] = [];
      if (clipped.length) parts.push(`Truncated: ${clipped.join(', ')}`);
      const byReason = new Map<string, string[]>();
      for (const { path, reason } of skipped) byReason.set(reason, [...(byReason.get(reason) ?? []), path]);
      for (const [reason, paths] of byReason) {
        const shown = paths.slice(0, 12).join(', ');
        parts.push(`Skipped (${reason}): ${shown}${paths.length > 12 ? ` and ${paths.length - 12} more` : ''}`);
      }
      return parts.join(' · ');
    },
  };
}

const researchSchema = z
  .object({
    direction: z.string().max(700),
    priorities: z.array(z.string().max(220)).min(1).max(6),
  })
  .strict();

const researchAgent = new ToolLoopAgent({
  model: gateway(RESEARCH_MODEL),
  maxOutputTokens: 1400,
  output: Output.object({ schema: researchSchema, name: 'harness_research_brief' }),
  instructions:
    'You are a pragmatic UX researcher. Produce a concise implementation direction and prioritized user needs for a coding team.',
});

type HarnessEventInput = Omit<RunEvent, 'id' | 'at' | 'mode'>;
type EmitHarnessEvent = (event: HarnessEventInput) => void;

type LooseStreamPart = {
  type: string;
  toolName?: string;
  error?: unknown;
};

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof error.message === 'string'
  ) {
    return error.message;
  }
  return typeof error === 'string' ? error : 'Unknown harness error';
}

function isUnexpectedBridgeClose(error: unknown) {
  return /bridge closed before the turn finished/i.test(errorMessage(error));
}

async function destroyWithRetry(session: { destroy: () => PromiseLike<void> }) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await Promise.resolve(session.destroy());
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 1_000));
      }
    }
  }
  throw lastError;
}

function toolActivity(toolName: string) {
  const normalized = toolName.toLowerCase();
  if (normalized.includes('read')) return 'Reading the shared workspace';
  if (normalized.includes('write')) return 'Writing a project file';
  if (normalized.includes('edit') || normalized.includes('filechange')) return 'Editing a project file';
  if (normalized.includes('bash') || normalized.includes('shell')) return 'Running a workspace command';
  if (normalized.includes('glob') || normalized.includes('search')) return 'Inspecting project structure';
  return `Using ${toolName}`;
}

async function runHarnessTurn({
  agent,
  session,
  prompt,
  agentId,
  model,
  progressStart,
  progressEnd,
  signal,
  emit,
}: {
  agent: HarnessAgent;
  session: HarnessAgentSession;
  prompt: string;
  agentId: AgentId;
  model: string;
  progressStart: number;
  progressEnd: number;
  signal: AbortSignal;
  emit: EmitHarnessEvent;
}) {
  const result = await agent.stream({
    session,
    prompt,
    abortSignal: signal,
  });
  let toolEvents = 0;

  for await (const rawPart of result.fullStream) {
    const part = rawPart as LooseStreamPart;
    if (
      (part.type === 'tool-call' ||
        part.type === 'dynamic-tool-call' ||
        part.type === 'tool-result' ||
        part.type === 'dynamic-tool-result') &&
      part.toolName &&
      toolEvents < 12
    ) {
      toolEvents += 1;
      emit({
        type: 'activity',
        agentId,
        status: agentId === 'reviewer' ? 'reviewing' : 'working',
        message: toolActivity(part.toolName),
        detail: `Native ${model} tool · ${part.toolName}`,
        model,
        progress: Math.min(
          progressEnd - 1,
          progressStart + Math.round((toolEvents / 12) * (progressEnd - progressStart)),
        ),
      });
    }
    if (part.type === 'error') {
      throw new Error(`${model} failed: ${errorMessage(part.error)}`);
    }
  }

  return result.text;
}

function languageForPath(path: string) {
  const extension = path.split('.').at(-1)?.toLowerCase();
  return (
    {
      tsx: 'TypeScript React',
      ts: 'TypeScript',
      jsx: 'JavaScript React',
      js: 'JavaScript',
      css: 'CSS',
      html: 'HTML',
      json: 'JSON',
      md: 'Markdown',
      py: 'Python',
    }[extension ?? ''] ?? 'Text'
  );
}

export async function runHarnessCollaboration({
  prompt,
  refine,
  signal,
  emit,
}: {
  prompt: string;
  refine?: Refinement;
  signal: AbortSignal;
  emit: EmitHarnessEvent;
}) {
  const sandboxProvider = createVercelSandbox({
    ...getSandboxOptions(),
    runtime: 'node24',
    ports: [CLAUDE_PORT, CODEX_PORT],
    timeout: 15 * 60 * 1000,
  });
  let sandboxSession: Awaited<ReturnType<typeof sandboxProvider.createSession>> | undefined;
  let claudeSession: HarnessAgentSession | undefined;
  let codexSession: HarnessAgentSession | undefined;

  emit({
    type: 'run',
    message: 'Provisioning a shared coding sandbox',
    detail: 'Claude Code and Codex will collaborate in one isolated filesystem.',
    progress: 3,
  });

  const claudeAgent = new HarnessAgent({
    id: 'Collaboragent-claude-code',
    harness: createClaudeCode({
      auth: 'auto',
      port: CLAUDE_PORT,
      effort: 'high',
    }),
    permissionMode: 'allow-all',
    instructions:
      'You are the product architect and senior frontend engineer. Work directly in the shared sandbox. Make focused, runnable changes and leave clear notes for the next agent.',
    sandboxConfig: { workDir: WORK_DIR },
  });

  const runClaudeStage = async ({
    prompt: stagePrompt,
    agentId,
    progressStart,
    progressEnd,
  }: {
    prompt: string;
    agentId: 'claude' | 'reviewer';
    progressStart: number;
    progressEnd: number;
  }) => {
    if (!sandboxSession) throw new Error('The shared sandbox is not available.');
    let nextPrompt = stagePrompt;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        claudeSession = await claudeAgent.createSession({
          sandboxSession,
          abortSignal: signal,
        });
        await runHarnessTurn({
          agent: claudeAgent,
          session: claudeSession,
          agentId,
          model: 'Claude Code',
          progressStart,
          progressEnd,
          signal,
          emit,
          prompt: nextPrompt,
        });
        return;
      } catch (error) {
        const canRecover =
          attempt === 0 && !signal.aborted && isUnexpectedBridgeClose(error);
        if (!canRecover) throw error;
        emit({
          type: 'activity',
          agentId,
          status: agentId === 'reviewer' ? 'reviewing' : 'working',
          message: 'Claude Code is reconnecting to the shared workspace',
          detail: 'The bridge stopped unexpectedly; existing files are safe and the stage will resume once.',
          model: 'Claude Code',
          progress: Math.max(progressStart, progressEnd - 2),
        });
        nextPrompt = `A previous Claude Code process was interrupted. Inspect the existing workspace and continue the unfinished stage without recreating completed work.\n\nOriginal stage instructions:\n${stagePrompt}`;
      } finally {
        await claudeSession?.destroy();
        claudeSession = undefined;
        await sandboxSession.setRequestTransformations?.([]);
      }
    }
  };

  const codexAgent = new HarnessAgent({
    id: 'Collaboragent-codex',
    harness: createCodex({
      auth: process.env.OPENAI_API_KEY || process.env.CODEX_API_KEY ? 'direct' : 'ai-gateway',
      port: CODEX_PORT,
      reasoningEffort: 'high',
    }),
    permissionMode: 'allow-all',
    instructions:
      'You are the lead implementation engineer. Work directly in the shared sandbox, inspect the previous agent’s files, complete the product, and run practical checks. Never delete useful work without replacing it.',
    sandboxConfig: { workDir: WORK_DIR },
  });

  try {
    sandboxSession = await sandboxProvider.createSession({ abortSignal: signal });
    const seededFiles = refine?.files ?? [];
    if (seededFiles.length > 0) {
      // Follow-up runs continue the previous project instead of starting empty.
      const root = `${sandboxSession.defaultWorkingDirectory}/${WORK_DIR}`;
      for (const file of seededFiles) {
        await sandboxSession.writeTextFile({ path: `${root}/${safeArchivePath(file.path)}`, content: file.content, abortSignal: signal });
      }
      emit({
        type: 'activity',
        status: 'working',
        message: `Restored ${seededFiles.length} files from the previous run`,
        detail: 'The agents will revise the existing project for this follow-up.',
        progress: 6,
      });
    }
    const followUp = seededFiles.length > 0
      ? `\n\nThis is a follow-up to an earlier mission:\n${refine?.previousMission ?? ''}\nThe workspace already contains that project. Treat the mission above as a change request: inspect the existing files, keep what works, and revise rather than starting over.`
      : '';
    const researchResult = await researchAgent.generate({
      prompt: `Mission:\n${prompt}${followUp}\n\nGive the coding agents a focused UX direction.`,
      abortSignal: signal,
      timeout: 120_000,
    });
    const research = researchResult.output;
    emit({
      type: 'activity',
      agentId: 'gemini',
      status: 'done',
      message: 'Research brief delivered to the coding agents',
      detail: research.direction,
      model: RESEARCH_MODEL,
      progress: 12,
    });

    emit({
      type: 'agent-status',
      agentId: 'claude',
      status: 'working',
      message: 'Starting Claude Code in the shared sandbox',
      detail: 'Bootstrapping the native coding harness',
      model: 'Claude Code',
      progress: 16,
    });
    await runClaudeStage({
      agentId: 'claude',
      progressStart: 18,
      progressEnd: 42,
      prompt: `Mission:\n${prompt}${followUp}\n\nUX direction:\n${research.direction}\nPriorities:\n- ${research.priorities.join('\n- ')}\n\nPlan and create the initial runnable implementation in this workspace. Write a short PLAN.md for Codex, then build the strongest focused version you can. Keep the project compact and do not stop at a prose answer: use your file and shell tools.`,
    });
    emit({
      type: 'activity',
      agentId: 'claude',
      status: 'done',
      message: 'Claude Code completed the architecture pass',
      detail: 'The initial implementation and handoff plan are in the shared filesystem.',
      model: 'Claude Code',
      progress: 43,
      taskId: 'plan',
    });

    // Claude Code and Codex both broker credentials through request
    // transformations on the AI Gateway host. Only keep the active harness's
    // transformation so one provider's auth headers cannot leak into the next
    // provider's request. Destroying a harness session does not destroy this
    // caller-owned sandbox or its shared filesystem.
    emit({
      type: 'agent-status',
      agentId: 'codex',
      status: 'working',
      message: 'Starting Codex on Claude’s workspace',
      detail: 'Inspecting, implementing, and validating the shared project',
      model: 'Codex CLI',
      progress: 47,
      taskId: 'build',
    });
    codexSession = await codexAgent.createSession({
      sandboxSession,
      abortSignal: signal,
    });
    await runHarnessTurn({
      agent: codexAgent,
      session: codexSession,
      agentId: 'codex',
      model: 'Codex CLI',
      progressStart: 49,
      progressEnd: 76,
      signal,
      emit,
      prompt: `Mission:\n${prompt}${followUp}\n\nInspect every existing file, including PLAN.md. Take ownership of the implementation: complete missing behavior, improve the UX, fix issues, and run useful checks. Work directly on the files. Keep the result compact and runnable; do not merely describe what should be done.`,
    });
    emit({
      type: 'activity',
      agentId: 'codex',
      status: 'done',
      message: 'Codex completed the implementation pass',
      detail: 'The shared workspace now contains the integrated project.',
      model: 'Codex CLI',
      progress: 77,
      taskId: 'build',
    });

    await codexSession.destroy();
    codexSession = undefined;
    await sandboxSession.setRequestTransformations?.([]);

    emit({
      type: 'agent-status',
      agentId: 'reviewer',
      status: 'reviewing',
      message: 'Claude is reviewing Codex’s integrated changes',
      detail: 'Fixing only blocking issues and documenting the verdict',
      model: 'Claude Code',
      progress: 81,
      taskId: 'review',
    });
    await runClaudeStage({
      agentId: 'reviewer',
      progressStart: 82,
      progressEnd: 91,
      prompt:
        'Review Codex’s changes against the mission and PLAN.md. Inspect and run the project checks. Fix only genuine blocking defects directly in the files, then write REVIEW.md with the final verdict and any non-blocking follow-up.',
    });

    const restricted = sandboxSession.restricted();
    const workspacePath = `${sandboxSession.defaultWorkingDirectory}/${WORK_DIR}`;
    const listing = await restricted.run({
      command:
        "find . -type f -not -path './node_modules/*' -not -path './.git/*' -not -path './.next/*' | sed 's#^./##' | sort",
      workingDirectory: workspacePath,
      abortSignal: signal,
    });
    if (listing.exitCode !== 0) throw new Error('Could not collect the generated workspace.');

    const paths = listing.stdout
      .split('\n')
      .map((path) => path.trim())
      .filter(Boolean);
    const collection = createCollectionBudget();
    for (const path of paths) {
      if (!collection.hasRoom()) {
        collection.skip(path, 'over the collection budget');
        continue;
      }
      const content = await restricted.readTextFile({
        path: `${workspacePath}/${path}`,
        abortSignal: signal,
      });
      if (content == null || content.includes('\u0000')) {
        collection.skip(path, 'binary');
        continue;
      }
      const accepted = collection.accept(path, content);
      if (!accepted) continue;
      emit({
        type: 'file',
        agentId: 'codex',
        status: 'done',
        message: `Collected ${path}`,
        detail: `${accepted.content.split('\n').length} lines from the shared coding sandbox${accepted.clipped ? ` · truncated to ${Math.round(MAX_FILE_CHARS / 1000)} KB` : ''}`,
        file: path,
        content: accepted.content,
        language: languageForPath(path),
        model: 'Claude Code + Codex CLI',
        cursor: { line: Math.min(24, accepted.content.split('\n').length), column: 8 },
        progress: Math.min(97, 91 + collection.collected),
      });
    }

    const omissions = collection.summary();
    if (omissions) {
      emit({
        type: 'activity',
        agentId: 'codex',
        status: 'done',
        message: 'Some sandbox files were not collected in full',
        detail: omissions,
        model: 'Claude Code + Codex CLI',
        progress: 98,
      });
    }

    emit({
      type: 'complete',
      message: 'Coding harness run complete — shared project collected',
      detail: `${collection.collected} of ${paths.length} files produced by Claude Code and Codex in an isolated sandbox${omissions ? ' · see activity for omitted files' : ''}`,
      progress: 100,
      taskId: 'ship',
    });
  } finally {
    await Promise.allSettled([
      claudeSession?.destroy(),
      codexSession?.destroy(),
    ].filter((operation): operation is Promise<void> => operation != null));
    if (sandboxSession) {
      await destroyWithRetry(sandboxSession).catch((error) => {
        console.error('Could not destroy the Vercel Sandbox after three attempts:', errorMessage(error));
      });
    }
  }
}
