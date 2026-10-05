'use client';

import { Check, CheckCircle2, Code2, PenTool, Search, ShieldCheck, Sparkles, Trash2, WandSparkles } from 'lucide-react';
import type { WorkType } from '@/lib/types';
import { RUN_LABELS, WORK_CONFIG, type RunState } from './config';

// Progress at which each task becomes active and done.
const ACTIVE_AT = [6, 18, 60, 97];
const DONE_AT = [73, 82, 96, 100];

export function MissionCard({ workType, mission, runState, progress, canClear, onClear }: {
  workType: WorkType;
  mission: string;
  runState: RunState;
  progress: number;
  canClear: boolean;
  onClear: () => void;
}) {
  const config = WORK_CONFIG[workType];
  const taskIcons = [Sparkles, workType === 'design' ? PenTool : workType === 'research' ? Search : Code2, ShieldCheck, CheckCircle2];
  return (
    <section className="mission-card">
      <div className="mission-topline"><div className="mission-icon"><WandSparkles size={17} /></div><div className="mission-copy">
        <div className="mission-label-row"><span>{config.eyebrow}</span><span className="mission-status"><span /> {runState === 'running' ? 'In progress' : RUN_LABELS[runState].mission}</span></div>
        <h1>{mission || config.emptyMission}</h1>
      </div><button className="more-button" aria-label="Clear workspace" title="Clear this workspace" disabled={!canClear} onClick={onClear}><Trash2 size={16} /></button></div>
      <div className="mission-progress-row"><div className="large-progress"><span style={{ width: `${progress}%` }} /></div><strong>{progress}%</strong></div>
      <div className="task-flow">{config.tasks.map((label, index) => {
        const TaskIcon = taskIcons[index];
        const state = progress >= DONE_AT[index] ? 'done' : progress >= ACTIVE_AT[index] ? 'active' : 'waiting';
        return <div className="task-flow-item" key={label}><div className={`task-node ${state}`}>{state === 'done' ? <Check size={13} /> : <TaskIcon size={13} />}</div><span>{label}</span>{index < 3 && <div className={`task-connector ${progress >= DONE_AT[index] ? 'filled' : ''}`} />}</div>;
      })}</div>
    </section>
  );
}
