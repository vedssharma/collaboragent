'use client';

import {
  Activity, ArrowUp, BookOpen, Bot, Check, ChevronDown, ChevronRight, CircleDot,
  Clock3, Code2, Command, FileCode2, Files, GitBranch, LayoutGrid, Library,
  MessageSquareText, MoreHorizontal, Palette, PanelLeftClose, Pause, PenTool,
  Play, Plus, Radio, Search, Settings, ShieldCheck, Sparkles, Users,
  WandSparkles, X, Zap, CheckCircle2,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { DesignCanvas } from '@/app/design-canvas';
import { ResearchPaper } from '@/app/research-paper';
import { downloadDesignBoard } from '@/lib/design-export';
import { ProviderConnections, type ConnectionSetup } from '@/app/provider-connections';
import type {
  AgentId, AgentView, DesignElement, ResearchPaper as ResearchPaperType,
  ResearchSource, RunEvent, WorkType,
} from '@/lib/types';

const ACCESS_STORAGE_KEY = 'collaboragent.access-code';

const AGENT_IDENTITIES = {
  claude: { name: 'Claude', provider: 'Anthropic', monogram: 'C', color: '#d36b4c', softColor: '#fff1eb' },
  codex: { name: 'Codex', provider: 'OpenAI', monogram: 'O', color: '#177c69', softColor: '#eaf8f4' },
  gemini: { name: 'Gemini', provider: 'Google', monogram: 'G', color: '#5a6ee8', softColor: '#edf0ff' },
  reviewer: { name: 'Sentinel', provider: 'Collaboragent', monogram: 'S', color: '#9a6b26', softColor: '#fff6df' },
} as const;

const WORK_CONFIG = {
  coding: {
    label: 'Coding', title: 'Code workspace', eyebrow: 'BUILD MODE', icon: Code2,
    emptyMission: 'Describe the product or code you want the team to build.',
    placeholder: 'Build a dashboard for tracking customer feedback…',
    roles: ['Product architect', 'Lead engineer', 'UX researcher', 'Quality reviewer'],
    waiting: ['Waiting for the brief', 'Ready in shared workspace', 'Waiting for research scope', 'Watching the merge queue'],
    tasks: ['Plan approach', 'Build workspace', 'Review & test', 'Ready to ship'],
  },
  design: {
    label: 'Design', title: 'Design canvas', eyebrow: 'CANVAS MODE', icon: Palette,
    emptyMission: 'Describe the visual, diagram, or board you want the team to create.',
    placeholder: 'Create a service blueprint for a neighborhood clinic…',
    roles: ['Creative director', 'Visual designer', 'Design researcher', 'Design critic'],
    waiting: ['Waiting for the visual brief', 'Ready at the canvas', 'Studying the audience', 'Preparing the critique'],
    tasks: ['Set direction', 'Compose canvas', 'Critique design', 'Ready to share'],
  },
  research: {
    label: 'Research', title: 'Research studio', eyebrow: 'RESEARCH MODE', icon: BookOpen,
    emptyMission: 'Enter a topic for the team to investigate and turn into a sourced paper.',
    placeholder: 'Research how AI is changing entry-level knowledge work…',
    roles: ['Principal investigator', 'Research writer', 'Source researcher', 'Research editor'],
    waiting: ['Waiting for the topic', 'Ready to synthesize evidence', 'Ready to search the web', 'Preparing the review desk'],
    tasks: ['Frame inquiry', 'Find sources', 'Write paper', 'Ready to publish'],
  },
} as const;

const AGENT_IDS: AgentId[] = ['claude', 'codex', 'gemini', 'reviewer'];

function baseAgents(workType: WorkType): AgentView[] {
  return AGENT_IDS.map((id, index) => ({
    id, ...AGENT_IDENTITIES[id], role: WORK_CONFIG[workType].roles[index],
    status: 'queued', task: WORK_CONFIG[workType].waiting[index], progress: 0,
  }));
}

type RunState = 'idle' | 'running' | 'paused' | 'complete';
type ExecutionMode = 'live' | 'harness';

function formatStatus(status: AgentView['status'], workType: WorkType) {
  if (status === 'thinking') return workType === 'research' ? 'Scoping' : 'Planning';
  if (status === 'working') return workType === 'design' ? 'Designing' : workType === 'research' ? 'Researching' : 'Building';
  if (status === 'reviewing') return 'Reviewing';
  if (status === 'done') return 'Complete';
  return 'Queued';
}

function relativeTime(event: RunEvent) {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(event.at).getTime()) / 1000));
  return seconds < 4 ? 'now' : `${seconds}s`;
}

