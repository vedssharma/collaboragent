import { gateway, Output, ToolLoopAgent } from 'ai';
import { z } from 'zod';
import type {
  DesignElement,
  ResearchPaper,
  ResearchSource,
  RunEvent,
  WorkType,
} from '@/lib/types';

export const LIVE_MODELS = {
  architect: 'anthropic/claude-sonnet-5',
  researcher: 'google/gemini-3.7-flash',
  builder: 'openai/gpt-5.3-codex-fast',
  reviewer: 'openai/gpt-5.6-luna-fast',
} as const;

const planSchema = z
  .object({
    summary: z.string().max(700),
    architecture: z.array(z.string().max(300)).min(1).max(6),
    workstreams: z
      .array(
        z
          .object({
            owner: z.enum(['claude', 'codex', 'gemini', 'reviewer']),
            goal: z.string().max(300),
            deliverables: z.array(z.string().max(200)).min(1).max(5),
          })
          .strict(),
      )
      .min(1)
      .max(6),
    acceptanceCriteria: z.array(z.string().max(240)).min(1).max(8),
  })
  .strict();

const researchSchema = z
  .object({
    direction: z.string().max(700),
    userNeeds: z.array(z.string().max(240)).min(1).max(6),
    uxPrinciples: z.array(z.string().max(240)).min(1).max(6),
    risks: z.array(z.string().max(240)).max(5),
  })
  .strict();

const buildSchema = z
  .object({
    summary: z.string().max(700),
    files: z
      .array(
        z
          .object({
            path: z
              .string()
              .min(1)
              .max(160)
              .regex(/^[a-zA-Z0-9_./-]+$/),
            language: z.string().min(1).max(40),
            purpose: z.string().max(300),
            content: z.string().min(1).max(16000),
          })
          .strict(),
      )
      .min(1)
      .max(5),
    decisions: z.array(z.string().max(260)).min(1).max(6),
  })
  .strict();

const reviewSchema = z
  .object({
    verdict: z.enum(['approved', 'changes-requested']),
    score: z.number().int().min(1).max(100),
    summary: z.string().max(700),
    checks: z
      .array(
        z
          .object({
            name: z.string().max(120),
            passed: z.boolean(),
            note: z.string().max(260),
          })
          .strict(),
      )
      .min(1)
      .max(10),
    risks: z.array(z.string().max(260)).max(5),
    nextStep: z.string().max(300),
  })
  .strict();

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);

const designDirectionSchema = z
  .object({
    concept: z.string().max(700),
    audience: z.string().max(300),
    visualPrinciples: z.array(z.string().max(220)).min(2).max(6),
    palette: z.array(hexColor).min(3).max(6),
  })
  .strict();

const designElementSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/).max(60),
    kind: z.enum(['frame', 'card', 'circle', 'text', 'sticky', 'connector', 'icon', 'badge']),
    x: z.number().min(0).max(95),
    y: z.number().min(0).max(95),
    width: z.number().min(2).max(94),
    height: z.number().min(1).max(92),
    text: z.string().max(180),
    fill: hexColor,
    stroke: hexColor,
    textColor: hexColor,
    rotation: z.number().min(-12).max(12),
    owner: z.enum(['claude', 'codex', 'gemini', 'reviewer']),
  })
  .strict();

const designBoardSchema = z
  .object({
    title: z.string().max(120),
    subtitle: z.string().max(240),
    background: hexColor,
    elements: z.array(designElementSchema).min(5).max(22),
    rationale: z.string().max(700),
  })
  .strict();

const researchOutlineSchema = z
  .object({
    thesis: z.string().max(700),
    researchQuestions: z.array(z.string().max(260)).min(2).max(6),
    sectionPlan: z.array(z.string().max(180)).min(3).max(7),
    evidenceStandards: z.array(z.string().max(220)).min(2).max(5),
  })
  .strict();

const researchSourceSchema = z
  .object({
    id: z.string().regex(/^src-[a-z0-9-]+$/).max(60),
    title: z.string().max(300),
    url: z.string().url().max(1200),
    publisher: z.string().max(160),
    publishedAt: z.string().max(60).optional(),
    summary: z.string().max(700),
  })
  .strict();

