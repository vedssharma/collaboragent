'use client';

import {
  BookOpen,
  CheckCircle2,
  ExternalLink,
  FileText,
  Library,
  Quote,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import type { ResearchPaper as ResearchPaperType, ResearchSource } from '@/lib/types';

function publisherInitial(publisher: string) {
  return publisher.trim().slice(0, 1).toUpperCase() || 'S';
}

export function ResearchPaper({
  paper,
  sources,
}: {
  paper: ResearchPaperType | null;
  sources: ResearchSource[];
}) {
  const [activeSection, setActiveSection] = useState<string>('abstract');
  const sourceNumbers = useMemo(
    () => new Map(sources.map((source, index) => [source.id, index + 1])),
    [sources],
  );

  if (!paper) {
    return (
      <section className="research-workspace empty" aria-label="Research paper workspace">
        <aside className="research-outline-panel">
          <div className="research-panel-title"><BookOpen size={14} /> Paper outline</div>
          <div className="outline-skeleton"><span /><span /><span /><span /></div>
        </aside>
        <div className="empty-research-paper">
          <span><FileText size={26} /></span>
          <strong>A sourced paper will take shape here</strong>
          <p>Enter a topic below. The team will scope the question, search the web, synthesize evidence, and review the final paper.</p>
          {sources.length > 0 && <small>{sources.length} sources verified · writing in progress</small>}
        </div>
        <aside className="source-library-panel">
          <div className="research-panel-title"><Library size={14} /> Sources <em>{sources.length}</em></div>
          {sources.map((source, index) => (
            <a className="source-card" href={source.url} target="_blank" rel="noreferrer" key={source.id}>
              <span className="source-index">{index + 1}</span>
              <span><strong>{source.title}</strong><small>{source.publisher}</small></span>
              <ExternalLink size={11} />
            </a>
          ))}
        </aside>
      </section>
    );
  }

  return (
    <section className="research-workspace" aria-label="Research paper workspace">
      <aside className="research-outline-panel">
        <div className="research-panel-title"><BookOpen size={14} /> Contents</div>
        <button className={activeSection === 'abstract' ? 'active' : ''} onClick={() => setActiveSection('abstract')}>Abstract</button>
        {paper.sections.map((section, index) => (
          <button
            key={section.id}
            className={activeSection === section.id ? 'active' : ''}
            onClick={() => {
              setActiveSection(section.id);
              document.getElementById(`paper-${section.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }}
          >
            <span>{String(index + 1).padStart(2, '0')}</span>{section.heading}
          </button>
        ))}
        <button className={activeSection === 'conclusion' ? 'active' : ''} onClick={() => setActiveSection('conclusion')}>Conclusion</button>
        <div className="paper-status"><CheckCircle2 size={12} /> Reviewed draft</div>
      </aside>

      <article className="paper-scroll">
        <div className="paper-page">
          <header className="paper-cover">
            <span>Collaboragent RESEARCH</span>
            <h2>{paper.title}</h2>
            <p>{paper.subtitle}</p>
            <div><span>Multi-agent research team</span><span>{sources.length} verified sources</span></div>
          </header>
          <section id="paper-abstract" className="paper-abstract">
            <Quote size={18} />
            <div><h3>Abstract</h3><p>{paper.abstract}</p></div>
          </section>
          {paper.sections.map((section, index) => (
            <section
              id={`paper-${section.id}`}
              className="paper-section"
              key={section.id}
              onMouseEnter={() => setActiveSection(section.id)}
            >
              <span className="paper-section-number">{String(index + 1).padStart(2, '0')}</span>
              <h3>{section.heading}</h3>
              {section.paragraphs.map((paragraph, paragraphIndex) => (
                <p key={`${section.id}-${paragraphIndex}`}>{paragraph}</p>
              ))}
              <div className="inline-citations" aria-label="Sources cited in this section">
                {section.sourceIds
                  .filter((sourceId) => sourceNumbers.has(sourceId))
                  .map((sourceId) => (
                    <a key={sourceId} href={sources.find((source) => source.id === sourceId)?.url} target="_blank" rel="noreferrer">
                      [{sourceNumbers.get(sourceId)}]
                    </a>
                  ))}
              </div>
            </section>
          ))}
          <section id="paper-conclusion" className="paper-section paper-conclusion" onMouseEnter={() => setActiveSection('conclusion')}>
            <span className="paper-section-number">END</span>
            <h3>Conclusion</h3>
            <p>{paper.conclusion}</p>
          </section>
          <section className="bibliography">
            <h3>References</h3>
            {sources.map((source, index) => (
              <p key={source.id}>
                <span>{index + 1}.</span>
                <a href={source.url} target="_blank" rel="noreferrer">{source.title}</a>
                <small>{source.publisher}{source.publishedAt ? ` · ${source.publishedAt}` : ''}</small>
              </p>
            ))}
          </section>
        </div>
      </article>

      <aside className="source-library-panel">
        <div className="research-panel-title"><Library size={14} /> Source library <em>{sources.length}</em></div>
        {sources.map((source, index) => (
          <a className="source-card" href={source.url} target="_blank" rel="noreferrer" key={source.id}>
            <span className="publisher-mark">{publisherInitial(source.publisher)}</span>
            <span><strong>{source.title}</strong><small>{source.publisher}{source.publishedAt ? ` · ${source.publishedAt}` : ''}</small></span>
            <span className="source-number">{index + 1}</span>
          </a>
        ))}
      </aside>
    </section>
  );
}
