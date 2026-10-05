'use client';

import { Activity, BookOpen, ChevronRight, Clock3, FileCode2, Play, RotateCcw, Square } from 'lucide-react';
import { formatTokens } from '@/lib/models';
import type { AgentView, RunEvent } from '@/lib/types';
import { AgentAvatar } from './agent-panel';
import { relativeTime, type RunState } from './config';

export function ActivityPanel({ activity, agents, runState, canToggle, onToggleRun, summary, usage, onSelectFile }: {
  activity: RunEvent[];
  agents: AgentView[];
  runState: RunState;
  canToggle: boolean;
  onToggleRun: () => void;
  summary: Array<{ label: string; value: string | number }>;
  usage?: RunEvent['usage'];
  onSelectFile: (path: string) => void;
}) {
  const toggleLabel = runState === 'running' ? 'Stop run' : runState === 'idle' ? 'Start run' : 'Retry run';
  return (
    <aside className="activity-panel">
      <div className="activity-heading"><div><p className="eyebrow">OBSERVABILITY</p><h2>Live activity</h2></div><button className={`run-toggle ${runState}`} onClick={onToggleRun} title={toggleLabel} aria-label={toggleLabel} disabled={!canToggle}>{runState === 'running' ? <Square size={13} /> : runState === 'idle' ? <Play size={14} /> : <RotateCcw size={14} />}</button></div>
      <div className="summary-strip">{summary.map(({ label, value }) => <div key={label}><strong>{value}</strong><span>{label}</span></div>)}</div>
      <div className="activity-feed">{activity.length === 0 && <div className="empty-activity"><Activity size={20} /><strong>No agent activity yet</strong><span>Plans, searches, edits, and reviews will stream here.</span></div>}
        {activity.map((item, index) => {
          const agent = agents.find((candidate) => candidate.id === item.agentId);
          return <article className="activity-item" key={item.id}><div className="timeline-column">{agent ? <AgentAvatar agent={agent} small /> : <span className="system-event"><Activity size={13} /></span>}{index < activity.length - 1 && <span className="timeline-line" />}</div><div className="activity-copy"><div className="activity-meta"><strong>{agent?.name ?? 'Collaboragent'}</strong>{item.model && <em>{item.model.split('/').at(-1)}</em>}<span>{relativeTime(item)}</span></div><p>{item.message}</p>{item.detail && <small>{item.detail}</small>}{item.type === 'file' && <button className="file-change" onClick={() => onSelectFile(item.file)}><FileCode2 size={12} />{item.file}<ChevronRight size={11} /></button>}{item.type === 'source' && <a className="file-change source-change" href={item.source.url} target="_blank" rel="noreferrer"><BookOpen size={12} />{item.source.publisher}<ChevronRight size={11} /></a>}</div></article>;
        })}
      </div><div className="activity-footer"><Clock3 size={13} /> {usage ? `${formatTokens(usage.inputTokens)} in · ${formatTokens(usage.outputTokens)} out · ${usage.calls} model calls` : 'Events are streamed as they happen'}</div>
    </aside>
  );
}
