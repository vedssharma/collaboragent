'use client';

import {
  Circle,
  Frame,
  Hand,
  Minus,
  MousePointer2,
  Plus,
  Redo2,
  Shapes,
  Sparkles,
  StickyNote,
  Trash2,
  Type,
  Undo2,
} from 'lucide-react';
import { useRef, useState } from 'react';
import type { AgentView, DesignElement, DesignElementKind } from '@/lib/types';

type DragState = {
  id: string;
  mode: 'move' | 'resize';
  startX: number;
  startY: number;
  elementX: number;
  elementY: number;
  width: number;
  height: number;
  moved: boolean;
};

const MAX_HISTORY = 50;

const OWNER_COLORS: Record<DesignElement['owner'], string> = {
  claude: '#d36b4c',
  codex: '#177c69',
  gemini: '#5a6ee8',
  reviewer: '#9a6b26',
};

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function DesignCanvas({
  title,
  elements,
  agents,
  onChange,
}: {
  title: string;
  elements: DesignElement[];
  agents: AgentView[];
  onChange: (elements: DesignElement[]) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tool, setTool] = useState<'select' | 'hand'>('select');
  const [zoom, setZoom] = useState(1);
  const boardRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const panRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  // Local undo history of user edits. Snapshots are whole element lists, so an
  // undo also rolls back anything agents placed after that edit.
  const [past, setPast] = useState<DesignElement[][]>([]);
  const [future, setFuture] = useState<DesignElement[][]>([]);
  const selected = elements.find((element) => element.id === selectedId) ?? null;

  const commit = (next: DesignElement[]) => {
    setPast((history) => [...history, elements].slice(-MAX_HISTORY));
    setFuture([]);
    onChange(next);
  };
  const undo = () => {
    const previous = past.at(-1);
    if (!previous) return;
    setPast((history) => history.slice(0, -1));
    setFuture((redo) => [elements, ...redo].slice(0, MAX_HISTORY));
    onChange(previous);
  };
  const redo = () => {
    const next = future[0];
    if (!next) return;
    setFuture((redoStack) => redoStack.slice(1));
    setPast((history) => [...history, elements].slice(-MAX_HISTORY));
    onChange(next);
  };
  const removeSelected = () => {
    if (!selectedId) return;
    commit(elements.filter((element) => element.id !== selectedId));
    setSelectedId(null);
  };
  const update = (id: string, patch: Partial<DesignElement>) =>
    elements.map((element) => element.id === id ? { ...element, ...patch } : element);

  const startEditing = (element: DesignElement) => {
    if (element.kind === 'connector') return;
    setSelectedId(element.id);
    setEditingId(element.id);
    setEditText(element.text);
  };
  const finishEditing = (save: boolean) => {
    if (editingId && save) {
      const current = elements.find((element) => element.id === editingId);
      if (current && current.text !== editText) commit(update(editingId, { text: editText.slice(0, 180) }));
    }
    setEditingId(null);
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (editingId) return;
    const modifier = event.metaKey || event.ctrlKey;
    if (modifier && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) redo(); else undo();
      return;
    }
    if (modifier && event.key.toLowerCase() === 'y') { event.preventDefault(); redo(); return; }
    if (!selected) return;
    if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); removeSelected(); return; }
    if (event.key === 'Enter') { event.preventDefault(); startEditing(selected); return; }
    if (event.key === 'Escape') { setSelectedId(null); return; }
    const step = event.shiftKey ? 5 : 1;
    const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key];
    if (!delta) return;
    event.preventDefault();
    commit(update(selected.id, {
      x: clamp(selected.x + delta[0], 0, 100 - selected.width),
      y: clamp(selected.y + delta[1], 0, 100 - selected.height),
    }));
  };

  const addElement = (kind: DesignElementKind) => {
    const id = `local-${kind}-${Date.now()}`;
    const index = elements.length;
    const defaults: Partial<Record<DesignElementKind, Partial<DesignElement>>> = {
      circle: { width: 12, height: 18, text: 'Idea', fill: '#eef5ff', stroke: '#9eb8e8' },
      text: { width: 26, height: 8, text: 'Add a heading', fill: '#ffffff', stroke: '#ffffff' },
      sticky: { width: 18, height: 20, text: 'New note', fill: '#fff3b8', stroke: '#e2c75f', rotation: -2 },
      card: { width: 22, height: 22, text: 'New asset', fill: '#ffffff', stroke: '#d9dfda' },
    };
    const next: DesignElement = {
      id,
      kind,
      x: 9 + (index * 4) % 58,
      y: 12 + (index * 5) % 52,
      width: 22,
      height: 18,
      text: 'New element',
      fill: '#ffffff',
      stroke: '#d9dfda',
      textColor: '#25312d',
      rotation: 0,
      owner: 'codex',
      ...defaults[kind],
    };
    commit([...elements, next]);
    setSelectedId(id);
  };

  const beginDrag = (event: React.PointerEvent, element: DesignElement, mode: DragState['mode'] = 'move') => {
    if (tool !== 'select' || editingId === element.id) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      id: element.id,
      mode,
      startX: event.clientX,
      startY: event.clientY,
      elementX: element.x,
      elementY: element.y,
      width: element.width,
      height: element.height,
      moved: false,
    };
    setSelectedId(element.id);
  };

  const moveElement = (event: React.PointerEvent) => {
    const drag = dragRef.current;
    const board = boardRef.current;
    if (!drag || !board) return;
    const bounds = board.getBoundingClientRect();
    const dx = ((event.clientX - drag.startX) / bounds.width) * 100;
    const dy = ((event.clientY - drag.startY) / bounds.height) * 100;
    if (!drag.moved) {
      if (Math.abs(dx) + Math.abs(dy) < 0.2) return;
      // Record one undo step per gesture, not per pointer move.
      drag.moved = true;
      setPast((history) => [...history, elements].slice(-MAX_HISTORY));
      setFuture([]);
    }
    onChange(
      elements.map((element) => {
        if (element.id !== drag.id) return element;
        if (drag.mode === 'resize') {
          return {
            ...element,
            width: clamp(drag.width + dx, 2, 100 - element.x),
            height: clamp(drag.height + dy, 1, 100 - element.y),
          };
        }
        return {
          ...element,
          x: clamp(drag.elementX + dx, 0, 100 - element.width),
          y: clamp(drag.elementY + dy, 0, 100 - element.height),
        };
      }),
    );
  };

  const endDrag = () => {
    dragRef.current = null;
  };

  return (
    <section className="design-workspace" aria-label="Collaborative design canvas">
      <header className="design-toolbar">
        <div className="design-toolbar-group">
          <button className={tool === 'select' ? 'active' : ''} onClick={() => setTool('select')} aria-label="Select tool">
            <MousePointer2 size={14} />
          </button>
          <button className={tool === 'hand' ? 'active' : ''} onClick={() => setTool('hand')} aria-label="Hand tool">
            <Hand size={14} />
          </button>
        </div>
        <span className="design-toolbar-divider" />
        <div className="design-toolbar-group asset-tools" aria-label="Add canvas element">
          <button onClick={() => addElement('card')}><Frame size={14} /><span>Frame</span></button>
          <button onClick={() => addElement('circle')}><Circle size={14} /><span>Shape</span></button>
          <button onClick={() => addElement('text')}><Type size={14} /><span>Text</span></button>
          <button onClick={() => addElement('sticky')}><StickyNote size={14} /><span>Note</span></button>
        </div>
        <span className="design-toolbar-divider" />
        <div className="design-toolbar-group" aria-label="Edit canvas">
          <button onClick={undo} disabled={past.length === 0} aria-label="Undo" title="Undo (Ctrl+Z)"><Undo2 size={14} /></button>
          <button onClick={redo} disabled={future.length === 0} aria-label="Redo" title="Redo (Ctrl+Shift+Z)"><Redo2 size={14} /></button>
          <button onClick={removeSelected} disabled={!selected} aria-label="Delete selected element" title="Delete (Del)"><Trash2 size={14} /></button>
        </div>
        <div className="canvas-presence" aria-label="Agents on the canvas">
          {agents
            .filter((agent) => agent.status !== 'queued')
            .slice(0, 3)
            .map((agent) => (
              <span key={agent.id} style={{ background: agent.color }} title={`${agent.name}: ${agent.task}`}>{agent.monogram}</span>
            ))}
        </div>
        <div className="zoom-controls">
          <button onClick={() => setZoom((current) => clamp(current - 0.1, 0.7, 1.4))} aria-label="Zoom out"><Minus size={12} /></button>
          <span>{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom((current) => clamp(current + 0.1, 0.7, 1.4))} aria-label="Zoom in"><Plus size={12} /></button>
        </div>
      </header>

      <div ref={scrollRef} className={`design-board-scroll ${tool === 'hand' ? 'pannable' : ''}`}
        onPointerDown={(event) => {
          if (tool !== 'hand' || event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          panRef.current = { x: event.clientX, y: event.clientY, left: event.currentTarget.scrollLeft, top: event.currentTarget.scrollTop };
        }}
        onPointerMove={(event) => {
          const pan = panRef.current;
          if (!pan) return;
          event.currentTarget.scrollLeft = pan.left - (event.clientX - pan.x);
          event.currentTarget.scrollTop = pan.top - (event.clientY - pan.y);
        }}
        onPointerUp={() => { panRef.current = null; }}
        onPointerCancel={() => { panRef.current = null; }}
        onLostPointerCapture={() => { panRef.current = null; }}
      >
        <div
          ref={boardRef}
          className="design-board"
          role="application"
          aria-label="Design board. Tab to an element; arrow keys move it, Enter edits its text, Delete removes it."
          onKeyDown={handleKeyDown}
          style={{ width: `${zoom * 100}%`, minWidth: `${760 * zoom}px` }}
          onPointerMove={moveElement}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onClick={(event) => {
            if (event.target === event.currentTarget) setSelectedId(null);
          }}
        >
          {elements.length === 0 && (
            <div className="empty-design-canvas">
              <span><Shapes size={25} /></span>
              <strong>Your canvas is ready</strong>
              <p>Describe a visual, diagram, or board below. The agents will compose it here together.</p>
            </div>
          )}
          {title && <div className="canvas-title-chip"><Sparkles size={11} /> {title}</div>}
          {elements.map((element) => {
            if (element.kind === 'connector') {
              return (
                <svg
                  key={element.id}
                  className={`canvas-element canvas-connector ${selectedId === element.id ? 'selected' : ''}`}
                  style={{ left: `${element.x}%`, top: `${element.y}%`, width: `${element.width}%`, height: `${element.height}%` }}
                  viewBox="0 0 100 100"
                  preserveAspectRatio="none"
                  onPointerDown={(event) => beginDrag(event, element)}
                  tabIndex={0}
                  role="img"
                  onFocus={() => setSelectedId(element.id)}
                  aria-label={element.text || 'Diagram connector'}
                >
                  <defs>
                    <marker id={`arrow-${element.id}`} markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
                      <polygon points="0 0, 7 3.5, 0 7" fill={element.stroke} />
                    </marker>
                  </defs>
                  <line x1="2" y1="50" x2="94" y2="50" stroke={element.stroke} strokeWidth="2" vectorEffect="non-scaling-stroke" markerEnd={`url(#arrow-${element.id})`} />
                </svg>
              );
            }

            return (
              <div
                key={element.id}
                className={`canvas-element canvas-${element.kind} ${selectedId === element.id ? 'selected' : ''}`}
                style={{
                  left: `${element.x}%`,
                  top: `${element.y}%`,
                  width: `${element.width}%`,
                  height: `${element.height}%`,
                  background: element.fill,
                  borderColor: element.stroke,
                  color: element.textColor,
                  transform: `rotate(${element.rotation}deg)`,
                  '--owner-color': OWNER_COLORS[element.owner],
                } as React.CSSProperties}
                onPointerDown={(event) => beginDrag(event, element)}
                onDoubleClick={() => startEditing(element)}
                tabIndex={0}
                role="group"
                aria-label={`${element.kind}: ${element.text || 'empty'}`}
                onFocus={() => setSelectedId(element.id)}
                title={`Created by ${agents.find((agent) => agent.id === element.owner)?.name ?? element.owner} · double-click to edit`}
              >
                {element.kind === 'icon' && <Sparkles size={Math.max(14, Math.min(28, element.width))} />}
                {editingId === element.id ? (
                  <textarea
                    className="canvas-text-editor"
                    aria-label="Element text"
                    autoFocus
                    value={editText}
                    maxLength={180}
                    style={{ color: element.textColor }}
                    onPointerDown={(event) => event.stopPropagation()}
                    onChange={(event) => setEditText(event.target.value)}
                    onBlur={() => finishEditing(true)}
                    onKeyDown={(event) => {
                      event.stopPropagation();
                      if (event.key === 'Escape') finishEditing(false);
                      if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); finishEditing(true); }
                    }}
                  />
                ) : <span>{element.text}</span>}
                <i className="design-owner-dot" />
                {selectedId === element.id && editingId !== element.id && (
                  <i className="canvas-resize-handle" aria-hidden="true" onPointerDown={(event) => beginDrag(event, element, 'resize')} />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