const researchDiscoverySchema = z
  .object({
    synthesis: z.string().max(1000),
    sources: z.array(researchSourceSchema).min(4).max(12),
    tensions: z.array(z.string().max(280)).min(1).max(6),
  })
  .strict();

const researchPaperSchema = z
  .object({
    title: z.string().max(220),
    subtitle: z.string().max(320),
    abstract: z.string().min(120).max(1600),
    sections: z
      .array(
        z
          .object({
            id: z.string().regex(/^[a-z0-9-]+$/).max(60),
            heading: z.string().max(180),
            paragraphs: z.array(z.string().min(100).max(1800)).min(2).max(5),
            sourceIds: z.array(z.string().max(60)).min(1).max(10),
          })
          .strict(),
      )
      .min(3)
      .max(7),
    conclusion: z.string().min(120).max(1800),
  })
  .strict();

export type LiveEventInput = Omit<RunEvent, 'id' | 'at' | 'mode'>;
type EmitLiveEvent = (event: LiveEventInput) => void;

const architect = new ToolLoopAgent({
  id: 'Collaboragent-architect',
  model: gateway(LIVE_MODELS.architect),
  maxOutputTokens: 2400,
  output: Output.object({ schema: planSchema, name: 'Collaboragent_architecture_plan' }),
  instructions: `You are Collaboragent's product architect. Turn an idea into a small, coherent MVP plan that other agents can execute.
Be concrete about information architecture, components, data flow, and acceptance criteria. Assign 2-4 workstreams when the scope supports it. Keep the scope achievable in one focused implementation pass. Do not write code.`,
});

const researcher = new ToolLoopAgent({
  id: 'Collaboragent-researcher',
  model: gateway(LIVE_MODELS.researcher),
  maxOutputTokens: 1800,
  output: Output.object({ schema: researchSchema, name: 'Collaboragent_ux_research' }),
  instructions: `You are Collaboragent's UX researcher. Analyze the requested product from the end user's perspective.
Return a crisp interaction direction, essential user needs, practical UX principles, and realistic risks. Avoid generic advice and keep the recommendations implementable.`,
});

const builder = new ToolLoopAgent({
  id: 'Collaboragent-builder',
  model: gateway(LIVE_MODELS.builder),
  maxOutputTokens: 9000,
  output: Output.object({ schema: buildSchema, name: 'Collaboragent_project_artifacts' }),
  instructions: `You are Collaboragent's lead implementation agent. Build a compact, polished, self-contained web product from the mission and the other agents' findings.
Return complete file contents, not patches or placeholders. Prefer 2-4 high-value files over a wide unfinished scaffold. Use accessible semantic HTML, responsive CSS, and dependency-light TypeScript/React when appropriate. Paths must be relative and safe. Do not use markdown fences inside file contents.`,
});

const reviewer = new ToolLoopAgent({
  id: 'Collaboragent-reviewer',
  model: gateway(LIVE_MODELS.reviewer),
  maxOutputTokens: 2200,
  output: Output.object({ schema: reviewSchema, name: 'Collaboragent_quality_review' }),
  instructions: `You are Collaboragent's independent quality reviewer. Evaluate implementation artifacts against the original mission, architecture, UX direction, accessibility, coherence, and basic code safety.
Approve only when the artifacts form a credible focused MVP. Be concise and specific.`,
});

const designDirector = new ToolLoopAgent({
  id: 'Collaboragent-design-director',
  model: gateway(LIVE_MODELS.architect),
  maxOutputTokens: 2200,
  output: Output.object({ schema: designDirectionSchema, name: 'Collaboragent_design_direction' }),
  instructions: `You are Collaboragent's creative director. Turn a user's visual request into a precise art direction for a collaborative canvas.
Define the audience, visual hierarchy, composition principles, and a cohesive accessible color palette. Focus on a single strong direction that another agent can compose immediately.`,
});

