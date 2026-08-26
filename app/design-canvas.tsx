'use client';

import {
  Circle,
  Frame,
  Hand,
  Minus,
  MousePointer2,
  Plus,
  Shapes,
  Sparkles,
  StickyNote,
  Type,
} from 'lucide-react';
import { useRef, useState } from 'react';
import type { AgentView, DesignElement, DesignElementKind } from '@/lib/types';

type DragState = {
  id: string;
  startX: number;
  startY: number;
  elementX: number;
  elementY: number;
};

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
  const dragRef = useRef<DragState | null>(null);

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
    onChange([...elements, next]);
    setSelectedId(id);
  };

  const beginDrag = (event: React.PointerEvent, element: DesignElement) => {
    if (tool !== 'select') return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      id: element.id,
      startX: event.clientX,
      startY: event.clientY,
      elementX: element.x,
      elementY: element.y,
    };
    setSelectedId(element.id);
  };

  const moveElement = (event: React.PointerEvent) => {
    const drag = dragRef.current;
    const board = boardRef.current;
    if (!drag || !board) return;
    const bounds = board.getBoundingClientRect();
    const nextX = drag.elementX + ((event.clientX - drag.startX) / bounds.width) * 100;
    const nextY = drag.elementY + ((event.clientY - drag.startY) / bounds.height) * 100;
    onChange(
      elements.map((element) =>
        element.id === drag.id
          ? {
              ...element,
              x: clamp(nextX, 0, 100 - element.width),
              y: clamp(nextY, 0, 100 - element.height),
            }
          : element,
      ),
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

      <div className={`design-board-scroll ${tool === 'hand' ? 'pannable' : ''}`}>
        <div
          ref={boardRef}
          className="design-board"
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
                title={`Created by ${agents.find((agent) => agent.id === element.owner)?.name ?? element.owner}`}
              >
                {element.kind === 'icon' && <Sparkles size={Math.max(14, Math.min(28, element.width))} />}
                <span>{element.text}</span>
                <i className="design-owner-dot" />
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
