import { z } from 'zod';
import type { RunEvent } from '@/lib/types';
import { runLiveCollaboration } from '@/lib/live-collaboration';
import { runHarnessCollaboration } from '@/lib/harness-collaboration';
import { getExecutionCapabilities } from '@/lib/provider-config';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

const runRequest = z.object({
  prompt: z.string().trim().min(1).max(4_000),
  mode: z.enum(['live', 'harness']),
  workType: z.enum(['coding', 'design', 'research']).default('coding'),
}).strict();

export async function POST(request: Request) {
  const parsed = runRequest.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: 'Provide a prompt of 1–4,000 characters, mode live or harness, and a valid workspace type.' },
      { status: 400 },
    );
  }
  const { prompt, mode, workType } = parsed.data;
  if (mode === 'harness' && workType !== 'coding') {
    return Response.json(
      { error: 'Coding harnesses are only available in the coding workspace.' },
      { status: 400 },
    );
  }

  const capabilities = getExecutionCapabilities();
  if (mode === 'harness' ? !capabilities.codingHarnesses : !capabilities.liveModels) {
    return Response.json({ error: mode === 'harness'
      ? 'Coding agents need AI Gateway and valid Vercel Sandbox credentials. Open Provider connections for setup.'
      : 'Connect AI Gateway in Provider connections before starting the team.' }, { status: 503 });
  }

  const encoder = new TextEncoder();
  let cancelled = false;
  request.signal.addEventListener('abort', () => {
    cancelled = true;
  });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let eventIndex = 0;
      let closed = false;
      const send = (eventInput: Omit<RunEvent, 'id' | 'at' | 'mode'>) => {
        if (cancelled || closed) return;
        const payload: RunEvent = {
          ...eventInput,
          id: `evt_${Date.now()}_${eventIndex}`,
          at: new Date().toISOString(),
          mode,
          workType,
        };
        eventIndex += 1;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      };
      const heartbeat = setInterval(() => {
        if (!cancelled && !closed) controller.enqueue(encoder.encode(': keep-alive\n\n'));
      }, 10_000);

      try {
        if (mode === 'harness') {
          await runHarnessCollaboration({ prompt, signal: request.signal, emit: send });
        } else if (mode === 'live') {
          await runLiveCollaboration({ prompt, workType, signal: request.signal, emit: send });
        }
      } catch (error) {
        if (!cancelled && (error as Error).name !== 'AbortError') {
          console.error(
            'Live collaboration run failed:',
            error instanceof Error ? `${error.name}: ${error.message}` : 'Unknown error',
          );
          send({
            type: 'error',
            agentId: 'reviewer',
            status: 'reviewing',
            message: 'The real agent run could not finish',
            detail: (error as Error).name === 'AI_HarnessSandboxAuthenticationError'
              ? 'Vercel Sandbox authentication failed. Open Provider connections to refresh the server credentials. Existing artifacts have been kept.'
              : 'Check model access and gateway configuration, then retry. Existing artifacts have been kept.',
          });
        }
      } finally {
        clearInterval(heartbeat);
        if (!cancelled) {
          closed = true;
          controller.close();
        }
      }
    },
    cancel() {
      cancelled = true;
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