const designResearcher = new ToolLoopAgent({
  id: 'Collaboragent-design-researcher',
  model: gateway(LIVE_MODELS.researcher),
  maxOutputTokens: 1800,
  output: Output.object({ schema: researchSchema, name: 'Collaboragent_design_research' }),
  instructions: `You are Collaboragent's visual UX researcher. Interpret the user's design goal, identify what viewers must understand first, and give practical layout and legibility guidance.
Your recommendations must work on a finite collaborative canvas and should cover diagrams, labels, visual assets, and information flow when relevant.`,
});

const designComposer = new ToolLoopAgent({
  id: 'Collaboragent-design-composer',
  model: gateway(LIVE_MODELS.builder),
  maxOutputTokens: 7000,
  output: Output.object({ schema: designBoardSchema, name: 'Collaboragent_design_board' }),
  instructions: `You are Collaboragent's lead visual designer. Compose a polished 100-by-100 spatial canvas from a mission and two expert briefs.
Use frames, cards, circles, text, sticky notes, icons, badges, and connectors to create the requested visual. Coordinates and dimensions are percentages. Keep every element inside the canvas, avoid accidental overlap, establish obvious reading order, and ensure text has strong color contrast.
Use connectors for diagrams and distinct asset-like cards or symbols when useful. Assign meaningful elements across claude, gemini, and codex to reflect collaboration. Return a finished board, not implementation code.`,
});

const designReviewer = new ToolLoopAgent({
  id: 'Collaboragent-design-reviewer',
  model: gateway(LIVE_MODELS.reviewer),
  maxOutputTokens: 1800,
  output: Output.object({ schema: reviewSchema, name: 'Collaboragent_design_review' }),
  instructions: `You are Collaboragent's design critic. Review a spatial canvas against the user's request, art direction, visual hierarchy, readability, accessibility, and completeness.
Judge whether the board communicates clearly as a finished visual artifact. Be concise and specific.`,
});

const researchArchitect = new ToolLoopAgent({
  id: 'Collaboragent-research-architect',
  model: gateway(LIVE_MODELS.architect),
  maxOutputTokens: 2200,
  output: Output.object({ schema: researchOutlineSchema, name: 'Collaboragent_research_outline' }),
  instructions: `You are Collaboragent's principal investigator. Convert a topic into a rigorous, balanced research plan with a defensible thesis, focused questions, a paper outline, and explicit evidence standards.
Anticipate counterarguments and avoid assuming the user's premise is true.`,
});

const sourceResearcher = new ToolLoopAgent({
  id: 'Collaboragent-source-researcher',
  model: gateway(LIVE_MODELS.researcher),
  maxOutputTokens: 5000,
  tools: {
    webSearch: gateway.tools.perplexitySearch({
      maxResults: 12,
      maxTokensPerPage: 1200,
      maxTokens: 12000,
      searchLanguageFilter: ['en'],
    }),
  },
  output: Output.object({ schema: researchDiscoverySchema, name: 'Collaboragent_source_research' }),
  instructions: `You are Collaboragent's source researcher. You must use webSearch before answering. Search broadly enough to include primary sources, academic work, and credible institutional or journalistic context where appropriate.
Only include sources returned by the tool. Preserve their exact titles and URLs; never invent or repair a URL. Give every source a stable id beginning with src-. Synthesize agreements, disagreements, limitations, and dates that matter.`,
});

const paperWriter = new ToolLoopAgent({
  id: 'Collaboragent-paper-writer',
  model: gateway(LIVE_MODELS.builder),
  maxOutputTokens: 10000,
  output: Output.object({ schema: researchPaperSchema, name: 'Collaboragent_research_paper' }),
  instructions: `You are Collaboragent's senior research writer. Produce a detailed, readable research paper from an approved outline and a verified source packet.
Every section must make an argument, distinguish evidence from inference, acknowledge meaningful uncertainty, and cite only the supplied source ids. Use multiple paragraphs per section. Never add facts, URLs, or source ids that are absent from the packet.`,
});

