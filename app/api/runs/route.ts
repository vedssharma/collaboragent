import type { RunEvent, WorkType } from '@/lib/types';
import { runLiveCollaboration } from '@/lib/live-collaboration';
import { runHarnessCollaboration } from '@/lib/harness-collaboration';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    prompt?: unknown;
    mode?: unknown;
    workType?: unknown;
  };
  const prompt =
    typeof body.prompt === 'string' && body.prompt.trim()
      ? body.prompt.trim().slice(0, 4_000)
      : 'Turn this product idea into a working collaborative agent workspace.';
  if (body.mode !== 'harness' && body.mode !== 'live') {
    return Response.json(
      { error: 'A real execution mode is required: live or harness.' },
      { status: 400 },
    );
  }
  const mode = body.mode;
  const workType: WorkType =
    body.workType === 'design' || body.workType === 'research' || body.workType === 'coding'
      ? body.workType
      : 'coding';
  if (mode === 'harness' && workType !== 'coding') {
    return Response.json(
      { error: 'Coding harnesses are only available in the coding workspace.' },
      { status: 400 },
    );
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
          if (!process.env.VERCEL_OIDC_TOKEN) {
            send({
              type: 'error',
              message: 'Coding harness execution is not configured',
              detail: 'Add VERCEL_OIDC_TOKEN, then restart the server.',
            });
          } else {
            await runHarnessCollaboration({ prompt, signal: request.signal, emit: send });
          }
        } else if (mode === 'live') {
          if (!process.env.AI_GATEWAY_API_KEY && !process.env.VERCEL_OIDC_TOKEN) {
            send({
              type: 'error',
              message: 'Live execution is not configured',
              detail: 'Add AI_GATEWAY_API_KEY or VERCEL_OIDC_TOKEN, then restart the server.',
            });
          } else {
            await runLiveCollaboration({ prompt, workType, signal: request.signal, emit: send });
          }
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
            detail: 'Check model access and gateway configuration, then try again. No workspace files were changed.',
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
