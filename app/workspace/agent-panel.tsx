'use client';

import { Settings, Zap } from 'lucide-react';
import type { AgentId, AgentView, WorkType } from '@/lib/types';
import { formatStatus, type RunState } from './config';

export function AgentAvatar({ agent, small = false }: { agent: AgentView; small?: boolean }) {
  return (
    <span className={`agent-avatar ${small ? 'agent-avatar-small' : ''}`}
      style={{ background: agent.softColor, color: agent.color, borderColor: `${agent.color}35` }} aria-label={agent.name}>
      {agent.monogram}<span className="avatar-status" style={{ background: agent.color }} />
    </span>
  );
}

export function AgentPanel({ agents, workType, runState, selectedAgent, onSelectAgent, liveAvailable, harnessAvailable, configuredProviders, onOpenConnections }: {
  agents: AgentView[];
  workType: WorkType;
  runState: RunState;
  selectedAgent: AgentId;
  onSelectAgent: (id: AgentId) => void;
  liveAvailable: boolean;
  harnessAvailable: boolean;
  configuredProviders: number;
  onOpenConnections: () => void;
}) {
  const harnessReady = workType === 'coding' && harnessAvailable;
  return (
    <aside className="agent-panel">
      <div className="panel-heading"><div><p className="eyebrow">COLLABORATORS</p><h2>Agent room</h2></div></div>
      <div className="room-status"><span className="pulse-dot" />{runState === 'running' ? 'Team is collaborating' : runState === 'complete' ? 'Team is ready for review' : 'Team is standing by'}</div>
      <div className="agent-list">{agents.map((agent) => (
        <button key={agent.id} className={`agent-card ${selectedAgent === agent.id ? 'selected' : ''}`} onClick={() => onSelectAgent(agent.id)}>
          <AgentAvatar agent={agent} /><span className="agent-card-copy">
            <span className="agent-name-row"><strong>{agent.name}</strong><span className={`status-label ${agent.status}`}>{formatStatus(agent.status, workType)}</span></span>
            <span className="agent-role">{agent.role} · {agent.provider}</span><span className="agent-task">{agent.task}</span>
            <span className="mini-progress"><span style={{ width: `${agent.progress}%`, background: agent.color }} /></span>
          </span>
        </button>
      ))}</div>
      <div className="connection-card">
        <div className="connection-title"><span><Zap size={14} /> Provider connections</span><button aria-label="Configure providers" onClick={onOpenConnections}><Settings size={13} /></button></div>
        <div className="connection-row"><span className="provider-symbol claude-symbol">C</span><span>Claude</span><em>{harnessReady ? 'Configured' : liveAvailable ? 'Live model' : 'Needs key'}</em></div>
        <div className="connection-row"><span className="provider-symbol codex-symbol">O</span><span>Codex</span><em>{harnessReady ? 'Configured' : liveAvailable ? 'Live model' : 'Needs key'}</em></div>
        <p>{harnessReady ? 'Sandbox credentials configured; access checked on run' : liveAvailable ? `Model connection configured · ${configuredProviders} providers routed` : 'Connect a provider to run agents'}</p>
      </div>
    </aside>
  );
}
