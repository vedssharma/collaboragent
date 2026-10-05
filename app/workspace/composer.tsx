'use client';

import { ArrowUp, Check, Code2, Command, Layers, Palette, Radio, Search, Users } from 'lucide-react';
import type { WorkType } from '@/lib/types';
import { WORK_CONFIG, type ExecutionMode } from './config';

export function Composer({ workType, draft, onDraftChange, open, onOpen, onSubmit, canSubmit, executionMode, canToggleMode, onToggleMode, canRefine, refineEnabled, onToggleRefine, agentCount }: {
  workType: WorkType;
  draft: string;
  onDraftChange: (value: string) => void;
  open: boolean;
  onOpen: () => void;
  onSubmit: () => void;
  canSubmit: boolean;
  executionMode: ExecutionMode;
  canToggleMode: boolean;
  onToggleMode: () => void;
  canRefine: boolean;
  refineEnabled: boolean;
  onToggleRefine: () => void;
  agentCount: number;
}) {
  const config = WORK_CONFIG[workType];
  return (
    <section className={`composer-card ${open ? 'expanded' : ''}`}><form onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
      <div className="composer-avatar"><Command size={15} /></div><textarea aria-label={`Give the ${config.label.toLowerCase()} team a task`} value={draft} maxLength={4000} rows={open ? 3 : 1} onFocus={onOpen} onChange={(event) => onDraftChange(event.target.value)} onKeyDown={(event) => {
        if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
          event.preventDefault();
          event.currentTarget.form?.requestSubmit();
        }
      }} placeholder={config.placeholder} />
      <div className="composer-controls">
        {workType === 'coding' ? <button type="button" className={`mode-chip ${executionMode}`} aria-label="Toggle real agent execution" aria-pressed={executionMode === 'harness'} disabled={!canToggleMode} onClick={onToggleMode}>{executionMode === 'harness' ? <Code2 size={11} /> : <Radio size={11} />}{executionMode === 'harness' ? 'Coding agents' : 'Model team'}</button> : <span className={`mode-chip ${workType}`}>{workType === 'design' ? <Palette size={11} /> : <Search size={11} />}{workType === 'design' ? 'Design agents' : 'Research agents'}</span>}
        {canRefine && <button type="button" className={`refine-chip ${refineEnabled ? 'active' : ''}`} aria-pressed={refineEnabled} onClick={onToggleRefine} title="Send the current result with this request so the team revises it instead of starting over">{refineEnabled ? <Check size={11} /> : <Layers size={11} />}Build on result</button>}
        <span className="team-chip"><Users size={12} /> {agentCount} agents</span><button type="submit" className="send-button" aria-label="Start team run" disabled={!canSubmit}><ArrowUp size={16} /></button>
      </div></form>{open && <p><span>Enter</span> to send · Shift+Enter for a new line</p>}</section>
  );
}