function AgentAvatar({ agent, small = false }: { agent: AgentView; small?: boolean }) {
  return (
    <span className={`agent-avatar ${small ? 'agent-avatar-small' : ''}`}
      style={{ background: agent.softColor, color: agent.color, borderColor: `${agent.color}35` }} aria-label={agent.name}>
      {agent.monogram}<span className="avatar-status" style={{ background: agent.color }} />
    </span>
  );
}

export default function Home() {
  const [workType, setWorkType] = useState<WorkType>('coding');
  const [missions, setMissions] = useState<Record<WorkType, string>>({ coding: '', design: '', research: '' });
  const [drafts, setDrafts] = useState<Record<WorkType, string>>({ coding: '', design: '', research: '' });
  const [agents, setAgents] = useState(() => baseAgents('coding'));
  const [selectedAgent, setSelectedAgent] = useState<AgentId>('codex');
  const [activity, setActivity] = useState<RunEvent[]>([]);
  const [progress, setProgress] = useState(0);
  const [checks, setChecks] = useState<RunEvent['checks']>();
  const [runState, setRunState] = useState<RunState>('idle');
  const [activeFile, setActiveFile] = useState('');
  const [changedFiles, setChangedFiles] = useState<string[]>([]);
  const [fileContents, setFileContents] = useState<Record<string, string>>({});
  const [fileLanguages, setFileLanguages] = useState<Record<string, string>>({});
  const [lastCursor, setLastCursor] = useState<{ agentId: AgentId; line: number; column: number } | null>(null);
  const [designElements, setDesignElements] = useState<DesignElement[]>([]);
  const [designTitle, setDesignTitle] = useState('');
  const [researchSources, setResearchSources] = useState<ResearchSource[]>([]);
  const [researchPaper, setResearchPaper] = useState<ResearchPaperType | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [configuredProviders, setConfiguredProviders] = useState(0);
  const [connectionsOpen, setConnectionsOpen] = useState(false);
  const [connectionSetup, setConnectionSetup] = useState<ConnectionSetup | null>(null);
  const [connectionsLoading, setConnectionsLoading] = useState(true);
  const [liveAvailable, setLiveAvailable] = useState(false);
  const [harnessAvailable, setHarnessAvailable] = useState(false);
  const [executionMode, setExecutionMode] = useState<ExecutionMode>('live');
  const [activeRunMode, setActiveRunMode] = useState<ExecutionMode | null>(null);
  const [accessRequired, setAccessRequired] = useState(false);
  const [accessCode, setAccessCode] = useState('');
  const accessCodeRef = useRef('');
  const controllerRef = useRef<AbortController | null>(null);
  const artifactMissionsRef = useRef<Record<WorkType, string>>({ coding: '', design: '', research: '' });

  const mission = missions[workType];
  const draft = drafts[workType];
  const config = WORK_CONFIG[workType];
  const codeLines = activeFile ? (fileContents[activeFile] ?? '').split('\n') : [];
  const currentLanguage = activeFile ? (fileLanguages[activeFile] ?? 'Text') : '—';

  const applyEvent = useCallback((runEvent: RunEvent) => {
    setActivity((current) => [runEvent, ...current].slice(0, 40));
    if (typeof runEvent.progress === 'number') setProgress(runEvent.progress);
    if (runEvent.file) {
      setActiveFile(runEvent.file);
      setChangedFiles((current) => current.includes(runEvent.file as string) ? current : [...current, runEvent.file as string]);
      if (typeof runEvent.content === 'string') setFileContents((current) => ({ ...current, [runEvent.file as string]: runEvent.content as string }));
      if (runEvent.language) setFileLanguages((current) => ({ ...current, [runEvent.file as string]: runEvent.language as string }));
    }
    if (runEvent.element) setDesignElements((current) => [...current.filter((item) => item.id !== runEvent.element?.id), runEvent.element as DesignElement]);
    if (runEvent.designTitle) setDesignTitle(runEvent.designTitle);
    if (runEvent.source) setResearchSources((current) => [...current.filter((item) => item.id !== runEvent.source?.id), runEvent.source as ResearchSource]);
    if (runEvent.paper) setResearchPaper(runEvent.paper);
    if (runEvent.checks) setChecks(runEvent.checks);
    if (runEvent.agentId && runEvent.cursor) setLastCursor({ agentId: runEvent.agentId, ...runEvent.cursor });
    if (runEvent.agentId) {
      setAgents((current) => current.map((agent) => agent.id === runEvent.agentId ? {
        ...agent, status: runEvent.status ?? agent.status, task: runEvent.detail ?? runEvent.message,
        progress: runEvent.progress ?? agent.progress,
      } : agent));
    }
    if (runEvent.type === 'complete') {
      setRunState('complete');
      setAgents((current) => current.map((agent) => ({ ...agent, status: 'done', progress: 100 })));
    }
    if (runEvent.type === 'error') setRunState('paused');
  }, []);

  const startRun = useCallback(async (nextMission: string, nextMode: ExecutionMode, nextWorkType: WorkType) => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    // A retry merges into partial output. A different mission replaces the old
    // artifacts only when its first artifact arrives, never on a failed start.
    let replaceArtifacts = nextMission !== artifactMissionsRef.current[nextWorkType];
    setMissions((current) => ({ ...current, [nextWorkType]: nextMission }));
    setDrafts((current) => ({ ...current, [nextWorkType]: nextMission }));
    setProgress(2); setRunState('running'); setActiveRunMode(nextMode); setComposerOpen(false);
    setLastCursor(null); setActivity([]); setChecks(undefined); setAgents(baseAgents(nextWorkType));

    try {
      const response = await fetch('/api/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(accessCodeRef.current ? { 'x-collaboragent-access': accessCodeRef.current } : {}) },
        body: JSON.stringify({ prompt: nextMission, mode: nextMode, workType: nextWorkType }), signal: controller.signal,
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        if (response.status === 401) { setAccessRequired(true); setConnectionsOpen(true); }
        throw new Error(body?.error ?? 'The team room could not start.');
      }
      if (!response.body) throw new Error('The server returned no event stream.');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let terminalEvent = false;
      while (true) {
        const { value, done } = await reader.read();
        if (controller.signal.aborted) return;
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split(/\r?\n\r?\n/);
        buffer = frames.pop() ?? '';
        for (const frame of frames) {
          const data = frame.split('\n').find((line) => line.startsWith('data: '))?.slice(6);
          if (data) {
            const runEvent = JSON.parse(data) as RunEvent;
            const hasArtifact = nextWorkType === 'coding' ? runEvent.file !== undefined
              : nextWorkType === 'design' ? runEvent.element !== undefined
              : runEvent.source !== undefined || runEvent.paper !== undefined;
            if (replaceArtifacts && hasArtifact) {
              if (nextWorkType === 'coding') {
                setActiveFile(''); setChangedFiles([]); setFileContents({}); setFileLanguages({});
              } else if (nextWorkType === 'design') {
                setDesignElements([]); setDesignTitle('');
              } else {
                setResearchSources([]); setResearchPaper(null);
              }
              replaceArtifacts = false;
              artifactMissionsRef.current[nextWorkType] = nextMission;
            }
            applyEvent(runEvent);
            if (runEvent.type === 'complete' || runEvent.type === 'error') terminalEvent = true;
          }
        }
        if (terminalEvent) { await reader.cancel(); break; }
      }
      if (!terminalEvent) throw new Error('The stream ended before the team finished. Retry to continue working; existing artifacts have been kept.');
    } catch (error) {
      if (!controller.signal.aborted && (error as Error).name !== 'AbortError') applyEvent({
        id: `error_${Date.now()}`, at: new Date().toISOString(), type: 'error', workType: nextWorkType,
        agentId: 'reviewer', message: 'The live stream was interrupted',
        detail: error instanceof Error ? error.message : 'Retry the run. Existing artifacts have been kept.',
      });
    }
  }, [applyEvent]);

  const refreshConnections = useCallback(() => {
    return fetch('/api/providers', { cache: 'no-store' }).then((response) => {
      if (!response.ok) throw new Error('Connection status unavailable');
      return response.json();
    }).then((data: {
      providers?: { configured: boolean }[];
      capabilities?: { liveModels?: boolean; codingHarnesses?: boolean };
      setup?: ConnectionSetup;
      accessRequired?: boolean;
      }) => {
      setAccessRequired(Boolean(data.accessRequired));
      setConfiguredProviders(data.providers?.filter((provider) => provider.configured).length ?? 0);
      const canRunLive = Boolean(data.capabilities?.liveModels);
      const canRunHarnesses = Boolean(data.capabilities?.codingHarnesses);
      setLiveAvailable(canRunLive); setHarnessAvailable(canRunHarnesses);
      setExecutionMode(canRunHarnesses ? 'harness' : 'live');
      setConnectionSetup(data.setup ?? null);
    }).catch(() => {
      setConnectionSetup(null);
      setLiveAvailable(false); setHarnessAvailable(false);
    }).finally(() => {
      setConnectionsLoading(false);
    });
  }, []);
  useEffect(() => { void refreshConnections(); }, [refreshConnections]);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(ACCESS_STORAGE_KEY) ?? '';
      accessCodeRef.current = saved;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage is only readable after hydration.
      if (saved) setAccessCode(saved);
    } catch { /* storage unavailable: the code is requested again on 401 */ }
  }, []);
  const saveAccessCode = (code: string) => {
    accessCodeRef.current = code;
    setAccessCode(code);
    try {
      if (code) localStorage.setItem(ACCESS_STORAGE_KEY, code); else localStorage.removeItem(ACCESS_STORAGE_KEY);
    } catch { /* keep the code for this session only */ }
  };
  useEffect(() => () => controllerRef.current?.abort(), []);

  const switchWorkType = (nextWorkType: WorkType) => {
    if (runState === 'running' || nextWorkType === workType) return;
    setWorkType(nextWorkType); setRunState('idle'); setProgress(0); setActivity([]); setChecks(undefined);
    setActiveRunMode(null); setAgents(baseAgents(nextWorkType)); setSelectedAgent('codex'); setComposerOpen(false);
  };
  const selectedExecutionMode: ExecutionMode = workType === 'coding' ? executionMode : 'live';
  const executionAvailable = selectedExecutionMode === 'harness' ? harnessAvailable : liveAvailable;
  const toggleRun = () => {
    if (runState === 'running') { controllerRef.current?.abort(); setRunState('paused'); return; }
    const nextMission = mission.trim() || draft.trim();
    const nextMode = activeRunMode ?? selectedExecutionMode;
    const modeAvailable = nextMode === 'harness' ? harnessAvailable : liveAvailable;
    if (nextMission && modeAvailable) void startRun(nextMission, nextMode, workType);
  };
  const submitMission = (event: React.FormEvent) => {
    event.preventDefault();
    if (draft.trim() && executionAvailable && runState !== 'running') void startRun(draft.trim(), selectedExecutionMode, workType);
  };
  const taskState = (threshold: number, activeAt: number) => progress >= threshold ? 'done' : progress >= activeAt ? 'active' : 'waiting';
  const cursorAgent = lastCursor ? agents.find((agent) => agent.id === lastCursor.agentId) : undefined;
  const ModeIcon = config.icon;
  const artifactCount = workType === 'coding' ? changedFiles.length : workType === 'design' ? designElements.length : researchSources.length;
  const thirdMetric = workType === 'research' ? researchPaper?.sections.length ?? 0 : checks ? `${checks.passed}/${checks.total}` : '—';
  const summaryLabels = workType === 'coding' ? ['Agents', 'Files', 'Checks'] : workType === 'design' ? ['Agents', 'Assets', 'Checks'] : ['Agents', 'Sources', 'Sections'];
  const taskIcons = [Sparkles, workType === 'design' ? PenTool : workType === 'research' ? Search : Code2, ShieldCheck, CheckCircle2];
  const activeModeLabel = workType === 'coding' && activeRunMode === 'harness' ? 'Coding agents' : workType === 'design' ? 'Design team' : workType === 'research' ? 'Research team' : 'Model team';

  return (
    <main className={`app-shell mode-${workType}`}>
      <aside className="icon-rail">
        <button className="brand-mark" aria-label="Collaboragent home"><span /><span /><span /></button>
        <nav className="rail-nav" aria-label="Primary">
          <button className="rail-button active" title="Workspace"><LayoutGrid size={18} /></button>
          <button className="rail-button" title="Agents"><Bot size={18} /></button>
          <button className="rail-button" title="Messages"><MessageSquareText size={18} /></button>
          <button className="rail-button" title="Projects"><GitBranch size={18} /></button>
          <button className="rail-button" title="Search"><Search size={18} /></button>
        </nav>
        <div className="rail-bottom"><button className="rail-button" title="Settings" onClick={() => setConnectionsOpen(true)}><Settings size={18} /></button><button className="user-avatar" title="Your profile">VS</button></div>
      </aside>

      <section className="workspace-shell">
        <header className="topbar">
          <div className="project-identity">
            <button className="collapse-button" aria-label="Collapse sidebar"><PanelLeftClose size={17} /></button>
            <div className="project-icon"><ModeIcon size={16} /></div>
            <div><div className="project-name-row"><strong>Agent workspace</strong><ChevronDown size={14} /></div><span className="branch-label"><ModeIcon size={11} /> {config.title}</span></div>
          </div>
          <div className="topbar-actions">
            <div className={`live-pill ${activeRunMode ?? 'idle'}`}><Radio size={12} /> {runState === 'running' ? activeModeLabel : runState === 'complete' ? 'Run complete' : runState === 'paused' ? 'Paused' : 'Idle'}</div>
            <div className="avatar-stack" aria-label="Four agents in this room">{agents.slice(0, 3).map((agent) => <AgentAvatar key={agent.id} agent={agent} small />)}<span className="stack-more">+1</span></div>
            <button className="ghost-button" disabled={workType === 'design' && designElements.length === 0} onClick={workType === 'design' ? () => downloadDesignBoard(designTitle, designElements) : undefined}>{workType === 'research' ? <Library size={15} /> : workType === 'design' ? <Palette size={15} /> : <Code2 size={15} />}{workType === 'coding' ? 'Repository' : workType === 'design' ? 'Export board' : 'Source library'}</button>
            <button className="share-button"><Users size={15} /> Share room</button>
          </div>
        </header>

        <nav className="work-type-tabs" aria-label="Workspace type">
          {(Object.keys(WORK_CONFIG) as WorkType[]).map((type) => {
            const TypeIcon = WORK_CONFIG[type].icon;
            const count = type === 'coding' ? changedFiles.length : type === 'design' ? designElements.length : researchSources.length;
            return <button key={type} className={workType === type ? 'active' : ''} onClick={() => switchWorkType(type)}
              disabled={runState === 'running' && workType !== type} aria-current={workType === type ? 'page' : undefined}>
              <TypeIcon size={14} /><span>{WORK_CONFIG[type].label}</span>{workType === type && <em>{count}</em>}
            </button>;
          })}
        </nav>

        <div className="work-area">
          <aside className="agent-panel">
            <div className="panel-heading"><div><p className="eyebrow">COLLABORATORS</p><h2>Agent room</h2></div><button className="icon-button" aria-label="Add agent"><Plus size={16} /></button></div>
            <div className="room-status"><span className="pulse-dot" />{runState === 'running' ? 'Team is collaborating' : runState === 'complete' ? 'Team is ready for review' : 'Team is standing by'}</div>
            <div className="agent-list">{agents.map((agent) => (
              <button key={agent.id} className={`agent-card ${selectedAgent === agent.id ? 'selected' : ''}`} onClick={() => setSelectedAgent(agent.id)}>
                <AgentAvatar agent={agent} /><span className="agent-card-copy">
                  <span className="agent-name-row"><strong>{agent.name}</strong><span className={`status-label ${agent.status}`}>{formatStatus(agent.status, workType)}</span></span>
                  <span className="agent-role">{agent.role} · {agent.provider}</span><span className="agent-task">{agent.task}</span>
                  <span className="mini-progress"><span style={{ width: `${agent.progress}%`, background: agent.color }} /></span>
                </span>
              </button>
            ))}</div>
            <div className="connection-card">
              <div className="connection-title"><span><Zap size={14} /> Provider connections</span><button aria-label="Configure providers" onClick={() => setConnectionsOpen(true)}><Settings size={13} /></button></div>
              <div className="connection-row"><span className="provider-symbol claude-symbol">C</span><span>Claude</span><em>{workType === 'coding' && harnessAvailable ? 'Configured' : liveAvailable ? 'Live model' : 'Needs key'}</em></div>
              <div className="connection-row"><span className="provider-symbol codex-symbol">O</span><span>Codex</span><em>{workType === 'coding' && harnessAvailable ? 'Configured' : liveAvailable ? 'Live model' : 'Needs key'}</em></div>
              <p>{harnessAvailable && workType === 'coding' ? 'Sandbox credentials configured; access checked on run' : liveAvailable ? `Model connection configured · ${configuredProviders} providers routed` : 'Connect a provider to run agents'}</p>
            </div>
          </aside>

          <section className="canvas-column">
            <section className="mission-card">
              <div className="mission-topline"><div className="mission-icon"><WandSparkles size={17} /></div><div className="mission-copy">
                <div className="mission-label-row"><span>{config.eyebrow}</span><span className="mission-status"><span /> {runState === 'running' ? 'In progress' : runState === 'complete' ? 'Complete' : runState === 'paused' ? 'Paused' : 'Awaiting task'}</span></div>
                <h1>{mission || config.emptyMission}</h1>
              </div><button className="more-button" aria-label="Mission menu"><MoreHorizontal size={18} /></button></div>
              <div className="mission-progress-row"><div className="large-progress"><span style={{ width: `${progress}%` }} /></div><strong>{progress}%</strong></div>
              <div className="task-flow">{config.tasks.map((label, index) => {
                const TaskIcon = taskIcons[index];
                const state = taskState([73, 82, 96, 100][index], [6, 18, 60, 97][index]);
                return <div className="task-flow-item" key={label}><div className={`task-node ${state}`}>{state === 'done' ? <Check size={13} /> : <TaskIcon size={13} />}</div><span>{label}</span>{index < 3 && <div className={`task-connector ${progress >= [73, 82, 96][index] ? 'filled' : ''}`} />}</div>;
              })}</div>
            </section>

            {workType === 'coding' && (
              <section className="editor-card">
                <header className="editor-header"><div className="editor-title"><Files size={15} /><strong>Shared code</strong><span className="sync-state"><span /> Synced</span></div><div className="editor-actions"><span className="working-count"><Users size={13} /> {agents.filter((agent) => agent.status !== 'queued' && agent.status !== 'done').length} working</span><button aria-label="Editor menu"><MoreHorizontal size={17} /></button></div></header>
                <div className="editor-body"><aside className="file-tree"><div className="tree-heading"><span>FILES</span><MoreHorizontal size={14} /></div><div className="folder-row"><ChevronDown size={13} /><span>generated-project</span></div>
                  {changedFiles.length === 0 && <p className="empty-files">Files appear when real agents create them.</p>}
                  {changedFiles.map((path) => <button key={path} className={`file-row ${activeFile === path ? 'active' : ''}`} onClick={() => setActiveFile(path)} title={path}><FileCode2 size={13} /><span>{path.split('/').at(-1)}</span><em>M</em></button>)}
                </aside><div className="code-pane">
                  <div className="tabs-row">{activeFile && <button className="file-tab active"><FileCode2 size={13} />{activeFile.split('/').at(-1)}<span className="modified-dot" /><X size={12} /></button>}<button className="new-tab" aria-label="New tab"><Plus size={13} /></button>{runState === 'running' && <div className="tabs-presence">{agents.filter((agent) => agent.status !== 'queued' && agent.status !== 'done').slice(0, 2).map((agent) => <span className={`presence-mini ${agent.id}`} key={agent.id}>{agent.monogram}</span>)}</div>}</div>
                  <div className="breadcrumb-row"><span>generated-project</span>{activeFile && <><ChevronRight size={11} /><strong>{activeFile}</strong></>}</div>
                  <div className="code-scroll">{!activeFile && <div className="empty-editor"><FileCode2 size={22} /><strong>No generated files yet</strong><span>Start a coding run to populate this workspace.</span></div>}{codeLines.map((line, index) => <div className="code-line" key={`${index}-${line}`}><span className="line-number">{index + 1}</span><code>{line}</code></div>)}
                    {lastCursor && cursorAgent && <div className="live-cursor event-cursor" style={{ '--cursor-color': cursorAgent.color, top: `${46 + (lastCursor.line % 15) * 25}px`, left: `${Math.min(78, 28 + lastCursor.column * 2.2)}%` } as React.CSSProperties}><span className="cursor-caret" /><label>{cursorAgent.name}</label></div>}
                  </div><footer className="editor-footer"><span><GitBranch size={11} /> main*</span><span><CircleDot size={11} /> 0</span><span className="footer-spacer" /><span>{lastCursor ? `Ln ${lastCursor.line}, Col ${lastCursor.column}` : 'No cursor'}</span><span>{currentLanguage}</span></footer>
                </div></div>
              </section>
            )}
            {workType === 'design' && <DesignCanvas title={designTitle} elements={designElements} agents={agents} onChange={setDesignElements} />}
            {workType === 'research' && <ResearchPaper paper={researchPaper} sources={researchSources} />}

            <section className={`composer-card ${composerOpen ? 'expanded' : ''}`}><form onSubmit={submitMission}>
              <div className="composer-avatar"><Command size={15} /></div><textarea aria-label={`Give the ${config.label.toLowerCase()} team a task`} value={draft} maxLength={4000} rows={composerOpen ? 3 : 1} onFocus={() => setComposerOpen(true)} onChange={(event) => setDrafts((current) => ({ ...current, [workType]: event.target.value }))} onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }} placeholder={config.placeholder} />
              <div className="composer-controls"><button type="button" className="attach-button" aria-label="Attach context"><Plus size={16} /></button>
                {workType === 'coding' ? <button type="button" className={`mode-chip ${executionMode}`} aria-label="Toggle real agent execution" aria-pressed={executionMode === 'harness'} disabled={!liveAvailable || !harnessAvailable} onClick={() => setExecutionMode((current) => current === 'harness' ? 'live' : 'harness')}>{executionMode === 'harness' ? <Code2 size={11} /> : <Radio size={11} />}{executionMode === 'harness' ? 'Coding agents' : 'Model team'}</button> : <span className={`mode-chip ${workType}`}>{workType === 'design' ? <Palette size={11} /> : <Search size={11} />}{workType === 'design' ? 'Design agents' : 'Research agents'}</span>}
                <span className="team-chip"><Users size={12} /> All agents <ChevronDown size={11} /></span><button type="submit" className="send-button" aria-label="Start team run" disabled={!draft.trim() || !executionAvailable || runState === 'running'}><ArrowUp size={16} /></button>
              </div></form>{composerOpen && <p><span>Enter</span> to send · Shift+Enter for a new line</p>}</section>
          </section>

          <aside className="activity-panel">
            <div className="activity-heading"><div><p className="eyebrow">OBSERVABILITY</p><h2>Live activity</h2></div><button className={`run-toggle ${runState}`} onClick={toggleRun} title={runState === 'running' ? 'Pause run' : 'Start run'} disabled={runState !== 'running' && (!mission.trim() || !(activeRunMode === 'harness' ? harnessAvailable : liveAvailable))}>{runState === 'running' ? <Pause size={14} /> : <Play size={14} />}</button></div>
            <div className="summary-strip">{[agents.filter((agent) => agent.status !== 'queued').length, artifactCount, thirdMetric].map((value, index) => <div key={summaryLabels[index]}><strong>{value}</strong><span>{summaryLabels[index]}</span></div>)}</div>
            <div className="activity-feed">{activity.length === 0 && <div className="empty-activity"><Activity size={20} /><strong>No agent activity yet</strong><span>Plans, searches, edits, and reviews will stream here.</span></div>}
              {activity.map((item, index) => { const agent = agents.find((candidate) => candidate.id === item.agentId); return <article className="activity-item" key={item.id}><div className="timeline-column">{agent ? <AgentAvatar agent={agent} small /> : <span className="system-event"><Activity size={13} /></span>}{index < activity.length - 1 && <span className="timeline-line" />}</div><div className="activity-copy"><div className="activity-meta"><strong>{agent?.name ?? 'Collaboragent'}</strong>{item.model && <em>{item.model.split('/').at(-1)}</em>}<span>{relativeTime(item)}</span></div><p>{item.message}</p>{item.detail && <small>{item.detail}</small>}{item.file && <button className="file-change" onClick={() => setActiveFile(item.file as string)}><FileCode2 size={12} />{item.file}<ChevronRight size={11} /></button>}{item.source && <a className="file-change source-change" href={item.source.url} target="_blank" rel="noreferrer"><BookOpen size={12} />{item.source.publisher}<ChevronRight size={11} /></a>}</div></article>; })}
            </div><div className="activity-footer"><Clock3 size={13} /> Events are streamed as they happen</div>
          </aside>
        </div>
      </section>
      <ProviderConnections open={connectionsOpen} onClose={() => setConnectionsOpen(false)} setup={connectionSetup} onRefresh={() => { setConnectionsLoading(true); void refreshConnections(); }} loading={connectionsLoading}
        accessRequired={accessRequired} accessCode={accessCode} onAccessCodeChange={saveAccessCode} />
    </main>
  );
}