const researchReviewer = new ToolLoopAgent({
  id: 'Collaboragent-research-reviewer',
  model: gateway(LIVE_MODELS.reviewer),
  maxOutputTokens: 2200,
  output: Output.object({ schema: reviewSchema, name: 'Collaboragent_research_review' }),
  instructions: `You are Collaboragent's independent research editor. Review a paper for fidelity to the question, source quality, citation coverage, balance, internal logic, clarity, and unsupported claims.
Approve only if it is a credible sourced research paper. Be concise and specific.`,
});

function ensureNotAborted(signal: AbortSignal) {
  if (signal.aborted) throw new DOMException('Run cancelled', 'AbortError');
}

function artifactDigest(files: Array<{ path: string; purpose: string; content: string }>) {
  return files.map((file) => ({
    path: file.path,
    purpose: file.purpose,
    preview: file.content.slice(0, 5000),
  }));
}

async function runCodingCollaboration({
  prompt,
  signal,
  emit,
}: {
  prompt: string;
  signal: AbortSignal;
  emit: EmitLiveEvent;
}) {
  ensureNotAborted(signal);
  emit({
    type: 'run',
    message: 'Authenticated multi-provider run started',
    detail: 'Claude and Gemini are working in parallel before Codex builds.',
    progress: 4,
  });
  emit({
    type: 'agent-status',
    agentId: 'claude',
    status: 'thinking',
    message: 'Designing the product architecture',
    detail: 'Defining scope, workstreams, and acceptance criteria',
    model: LIVE_MODELS.architect,
    progress: 8,
  });
  emit({
    type: 'agent-status',
    agentId: 'gemini',
    status: 'working',
    message: 'Researching the user experience',
    detail: 'Mapping user needs, interaction principles, and risks',
    model: LIVE_MODELS.researcher,
    progress: 10,
  });

  const [planResult, researchResult] = await Promise.all([
    architect.generate({
      prompt: `Mission:\n${prompt}\n\nCreate the implementation plan for this product.`,
      abortSignal: signal,
      timeout: 120_000,
    }),
    researcher.generate({
      prompt: `Mission:\n${prompt}\n\nDevelop a focused UX research brief that the architect and builder can act on immediately.`,
      abortSignal: signal,
      timeout: 120_000,
    }),
  ]);

  ensureNotAborted(signal);
  const plan = planResult.output;
  const research = researchResult.output;
  emit({
    type: 'activity',
    agentId: 'claude',
    status: 'done',
    message: 'Architecture plan is ready',
    detail: plan.summary,
    model: LIVE_MODELS.architect,
    progress: 28,
    taskId: 'plan',
  });
  emit({
    type: 'activity',
    agentId: 'gemini',
    status: 'done',
    message: 'UX direction is ready',
    detail: research.direction,
    model: LIVE_MODELS.researcher,
    progress: 34,
  });
  emit({
    type: 'agent-status',
    agentId: 'codex',
    status: 'working',
    message: 'Building the implementation artifacts',
    detail: 'Synthesizing the mission, architecture, and UX findings',
    model: LIVE_MODELS.builder,
    progress: 40,
    taskId: 'build',
  });

  const buildResult = await builder.generate({
    prompt: `Mission:\n${prompt}\n\nArchitecture plan:\n${JSON.stringify(plan, null, 2)}\n\nUX research:\n${JSON.stringify(research, null, 2)}\n\nBuild a coherent implementation that satisfies the plan.`,
    abortSignal: signal,
    timeout: 180_000,
  });

  ensureNotAborted(signal);
  const build = buildResult.output;
  for (let index = 0; index < build.files.length; index += 1) {
    const file = build.files[index];
    emit({
      type: 'file',
      agentId: 'codex',
      status: 'working',
      message: `Created ${file.path}`,
      detail: file.purpose,
      file: file.path,
      content: file.content,
      language: file.language,
      model: LIVE_MODELS.builder,
      cursor: { line: Math.min(24, file.content.split('\n').length), column: 8 },
      progress: 48 + Math.round(((index + 1) / build.files.length) * 28),
      taskId: 'build',
    });
  }
  emit({
    type: 'activity',
    agentId: 'codex',
    status: 'done',
    message: 'Implementation artifacts are ready',
    detail: build.summary,
    model: LIVE_MODELS.builder,
    progress: 78,
    taskId: 'build',
  });
  emit({
    type: 'agent-status',
    agentId: 'reviewer',
    status: 'reviewing',
    message: 'Running an independent quality review',
    detail: 'Checking scope, UX, accessibility, coherence, and safety',
    model: LIVE_MODELS.reviewer,
    progress: 84,
    taskId: 'review',
  });

  const reviewResult = await reviewer.generate({
    prompt: `Mission:\n${prompt}\n\nArchitecture:\n${JSON.stringify(plan, null, 2)}\n\nUX research:\n${JSON.stringify(research, null, 2)}\n\nImplementation artifacts:\n${JSON.stringify(artifactDigest(build.files), null, 2)}\n\nReview these artifacts now.`,
    abortSignal: signal,
    timeout: 120_000,
  });

  ensureNotAborted(signal);
  const review = reviewResult.output;
  const passedChecks = review.checks.filter((check) => check.passed).length;
  emit({
    type: 'activity',
    agentId: 'reviewer',
    status: 'done',
    message: review.verdict === 'approved' ? 'Quality review approved' : 'Quality review found follow-up work',
    detail: `${review.summary} · ${passedChecks}/${review.checks.length} checks passed`,
    model: LIVE_MODELS.reviewer,
    progress: 96,
    taskId: 'review',
  });
  emit({
    type: 'complete',
    message: review.verdict === 'approved' ? 'Real agent run complete — artifacts are ready' : 'Real agent run complete — review notes are ready',
    detail: `${build.files.length} files generated · quality score ${review.score}/100 · ${review.nextStep}`,
    progress: 100,
    taskId: 'ship',
  });

  return { plan, research, build, review };
}

