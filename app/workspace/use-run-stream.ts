'use client';

import { useCallback, useEffect, useRef } from 'react';
import type { Refinement } from '@/lib/refinement';
import { createSseParser } from '@/lib/sse';
import type { RunEvent, WorkType } from '@/lib/types';
import type { ExecutionMode } from './config';

export type RunRequest = {
  mission: string;
  mode: ExecutionMode;
  workType: WorkType;
  refine?: Refinement;
};

export class RunStartError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

function hasArtifact(event: RunEvent, workType: WorkType) {
  if (workType === 'coding') return event.file !== undefined;
  if (workType === 'design') return event.element !== undefined;
  return event.source !== undefined || event.paper !== undefined;
}

/**
 * Starts a run, parses its event stream and reports each event. The first
 * artifact of a run is announced separately so callers can decide whether it
 * replaces the previous output.
 */
export function useRunStream({ getAccessCode, onEvent, onFirstArtifact, onStartError }: {
  getAccessCode: () => string;
  onEvent: (event: RunEvent) => void;
  onFirstArtifact: (request: RunRequest) => void;
  onStartError: (error: RunStartError) => void;
}) {
  const controllerRef = useRef<AbortController | null>(null);
  useEffect(() => () => controllerRef.current?.abort(), []);

  const stop = useCallback(() => controllerRef.current?.abort(), []);

  const start = useCallback(async (request: RunRequest) => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const accessCode = getAccessCode();

    try {
      const response = await fetch('/api/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(accessCode ? { 'x-collaboragent-access': accessCode } : {}) },
        body: JSON.stringify({ prompt: request.mission, mode: request.mode, workType: request.workType, ...(request.refine ? { refine: request.refine } : {}) }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        const error = new RunStartError(body?.error ?? 'The team room could not start.', response.status);
        onStartError(error);
        throw error;
      }
      if (!response.body) throw new Error('The server returned no event stream.');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const parser = createSseParser();
      let firstArtifact = true;
      let terminalEvent = false;
      while (true) {
        const { value, done } = await reader.read();
        if (controller.signal.aborted) return;
        if (done) break;
        for (const data of parser.push(decoder.decode(value, { stream: true }))) {
          const runEvent = JSON.parse(data) as RunEvent;
          if (firstArtifact && hasArtifact(runEvent, request.workType)) {
            firstArtifact = false;
            onFirstArtifact(request);
          }
          onEvent(runEvent);
          if (runEvent.type === 'complete' || runEvent.type === 'error') terminalEvent = true;
        }
        if (terminalEvent) { await reader.cancel(); break; }
      }
      if (!terminalEvent) throw new Error('The stream ended before the team finished. Retry to continue working; existing artifacts have been kept.');
    } catch (error) {
      if (!controller.signal.aborted && (error as Error).name !== 'AbortError') onEvent({
        id: `error_${Date.now()}`, at: new Date().toISOString(), type: 'error', workType: request.workType,
        agentId: 'reviewer', message: 'The live stream was interrupted',
        detail: error instanceof Error ? error.message : 'Retry the run. Existing artifacts have been kept.',
      });
    }
  }, [getAccessCode, onEvent, onFirstArtifact, onStartError]);

  return { start, stop };
}
