'use client';

import { Download, ImageDown, Library, Palette, PanelLeftClose, Radio, Settings } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { DesignCanvas } from '@/app/design-canvas';
import { ProviderConnections } from '@/app/provider-connections';
import { ResearchPaper } from '@/app/research-paper';
import { ActivityPanel } from '@/app/workspace/activity-panel';
import { AgentAvatar, AgentPanel } from '@/app/workspace/agent-panel';
import { CodeWorkspace, type CodeFiles, type Cursor } from '@/app/workspace/code-workspace';
import { Composer } from '@/app/workspace/composer';
import { RUN_LABELS, WORK_CONFIG, baseAgents, type ExecutionMode, type RunState } from '@/app/workspace/config';
import { MissionCard } from '@/app/workspace/mission-card';
import { useAccessCode } from '@/app/workspace/use-access-code';
import { useProviderStatus } from '@/app/workspace/use-provider-status';
import { useRunStream, type RunRequest, type RunStartError } from '@/app/workspace/use-run-stream';
import { downloadDesignBoard, downloadDesignBoardPng } from '@/lib/design-export';
import type { Refinement } from '@/lib/refinement';
import type {
  AgentId, DesignElement, ResearchPaper as ResearchPaperType, ResearchSource, RunEvent, WorkType,
} from '@/lib/types';
import { loadWorkspace, saveWorkspace } from '@/lib/workspace-storage';
import { createZip, downloadBlob, slugify } from '@/lib/zip';

const EMPTY_BY_TYPE: Record<WorkType, string> = { coding: '', design: '', research: '' };
const EMPTY_FILES: CodeFiles = { order: [], contents: {}, languages: {}, previous: {}, active: '' };

