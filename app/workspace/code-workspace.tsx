'use client';

import { Check, ChevronDown, ChevronRight, CircleDot, Copy, FileCode2, Files, GitBranch, GitCompare, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { diffLines, highlightLines } from '@/lib/code-view';
import type { AgentId, AgentView } from '@/lib/types';
import { isActive } from './config';

export type CodeFiles = {
  order: string[];
  contents: Record<string, string>;
  languages: Record<string, string>;
  /** Content each file had before an agent last rewrote it. */
  previous: Record<string, string>;
  active: string;
};

export type Cursor = { agentId: AgentId; line: number; column: number };

export function CodeWorkspace({ files, agents, running, cursor, onSelectFile }: {
  files: CodeFiles;
  agents: AgentView[];
  running: boolean;
  cursor: Cursor | null;
  onSelectFile: (path: string) => void;
}) {
  const [showChanges, setShowChanges] = useState(false);
  const [copiedFile, setCopiedFile] = useState('');
  const activeFile = files.active;
  const activeContent = activeFile ? (files.contents[activeFile] ?? '') : '';
  const previousContent = activeFile ? files.previous[activeFile] : undefined;
  const changesVisible = showChanges && previousContent !== undefined;
  const highlightedLines = useMemo(() => activeFile ? highlightLines(activeContent, activeFile) : [], [activeContent, activeFile]);
  const changedLines = useMemo(() => changesVisible ? diffLines(previousContent ?? '', activeContent) : null, [changesVisible, previousContent, activeContent]);
  const language = activeFile ? (files.languages[activeFile] ?? 'Text') : '—';
  const working = agents.filter(isActive);
  const cursorAgent = cursor ? agents.find((agent) => agent.id === cursor.agentId) : undefined;
  const copied = Boolean(activeFile) && copiedFile === activeFile;

  const copyActiveFile = () => {
    if (!activeFile) return;
    navigator.clipboard?.writeText(activeContent).then(() => {
      setCopiedFile(activeFile);
      setTimeout(() => setCopiedFile((current) => current === activeFile ? '' : current), 1500);
    }).catch(() => { /* clipboard blocked: nothing to report beyond the unchanged icon */ });
  };

  return (
    <section className="editor-card">
      <header className="editor-header"><div className="editor-title"><Files size={15} /><strong>Shared code</strong><span className="sync-state"><span /> Synced</span></div><div className="editor-actions"><span className="working-count"><Users size={13} /> {working.length} working</span><button aria-label={copied ? 'Copied' : 'Copy file'} title="Copy file contents" disabled={!activeFile} onClick={copyActiveFile}>{copied ? <Check size={15} /> : <Copy size={15} />}</button></div></header>
      <div className="editor-body"><aside className="file-tree"><div className="tree-heading"><span>FILES</span></div><div className="folder-row"><ChevronDown size={13} /><span>generated-project</span></div>
        {files.order.length === 0 && <p className="empty-files">Files appear when real agents create them.</p>}
        {files.order.map((path) => <button key={path} className={`file-row ${activeFile === path ? 'active' : ''}`} onClick={() => onSelectFile(path)} title={path}><FileCode2 size={13} /><span>{path.split('/').at(-1)}</span><em>M</em></button>)}
      </aside><div className="code-pane">
        <div className="tabs-row">{activeFile && <span className="file-tab active"><FileCode2 size={13} />{activeFile.split('/').at(-1)}<span className="modified-dot" /></span>}{running && <div className="tabs-presence">{working.slice(0, 2).map((agent) => <span className={`presence-mini ${agent.id}`} key={agent.id}>{agent.monogram}</span>)}</div>}</div>
        <div className="breadcrumb-row"><span>generated-project</span>{activeFile && <><ChevronRight size={11} /><strong>{activeFile}</strong></>}{previousContent !== undefined && <button type="button" className={`changes-toggle ${changesVisible ? 'active' : ''}`} aria-pressed={changesVisible} onClick={() => setShowChanges((current) => !current)}><GitCompare size={11} />{changesVisible ? 'Hide changes' : 'Show changes'}</button>}</div>
        <div className="code-scroll">{!activeFile && <div className="empty-editor"><FileCode2 size={22} /><strong>No generated files yet</strong><span>Start a coding run to populate this workspace.</span></div>}{changesVisible && !changedLines && <div className="diff-notice">This file is too large to compare.</div>}
          {changesVisible && changedLines ? changedLines.map((line, index) => <div className={`code-line diff-${line.kind}`} key={index}><span className="line-number">{line.kind === 'added' ? '+' : line.kind === 'removed' ? '−' : ''}</span><code>{line.text}</code></div>)
            : highlightedLines.map((html, index) => <div className="code-line" key={index}><span className="line-number">{index + 1}</span><code className="hljs" dangerouslySetInnerHTML={{ __html: html }} /></div>)}
          {cursor && cursorAgent && <div className="live-cursor event-cursor" style={{ '--cursor-color': cursorAgent.color, top: `${46 + (cursor.line % 15) * 25}px`, left: `${Math.min(78, 28 + cursor.column * 2.2)}%` } as React.CSSProperties}><span className="cursor-caret" /><label>{cursorAgent.name}</label></div>}
        </div><footer className="editor-footer"><span><GitBranch size={11} /> main*</span><span><CircleDot size={11} /> 0</span><span className="footer-spacer" /><span>{cursor ? `Ln ${cursor.line}, Col ${cursor.column}` : 'No cursor'}</span><span>{language}</span></footer>
      </div></div>
    </section>
  );
}
