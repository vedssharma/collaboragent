export type AgentId = 'claude' | 'codex' | 'gemini' | 'reviewer';

export type WorkType = 'coding' | 'design' | 'research';

export type AgentStatus = 'queued' | 'thinking' | 'working' | 'reviewing' | 'done';

export type DesignElementKind =
  | 'frame'
  | 'card'
  | 'circle'
  | 'text'
  | 'sticky'
  | 'connector'
  | 'icon'
  | 'badge';

export type DesignElement = {
  id: string;
  kind: DesignElementKind;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  fill: string;
  stroke: string;
  textColor: string;
  rotation: number;
  owner: AgentId;
};

export type ResearchSource = {
  id: string;
  title: string;
  url: string;
  publisher: string;
  publishedAt?: string;
  summary: string;
};

export type ResearchSection = {
  id: string;
  heading: string;
  paragraphs: string[];
  sourceIds: string[];
};

export type ResearchPaper = {
  title: string;
  subtitle: string;
  abstract: string;
  sections: ResearchSection[];
  conclusion: string;
};

export type RunEvent = {
  id: string;
  at: string;
  type:
    | 'run'
    | 'agent-status'
    | 'activity'
    | 'file'
    | 'canvas'
    | 'source'
    | 'paper'
    | 'task'
    | 'complete'
    | 'error';
  mode?: 'live' | 'harness';
  workType?: WorkType;
  agentId?: AgentId;
  status?: AgentStatus;
  message: string;
  detail?: string;
  file?: string;
  content?: string;
  language?: string;
  model?: string;
  progress?: number;
  taskId?: string;
  cursor?: { line: number; column: number };
  designTitle?: string;
  element?: DesignElement;
  source?: ResearchSource;
  paper?: ResearchPaper;
  checks?: { passed: number; total: number };
  /** Clears this workspace's artifacts before the events that follow replace them. */
  resetArtifacts?: boolean;
  /** Token totals for the run's model calls, reported on completion. */
  usage?: { inputTokens: number; outputTokens: number; calls: number };
};

export type AgentView = {
  id: AgentId;
  name: string;
  provider: string;
  role: string;
  monogram: string;
  status: AgentStatus;
  task: string;
  progress: number;
  color: string;
  softColor: string;
};