async function runDesignCollaboration({
  prompt,
  signal,
  emit,
}: {
  prompt: string;
  signal: AbortSignal;
  emit: EmitLiveEvent;
}) {
  ensureNotAborted(signal);
  emit({
    type: 'run',
    message: 'Collaborative design run started',
    detail: 'Creative direction and visual research are happening in parallel.',
    progress: 4,
  });
  emit({
    type: 'agent-status',
    agentId: 'claude',
    status: 'thinking',
    message: 'Setting the creative direction',
    detail: 'Defining the visual concept, hierarchy, and palette',
    model: LIVE_MODELS.architect,
    progress: 8,
  });
  emit({
    type: 'agent-status',
    agentId: 'gemini',
    status: 'working',
    message: 'Studying the audience and information flow',
    detail: 'Mapping legibility, layout, and diagram needs',
    model: LIVE_MODELS.researcher,
    progress: 10,
  });

  const [directionResult, researchResult] = await Promise.all([
    designDirector.generate({
      prompt: `Design mission:\n${prompt}\n\nCreate a focused art direction for this canvas.`,
      abortSignal: signal,
      timeout: 120_000,
    }),
    designResearcher.generate({
      prompt: `Design mission:\n${prompt}\n\nGive the visual team concrete audience, hierarchy, and usability guidance.`,
      abortSignal: signal,
      timeout: 120_000,
    }),
  ]);

  ensureNotAborted(signal);
  const direction = directionResult.output;
  const research = researchResult.output;
  emit({
    type: 'activity',
    agentId: 'claude',
    status: 'done',
    message: 'Creative direction approved',
    detail: direction.concept,
    model: LIVE_MODELS.architect,
    progress: 28,
    taskId: 'plan',
  });
  emit({
    type: 'activity',
    agentId: 'gemini',
    status: 'done',
    message: 'Visual research brief is ready',
    detail: research.direction,
    model: LIVE_MODELS.researcher,
    progress: 34,
  });
  emit({
    type: 'agent-status',
    agentId: 'codex',
    status: 'working',
    message: 'Composing the shared canvas',
    detail: 'Arranging assets, shapes, labels, and connections',
    model: LIVE_MODELS.builder,
    progress: 40,
    taskId: 'build',
  });

  const boardResult = await designComposer.generate({
    prompt: `Design mission:\n${prompt}\n\nCreative direction:\n${JSON.stringify(direction, null, 2)}\n\nVisual research:\n${JSON.stringify(research, null, 2)}\n\nCompose the finished collaborative board.`,
    abortSignal: signal,
    timeout: 180_000,
  });

  ensureNotAborted(signal);
  const board = boardResult.output;
  for (let index = 0; index < board.elements.length; index += 1) {
    const element = board.elements[index] as DesignElement;
    emit({
      type: 'canvas',
      agentId: element.owner,
      status: 'working',
      message: `Placed ${element.kind} on the canvas`,
      detail: element.text || `${element.width}% × ${element.height}% visual element`,
      designTitle: board.title,
      element,
      model: LIVE_MODELS.builder,
      progress: 44 + Math.round(((index + 1) / board.elements.length) * 34),
      taskId: 'build',
    });
  }
  emit({
    type: 'activity',
    agentId: 'codex',
    status: 'done',
    message: 'Canvas composition is complete',
    detail: board.rationale,
    model: LIVE_MODELS.builder,
    progress: 79,
    taskId: 'build',
  });
  emit({
    type: 'agent-status',
    agentId: 'reviewer',
    status: 'reviewing',
    message: 'Critiquing the visual system',
    detail: 'Checking hierarchy, legibility, accessibility, and completeness',
    model: LIVE_MODELS.reviewer,
    progress: 84,
    taskId: 'review',
  });

  const reviewResult = await designReviewer.generate({
    prompt: `Design mission:\n${prompt}\n\nCreative direction:\n${JSON.stringify(direction, null, 2)}\n\nBoard:\n${JSON.stringify(board, null, 2)}\n\nCritique this board now.`,
    abortSignal: signal,
    timeout: 120_000,
  });
  const review = reviewResult.output;
  emit({
    type: 'activity',
    agentId: 'reviewer',
    status: 'done',
    message: review.verdict === 'approved' ? 'Design critique approved' : 'Design critique found follow-up work',
    detail: `${review.summary} · quality score ${review.score}/100`,
    model: LIVE_MODELS.reviewer,
    progress: 96,
    taskId: 'review',
  });
  emit({
    type: 'complete',
    message: 'Design run complete — the canvas is ready',
    detail: `${board.elements.length} visual elements composed · ${review.nextStep}`,
    progress: 100,
    taskId: 'ship',
  });

  return { direction, research, board, review };
}

