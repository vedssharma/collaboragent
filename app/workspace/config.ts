import { BookOpen, Code2, Palette } from 'lucide-react';
import type { AgentId, AgentView, RunEvent, WorkType } from '@/lib/types';

// Agent colors are theme tokens (see globals.css) so they adapt to light and dark mode.
export const AGENT_IDENTITIES = {
  claude: { name: 'Claude', provider: 'Anthropic', monogram: 'C', color: 'var(--agent-claude)', softColor: 'var(--agent-claude-soft)' },
  codex: { name: 'Codex', provider: 'OpenAI', monogram: 'O', color: 'var(--agent-codex)', softColor: 'var(--agent-codex-soft)' },
  gemini: { name: 'Gemini', provider: 'Google', monogram: 'G', color: 'var(--agent-gemini)', softColor: 'var(--agent-gemini-soft)' },
  reviewer: { name: 'Sentinel', provider: 'Collaboragent', monogram: 'S', color: 'var(--agent-reviewer)', softColor: 'var(--agent-reviewer-soft)' },
} as const;

export const WORK_CONFIG = {
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

export type WorkConfig = (typeof WORK_CONFIG)[WorkType];

const AGENT_IDS: AgentId[] = ['claude', 'codex', 'gemini', 'reviewer'];

export function baseAgents(workType: WorkType): AgentView[] {
  return AGENT_IDS.map((id, index) => ({
    id, ...AGENT_IDENTITIES[id], role: WORK_CONFIG[workType].roles[index],
    status: 'queued', task: WORK_CONFIG[workType].waiting[index], progress: 0,
  }));
}

// A stopped or failed run cannot be resumed mid-stage: Retry starts the
// mission again and merges new output into the artifacts already on screen.
export type RunState = 'idle' | 'running' | 'stopped' | 'failed' | 'complete';

export const RUN_LABELS: Record<Exclude<RunState, 'running'>, { pill: string; mission: string }> = {
  idle: { pill: 'Idle', mission: 'Awaiting task' },
  stopped: { pill: 'Stopped', mission: 'Stopped' },
  failed: { pill: 'Interrupted', mission: 'Interrupted' },
  complete: { pill: 'Run complete', mission: 'Complete' },
};

export type ExecutionMode = 'live' | 'harness';

export function formatStatus(status: AgentView['status'], workType: WorkType) {
  if (status === 'thinking') return workType === 'research' ? 'Scoping' : 'Planning';
  if (status === 'working') return workType === 'design' ? 'Designing' : workType === 'research' ? 'Researching' : 'Building';
  if (status === 'reviewing') return 'Reviewing';
  if (status === 'done') return 'Complete';
  return 'Queued';
}

export function relativeTime(event: RunEvent) {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(event.at).getTime()) / 1000));
  return seconds < 4 ? 'now' : `${seconds}s`;
}

export function isActive(agent: AgentView) {
  return agent.status !== 'queued' && agent.status !== 'done';
}