export default function Home() {
  const [workType, setWorkType] = useState<WorkType>('coding');
  const [missions, setMissions] = useState<Record<WorkType, string>>(EMPTY_BY_TYPE);
  const [drafts, setDrafts] = useState<Record<WorkType, string>>(EMPTY_BY_TYPE);
  const [agents, setAgents] = useState(() => baseAgents('coding'));
  const [selectedAgent, setSelectedAgent] = useState<AgentId>('codex');
  const [activity, setActivity] = useState<RunEvent[]>([]);
  const [progress, setProgress] = useState(0);
  const [checks, setChecks] = useState<RunEvent['checks']>();
  const [runUsage, setRunUsage] = useState<RunEvent['usage']>();
  const [runState, setRunState] = useState<RunState>('idle');
  const [files, setFiles] = useState<CodeFiles>(EMPTY_FILES);
  const [lastCursor, setLastCursor] = useState<Cursor | null>(null);
  const [designElements, setDesignElements] = useState<DesignElement[]>([]);
  const [designTitle, setDesignTitle] = useState('');
  const [researchSources, setResearchSources] = useState<ResearchSource[]>([]);
  const [researchPaper, setResearchPaper] = useState<ResearchPaperType | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [connectionsOpen, setConnectionsOpen] = useState(false);
  const [executionMode, setExecutionMode] = useState<ExecutionMode>('live');
  const [activeRunMode, setActiveRunMode] = useState<ExecutionMode | null>(null);
  const [agentPanelOpen, setAgentPanelOpen] = useState(true);
  const [buildOnResult, setBuildOnResult] = useState(false);
  const artifactMissionsRef = useRef<Record<WorkType, string>>({ ...EMPTY_BY_TYPE });
  const replaceOnFirstArtifactRef = useRef(false);

  const providers = useProviderStatus();
  const { accessCode, accessCodeRef, saveAccessCode } = useAccessCode();

  const mission = missions[workType];
  const draft = drafts[workType];

  const clearArtifacts = useCallback((type: WorkType) => {
    if (type === 'coding') { setFiles(EMPTY_FILES); setLastCursor(null); }
    if (type === 'design') { setDesignElements([]); setDesignTitle(''); }
    if (type === 'research') { setResearchSources([]); setResearchPaper(null); }
  }, []);

  const applyEvent = useCallback((runEvent: RunEvent) => {
    setActivity((current) => [runEvent, ...current].slice(0, 40));
    if (runEvent.resetArtifacts) {
      // Keep the draft files as the comparison point for the revised ones.
      if (runEvent.workType === 'coding') setFiles((current) => ({ ...EMPTY_FILES, previous: { ...current.previous, ...current.contents } }));
      if (runEvent.workType === 'design') setDesignElements([]);
      if (runEvent.workType === 'research') { setResearchSources([]); setResearchPaper(null); }
    }
    if (typeof runEvent.progress === 'number') setProgress(runEvent.progress);
    if (runEvent.type === 'file') {
      const path = runEvent.file;
      setFiles((current) => {
        const before = current.contents[path];
        const content = runEvent.content;
        const rewritten = typeof content === 'string' && before !== undefined && before !== content;
        return {
          active: path,
          order: current.order.includes(path) ? current.order : [...current.order, path],
          contents: typeof content === 'string' ? { ...current.contents, [path]: content } : current.contents,
          languages: runEvent.language ? { ...current.languages, [path]: runEvent.language } : current.languages,
          previous: rewritten ? { ...current.previous, [path]: before } : current.previous,
        };
      });
    }
    if (runEvent.type === 'canvas') {
      const { element, designTitle: title } = runEvent;
      setDesignElements((current) => [...current.filter((item) => item.id !== element.id), element]);
      if (title) setDesignTitle(title);
    }
    if (runEvent.type === 'source') {
      const { source } = runEvent;
      setResearchSources((current) => [...current.filter((item) => item.id !== source.id), source]);
    }
    if (runEvent.type === 'paper') setResearchPaper(runEvent.paper);
    if (runEvent.checks) setChecks(runEvent.checks);
    if (runEvent.usage) setRunUsage(runEvent.usage);
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
    if (runEvent.type === 'error') setRunState('failed');
  }, []);

  const handleFirstArtifact = useCallback((request: RunRequest) => {
    if (replaceOnFirstArtifactRef.current) clearArtifacts(request.workType);
    replaceOnFirstArtifactRef.current = false;
    artifactMissionsRef.current[request.workType] = request.mission;
  }, [clearArtifacts]);

  const { setAccessRequired, refresh } = providers;
  const handleStartError = useCallback((error: RunStartError) => {
    if (error.status === 401) { setAccessRequired(true); setConnectionsOpen(true); }
  }, [setAccessRequired]);

  const getAccessCode = useCallback(() => accessCodeRef.current, [accessCodeRef]);
  const runStream = useRunStream({ getAccessCode, onEvent: applyEvent, onFirstArtifact: handleFirstArtifact, onStartError: handleStartError });

  const startRun = (request: RunRequest) => {
    // A retry merges into partial output. A different mission replaces the old
    // artifacts only when its first artifact arrives, never on a failed start.
    // A follow-up revises the current result: code merges file by file, while
    // a revised board or paper replaces the previous one when it arrives.
    replaceOnFirstArtifactRef.current = request.refine
      ? request.workType !== 'coding'
      : request.mission !== artifactMissionsRef.current[request.workType];
    setMissions((current) => ({ ...current, [request.workType]: request.mission }));
    setDrafts((current) => ({ ...current, [request.workType]: request.mission }));
    setProgress(2); setRunState('running'); setActiveRunMode(request.mode); setComposerOpen(false);
    setLastCursor(null); setActivity([]); setChecks(undefined); setRunUsage(undefined); setAgents(baseAgents(request.workType));
    void runStream.start(request);
  };

  useEffect(() => {
    void refresh().then((data) => {
      if (data) setExecutionMode(data.capabilities?.codingHarnesses ? 'harness' : 'live');
    });
  }, [refresh]);

  // Restore the last workspace after hydration, then keep it saved so a
  // refresh does not lose generated files, boards or papers.
  const restoredRef = useRef(false);
  useEffect(() => {
    const saved = loadWorkspace();
    restoredRef.current = true;
    if (!saved) return;
    /* eslint-disable react-hooks/set-state-in-effect -- localStorage is only readable after hydration. */
    setWorkType(saved.workType); setAgents(baseAgents(saved.workType));
    setMissions(saved.missions); setDrafts(saved.drafts);
    artifactMissionsRef.current = { ...saved.artifactMissions };
    setFiles({ order: saved.files.order, contents: saved.files.contents, languages: saved.files.languages, active: saved.files.active, previous: {} });
    setDesignTitle(saved.design.title); setDesignElements(saved.design.elements);
    setResearchSources(saved.research.sources); setResearchPaper(saved.research.paper);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);
  useEffect(() => {
    if (!restoredRef.current) return;
    const timer = setTimeout(() => saveWorkspace({
      workType, missions, drafts, artifactMissions: { ...artifactMissionsRef.current },
      files: { active: files.active, order: files.order, contents: files.contents, languages: files.languages },
      design: { title: designTitle, elements: designElements },
      research: { sources: researchSources, paper: researchPaper },
    }), 400);
    return () => clearTimeout(timer);
  }, [workType, missions, drafts, files, designTitle, designElements, researchSources, researchPaper]);

  const resetRunView = (type: WorkType) => {
    setRunState('idle'); setProgress(0); setActivity([]); setChecks(undefined); setRunUsage(undefined);
    setActiveRunMode(null); setAgents(baseAgents(type));
  };
  const switchWorkType = (nextWorkType: WorkType) => {
    if (runState === 'running' || nextWorkType === workType) return;
    setWorkType(nextWorkType); resetRunView(nextWorkType); setSelectedAgent('codex'); setComposerOpen(false);
  };
  const selectedExecutionMode: ExecutionMode = workType === 'coding' ? executionMode : 'live';
  const modeAvailable = (mode: ExecutionMode) => mode === 'harness' ? providers.harnessAvailable : providers.liveAvailable;
  const toggleRun = () => {
    if (runState === 'running') { runStream.stop(); setRunState('stopped'); return; }
    const nextMission = mission.trim() || draft.trim();
    const nextMode = activeRunMode ?? selectedExecutionMode;
    if (nextMission && modeAvailable(nextMode)) startRun({ mission: nextMission, mode: nextMode, workType });
  };

  const artifactCount = workType === 'coding' ? files.order.length : workType === 'design' ? designElements.length : researchSources.length;
  const canRefine = Boolean(mission) && artifactCount > 0;
  const refineEnabled = canRefine && buildOnResult;
  const currentRefinement = (): Refinement => ({
    previousMission: mission.slice(0, 4000),
    ...(workType === 'coding' ? { files: files.order.slice(0, 60).map((path) => ({ path: path.slice(0, 200), content: (files.contents[path] ?? '').slice(0, 48_000) })) } : {}),
    ...(workType === 'design' ? { board: { title: designTitle.slice(0, 200), elements: designElements.slice(0, 60) } } : {}),
    ...(workType === 'research' && researchPaper ? { paper: researchPaper } : {}),
  });
  const submitMission = () => {
    if (!draft.trim() || !modeAvailable(selectedExecutionMode) || runState === 'running') return;
    startRun({ mission: draft.trim(), mode: selectedExecutionMode, workType, refine: refineEnabled ? currentRefinement() : undefined });
  };

  const downloadCode = () => {
    const entries = files.order.map((path) => ({ path, content: files.contents[path] ?? '' }));
    if (entries.length === 0) return;
    const name = slugify(missions.coding, 'generated-project');
    downloadBlob(new Blob([createZip(entries, name)], { type: 'application/zip' }), `${name}.zip`);
  };
  const showSourceLibrary = () => {
    // The side panel is hidden on narrower screens; fall back to the paper's bibliography.
    const target = [...document.querySelectorAll<HTMLElement>('.source-library-panel, .bibliography')]
      .find((element) => element.offsetParent !== null);
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    target?.querySelector<HTMLElement>('a')?.focus({ preventScroll: true });
  };
  const clearCurrentWorkspace = () => {
    if (runState === 'running') return;
    setMissions((current) => ({ ...current, [workType]: '' }));
    setDrafts((current) => ({ ...current, [workType]: '' }));
    artifactMissionsRef.current[workType] = '';
    clearArtifacts(workType);
    resetRunView(workType);
  };
  const selectFile = (path: string) => setFiles((current) => ({ ...current, active: path }));

  const thirdMetric = workType === 'research' ? researchPaper?.sections.length ?? 0 : checks ? `${checks.passed}/${checks.total}` : '—';
  const summaryLabels = workType === 'coding' ? ['Agents', 'Files', 'Checks'] : workType === 'design' ? ['Agents', 'Assets', 'Checks'] : ['Agents', 'Sources', 'Sections'];
  const summaryValues = [agents.filter((agent) => agent.status !== 'queued').length, artifactCount, thirdMetric];
  const activeModeLabel = workType === 'coding' && activeRunMode === 'harness' ? 'Coding agents' : workType === 'design' ? 'Design team' : workType === 'research' ? 'Research team' : 'Model team';

  return (
    <main className={`app-shell mode-${workType}`}>
      <section className="workspace-shell">
        <header className="topbar">
          <div className="project-identity">
            <button className="collapse-button" aria-label={agentPanelOpen ? 'Hide agent room' : 'Show agent room'} aria-pressed={!agentPanelOpen} onClick={() => setAgentPanelOpen((open) => !open)}><PanelLeftClose size={18} /></button>
            <div className="wordmark"><span className="brand-mark" aria-hidden="true" /><strong>Collaboragent</strong></div>
          </div>
          <nav className="work-type-tabs" aria-label="Workspace type">
            {(Object.keys(WORK_CONFIG) as WorkType[]).map((type) => {
              const TypeIcon = WORK_CONFIG[type].icon;
              const count = type === 'coding' ? files.order.length : type === 'design' ? designElements.length : researchSources.length;
              return <button key={type} className={workType === type ? 'active' : ''} onClick={() => switchWorkType(type)}
                disabled={runState === 'running' && workType !== type} aria-current={workType === type ? 'page' : undefined}>
                <TypeIcon size={15} /><span>{WORK_CONFIG[type].label}</span>{workType === type && count > 0 && <em>{count}</em>}
              </button>;
            })}
          </nav>
          <div className="topbar-actions">
            <div className={`live-pill ${activeRunMode ?? 'idle'}`}><Radio size={12} /> {runState === 'running' ? activeModeLabel : RUN_LABELS[runState].pill}</div>
            <div className="avatar-stack" aria-label="Four agents in this room">{agents.slice(0, 3).map((agent) => <AgentAvatar key={agent.id} agent={agent} small />)}<span className="stack-more">+1</span></div>
            {workType === 'coding' && <button className="ghost-button" disabled={files.order.length === 0} onClick={downloadCode}><Download size={15} />Download code</button>}
            {workType === 'design' && <button className="ghost-button" disabled={designElements.length === 0} onClick={() => downloadDesignBoard(designTitle, designElements)}><Palette size={15} />Export board</button>}
            {workType === 'design' && <button className="ghost-button" disabled={designElements.length === 0} onClick={() => { void downloadDesignBoardPng(designTitle, designElements).catch(() => undefined); }}><ImageDown size={15} />Export PNG</button>}
            {workType === 'research' && <button className="ghost-button" disabled={researchSources.length === 0} onClick={showSourceLibrary}><Library size={15} />Source library</button>}
            <button className="settings-button" title="Settings" aria-label="Settings" onClick={() => setConnectionsOpen(true)}><Settings size={18} /></button>
          </div>
        </header>

        <div className={`work-area ${agentPanelOpen ? '' : 'agents-hidden'}`}>
          <AgentPanel agents={agents} workType={workType} runState={runState} selectedAgent={selectedAgent} onSelectAgent={setSelectedAgent}
            liveAvailable={providers.liveAvailable} harnessAvailable={providers.harnessAvailable} configuredProviders={providers.configuredProviders}
            onOpenConnections={() => setConnectionsOpen(true)} />

          <section className="canvas-column">
            <MissionCard workType={workType} mission={mission} runState={runState} progress={progress}
              canClear={runState !== 'running' && (Boolean(mission) || artifactCount > 0)} onClear={clearCurrentWorkspace} />

            {workType === 'coding' && <CodeWorkspace files={files} agents={agents} running={runState === 'running'} cursor={lastCursor} onSelectFile={selectFile} />}
            {workType === 'design' && <DesignCanvas title={designTitle} elements={designElements} agents={agents} onChange={setDesignElements} />}
            {workType === 'research' && <ResearchPaper paper={researchPaper} sources={researchSources} />}

            <Composer workType={workType} draft={draft} onDraftChange={(value) => setDrafts((current) => ({ ...current, [workType]: value }))}
              open={composerOpen} onOpen={() => setComposerOpen(true)} onSubmit={submitMission}
              canSubmit={Boolean(draft.trim()) && modeAvailable(selectedExecutionMode) && runState !== 'running'}
              executionMode={executionMode} canToggleMode={providers.liveAvailable && providers.harnessAvailable}
              onToggleMode={() => setExecutionMode((current) => current === 'harness' ? 'live' : 'harness')}
              canRefine={canRefine} refineEnabled={refineEnabled} onToggleRefine={() => setBuildOnResult((current) => !current)}
              agentCount={agents.length} />
          </section>

          <ActivityPanel activity={activity} agents={agents} runState={runState}
            canToggle={runState === 'running' || (Boolean(mission.trim()) && modeAvailable(activeRunMode ?? 'live'))}
            onToggleRun={toggleRun} summary={summaryLabels.map((label, index) => ({ label, value: summaryValues[index] }))}
            usage={runUsage} onSelectFile={selectFile} />
        </div>
      </section>
      <ProviderConnections open={connectionsOpen} onClose={() => setConnectionsOpen(false)} setup={providers.setup}
        onRefresh={() => { void providers.reload(); }} loading={providers.loading}
        accessRequired={providers.accessRequired} accessCode={accessCode} onAccessCodeChange={saveAccessCode} />
    </main>
  );
}