async function runResearchCollaboration({
  prompt,
  signal,
  emit,
}: {
  prompt: string;
  signal: AbortSignal;
  emit: EmitLiveEvent;
}) {
  ensureNotAborted(signal);
  emit({
    type: 'run',
    message: 'Collaborative research run started',
    detail: 'The team is defining the inquiry and searching the web in parallel.',
    progress: 4,
  });
  emit({
    type: 'agent-status',
    agentId: 'claude',
    status: 'thinking',
    message: 'Framing the research question',
    detail: 'Defining the thesis, outline, and evidence standards',
    model: LIVE_MODELS.architect,
    progress: 8,
  });
  emit({
    type: 'agent-status',
    agentId: 'gemini',
    status: 'working',
    message: 'Searching for credible sources',
    detail: 'Gathering primary, academic, and institutional evidence',
    model: LIVE_MODELS.researcher,
    progress: 10,
  });

  const [outlineResult, discoveryResult] = await Promise.all([
    researchArchitect.generate({
      prompt: `Research topic:\n${prompt}\n\nDevelop a rigorous paper plan.`,
      abortSignal: signal,
      timeout: 120_000,
    }),
    sourceResearcher.generate({
      prompt: `Research topic:\n${prompt}\n\nSearch the web for a diverse, credible source packet, then synthesize the evidence.`,
      abortSignal: signal,
      timeout: 180_000,
    }),
  ]);

  ensureNotAborted(signal);
  const outline = outlineResult.output;
  const discovery = discoveryResult.output;
  emit({
    type: 'activity',
    agentId: 'claude',
    status: 'done',
    message: 'Research plan is ready',
    detail: outline.thesis,
    model: LIVE_MODELS.architect,
    progress: 25,
    taskId: 'plan',
  });
  discovery.sources.forEach((source, index) => {
    emit({
      type: 'source',
      agentId: 'gemini',
      status: 'working',
      message: `Verified source ${index + 1}`,
      detail: `${source.publisher} · ${source.title}`,
      source: source as ResearchSource,
      model: LIVE_MODELS.researcher,
      progress: 28 + Math.round(((index + 1) / discovery.sources.length) * 18),
      taskId: 'search',
    });
  });
  emit({
    type: 'activity',
    agentId: 'gemini',
    status: 'done',
    message: 'Source packet and evidence synthesis are ready',
    detail: discovery.synthesis,
    model: LIVE_MODELS.researcher,
    progress: 48,
    taskId: 'search',
  });
  emit({
    type: 'agent-status',
    agentId: 'codex',
    status: 'working',
    message: 'Writing the research paper',
    detail: 'Synthesizing the evidence with source-linked sections',
    model: LIVE_MODELS.builder,
    progress: 52,
    taskId: 'build',
  });

  const paperResult = await paperWriter.generate({
    prompt: `Research topic:\n${prompt}\n\nApproved outline:\n${JSON.stringify(outline, null, 2)}\n\nVerified source packet:\n${JSON.stringify(discovery, null, 2)}\n\nWrite the detailed sourced paper now.`,
    abortSignal: signal,
    timeout: 240_000,
  });

  ensureNotAborted(signal);
  const paper = paperResult.output as ResearchPaper;
  emit({
    type: 'paper',
    agentId: 'codex',
    status: 'done',
    message: 'Full research paper drafted',
    detail: `${paper.sections.length} evidence-backed sections with ${discovery.sources.length} verified sources`,
    paper,
    model: LIVE_MODELS.builder,
    progress: 80,
    taskId: 'build',
  });
  emit({
    type: 'agent-status',
    agentId: 'reviewer',
    status: 'reviewing',
    message: 'Fact-checking and reviewing the paper',
    detail: 'Checking source fidelity, balance, logic, and citation coverage',
    model: LIVE_MODELS.reviewer,
    progress: 85,
    taskId: 'review',
  });

  const reviewResult = await researchReviewer.generate({
    prompt: `Original topic:\n${prompt}\n\nResearch plan:\n${JSON.stringify(outline, null, 2)}\n\nVerified sources:\n${JSON.stringify(discovery.sources, null, 2)}\n\nPaper:\n${JSON.stringify(paper, null, 2)}\n\nReview this paper now.`,
    abortSignal: signal,
    timeout: 120_000,
  });
  const review = reviewResult.output;
  emit({
    type: 'activity',
    agentId: 'reviewer',
    status: 'done',
    message: review.verdict === 'approved' ? 'Research review approved' : 'Research review found follow-up work',
    detail: `${review.summary} · quality score ${review.score}/100`,
    model: LIVE_MODELS.reviewer,
    progress: 96,
    taskId: 'review',
  });
  emit({
    type: 'complete',
    message: 'Research run complete — paper and sources are ready',
    detail: `${paper.sections.length} sections · ${discovery.sources.length} sources · ${review.nextStep}`,
    progress: 100,
    taskId: 'ship',
  });

  return { outline, discovery, paper, review };
}

export function runLiveCollaboration({
  prompt,
  workType,
  signal,
  emit,
}: {
  prompt: string;
  workType: WorkType;
  signal: AbortSignal;
  emit: EmitLiveEvent;
}) {
  if (workType === 'design') return runDesignCollaboration({ prompt, signal, emit });
  if (workType === 'research') return runResearchCollaboration({ prompt, signal, emit });
  return runCodingCollaboration({ prompt, signal, emit });
}
