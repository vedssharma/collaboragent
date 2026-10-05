import { gateway, Output, ToolLoopAgent } from 'ai';
import { z } from 'zod';
import type {
  DesignElement,
  ResearchPaper,
  ResearchSource,
  RunEventInput,
  WorkType,
} from '@/lib/types';
import { createUsageTracker, resolveModels } from '@/lib/models';
import { refinementContext, type Refinement } from '@/lib/refinement';
import { collectSearchUrls, reconcileCitations, verifySources } from '@/lib/research-verification';

export const LIVE_MODELS = resolveModels();

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

export type LiveEventInput = RunEventInput;
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

type Review = z.infer<typeof reviewSchema>;

/** What the producing agent needs to act on a review, without the checks that already passed. */
function reviewFeedback(review: Review) {
  return JSON.stringify({
    summary: review.summary,
    failedChecks: review.checks.filter((check) => !check.passed),
    risks: review.risks,
    nextStep: review.nextStep,
  }, null, 2);
}

function emitReview(emit: EmitLiveEvent, review: Review, {
  approved,
  changesRequested,
  revised,
  progress,
}: { approved: string; changesRequested: string; revised: boolean; progress: number }) {
  const passed = review.checks.filter((check) => check.passed).length;
  emit({
    type: 'activity',
    agentId: 'reviewer',
    status: 'done',
    message: review.verdict === 'approved' ? approved : changesRequested,
    detail: `${revised ? 'Revised after review · ' : ''}${review.summary} · ${passed}/${review.checks.length} checks passed · quality score ${review.score}/100`,
    checks: { passed, total: review.checks.length },
    model: LIVE_MODELS.reviewer,
    progress,
    taskId: 'review',
  });
}

function emitRevisionStart(emit: EmitLiveEvent, review: Review, message: string, model: string) {
  emit({
    type: 'agent-status',
    agentId: 'codex',
    status: 'working',
    message,
    detail: `Addressing ${review.checks.filter((check) => !check.passed).length} failed checks · ${review.nextStep}`,
    model,
    progress: 88,
    taskId: 'review',
  });
}

function emitReReview(emit: EmitLiveEvent, message: string) {
  emit({
    type: 'agent-status',
    agentId: 'reviewer',
    status: 'reviewing',
    message,
    detail: 'Checking whether the revision resolved the earlier findings',
    model: LIVE_MODELS.reviewer,
    progress: 93,
    taskId: 'review',
  });
}

async function runCodingCollaboration({
  prompt,
  refine,
  signal,
  emit,
}: {
  prompt: string;
  refine?: Refinement;
  signal: AbortSignal;
  emit: EmitLiveEvent;
}) {
  ensureNotAborted(signal);
  const existingWork = refinementContext(refine);
  const usage = createUsageTracker();
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
    usage.track(architect.generate({
      prompt: `Mission:\n${prompt}\n\nCreate the implementation plan for this product.${existingWork}`,
      abortSignal: signal,
      timeout: 120_000,
    })),
    usage.track(researcher.generate({
      prompt: `Mission:\n${prompt}\n\nDevelop a focused UX research brief that the architect and builder can act on immediately.`,
      abortSignal: signal,
      timeout: 120_000,
    })),
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

  const buildResult = await usage.track(builder.generate({
    prompt: `Mission:\n${prompt}\n\nArchitecture plan:\n${JSON.stringify(plan, null, 2)}\n\nUX research:\n${JSON.stringify(research, null, 2)}\n\nBuild a coherent implementation that satisfies the plan.${existingWork}`,
    abortSignal: signal,
    timeout: 180_000,
  }));

  ensureNotAborted(signal);
  let build = buildResult.output;
  const emitFiles = (verb: string, start: number, span: number) => {
    for (let index = 0; index < build.files.length; index += 1) {
      const file = build.files[index];
      emit({
        type: 'file',
        agentId: 'codex',
        status: 'working',
        message: `${verb} ${file.path}`,
        detail: file.purpose,
        file: file.path,
        content: file.content,
        language: file.language,
        model: LIVE_MODELS.builder,
        cursor: { line: Math.min(24, file.content.split('\n').length), column: 8 },
        progress: start + Math.round(((index + 1) / build.files.length) * span),
        taskId: 'build',
      });
    }
  };
  emitFiles('Created', 48, 28);
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

  const reviewBuild = async () => {
    const result = await usage.track(reviewer.generate({
      prompt: `Mission:\n${prompt}\n\nArchitecture:\n${JSON.stringify(plan, null, 2)}\n\nUX research:\n${JSON.stringify(research, null, 2)}\n\nImplementation artifacts:\n${JSON.stringify(artifactDigest(build.files), null, 2)}\n\nReview these artifacts now.`,
      abortSignal: signal,
      timeout: 120_000,
    }));
    ensureNotAborted(signal);
    return result.output;
  };
  const reviewLabels = { approved: 'Quality review approved', changesRequested: 'Quality review found follow-up work' };

  let review = await reviewBuild();
  let revised = false;
  if (review.verdict === 'changes-requested') {
    emitReview(emit, review, { ...reviewLabels, revised, progress: 86 });
    emitRevisionStart(emit, review, 'Revising the implementation after review', LIVE_MODELS.builder);
    const revision = await usage.track(builder.generate({
      prompt: `Mission:\n${prompt}\n\nArchitecture plan:\n${JSON.stringify(plan, null, 2)}\n\nCurrent files:\n${JSON.stringify(build.files, null, 2)}\n\nIndependent review feedback:\n${reviewFeedback(review)}\n\nRevise the implementation to resolve every failed check. Return the complete revised file set, keeping paths stable unless a rename is necessary.`,
      abortSignal: signal,
      timeout: 180_000,
    }));
    ensureNotAborted(signal);
    build = revision.output;
    revised = true;
    // The revised file set replaces the draft so renamed or dropped files disappear.
    emit({ type: 'activity', agentId: 'codex', status: 'working', message: 'Replacing the draft with the revised files', resetArtifacts: true, model: LIVE_MODELS.builder, progress: 88, taskId: 'review' });
    emitFiles('Revised', 88, 4);
    emitReReview(emit, 'Re-reviewing the revised implementation');
    review = await reviewBuild();
  }
  emitReview(emit, review, { ...reviewLabels, revised, progress: 96 });
  emit({
    type: 'complete',
    usage: usage.totals,
    message: review.verdict === 'approved' ? 'Real agent run complete — artifacts are ready' : 'Real agent run complete — review notes are ready',
    detail: `${build.files.length} files generated${revised ? ' · revised once after review' : ''} · quality score ${review.score}/100 · ${review.nextStep}`,
    progress: 100,
    taskId: 'ship',
  });

  return { plan, research, build, review };
}

async function runDesignCollaboration({
  prompt,
  refine,
  signal,
  emit,
}: {
  prompt: string;
  refine?: Refinement;
  signal: AbortSignal;
  emit: EmitLiveEvent;
}) {
  ensureNotAborted(signal);
  const existingWork = refinementContext(refine);
  const usage = createUsageTracker();
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
    usage.track(designDirector.generate({
      prompt: `Design mission:\n${prompt}\n\nCreate a focused art direction for this canvas.${existingWork}`,
      abortSignal: signal,
      timeout: 120_000,
    })),
    usage.track(designResearcher.generate({
      prompt: `Design mission:\n${prompt}\n\nGive the visual team concrete audience, hierarchy, and usability guidance.`,
      abortSignal: signal,
      timeout: 120_000,
    })),
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

  const boardResult = await usage.track(designComposer.generate({
    prompt: `Design mission:\n${prompt}\n\nCreative direction:\n${JSON.stringify(direction, null, 2)}\n\nVisual research:\n${JSON.stringify(research, null, 2)}\n\nCompose the finished collaborative board.${existingWork}`,
    abortSignal: signal,
    timeout: 180_000,
  }));

  ensureNotAborted(signal);
  let board = boardResult.output;
  const emitBoard = (verb: string, start: number, span: number) => {
    for (let index = 0; index < board.elements.length; index += 1) {
      const element = board.elements[index] as DesignElement;
      emit({
        type: 'canvas',
        agentId: element.owner,
        status: 'working',
        message: `${verb} ${element.kind} on the canvas`,
        detail: element.text || `${element.width}% × ${element.height}% visual element`,
        designTitle: board.title,
        element,
        model: LIVE_MODELS.builder,
        progress: start + Math.round(((index + 1) / board.elements.length) * span),
        taskId: 'build',
      });
    }
  };
  emitBoard('Placed', 44, 34);
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

  const reviewBoard = async () => {
    const result = await usage.track(designReviewer.generate({
      prompt: `Design mission:\n${prompt}\n\nCreative direction:\n${JSON.stringify(direction, null, 2)}\n\nBoard:\n${JSON.stringify(board, null, 2)}\n\nCritique this board now.`,
      abortSignal: signal,
      timeout: 120_000,
    }));
    ensureNotAborted(signal);
    return result.output;
  };
  const reviewLabels = { approved: 'Design critique approved', changesRequested: 'Design critique found follow-up work' };

  let review = await reviewBoard();
  let revised = false;
  if (review.verdict === 'changes-requested') {
    emitReview(emit, review, { ...reviewLabels, revised, progress: 86 });
    emitRevisionStart(emit, review, 'Recomposing the canvas after critique', LIVE_MODELS.builder);
    const revision = await usage.track(designComposer.generate({
      prompt: `Design mission:\n${prompt}\n\nCreative direction:\n${JSON.stringify(direction, null, 2)}\n\nCurrent board:\n${JSON.stringify(board, null, 2)}\n\nDesign critique:\n${reviewFeedback(review)}\n\nRevise the board to resolve every failed check. Return the complete finished board.`,
      abortSignal: signal,
      timeout: 180_000,
    }));
    ensureNotAborted(signal);
    board = revision.output;
    revised = true;
    // The revised board replaces the first draft rather than merging into it.
    emit({ type: 'activity', agentId: 'codex', status: 'working', message: 'Replacing the draft with the revised board', resetArtifacts: true, model: LIVE_MODELS.builder, progress: 88, taskId: 'review' });
    emitBoard('Revised', 88, 4);
    emitReReview(emit, 'Re-critiquing the revised canvas');
    review = await reviewBoard();
  }
  emitReview(emit, review, { ...reviewLabels, revised, progress: 96 });
  emit({
    type: 'complete',
    usage: usage.totals,
    message: 'Design run complete — the canvas is ready',
    detail: `${board.elements.length} visual elements composed${revised ? ' · revised once after critique' : ''} · ${review.nextStep}`,
    progress: 100,
    taskId: 'ship',
  });

  return { direction, research, board, review };
}

async function runResearchCollaboration({
  prompt,
  refine,
  signal,
  emit,
}: {
  prompt: string;
  refine?: Refinement;
  signal: AbortSignal;
  emit: EmitLiveEvent;
}) {
  ensureNotAborted(signal);
  const existingWork = refinementContext(refine);
  const usage = createUsageTracker();
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
    usage.track(researchArchitect.generate({
      prompt: `Research topic:\n${prompt}\n\nDevelop a rigorous paper plan.${existingWork}`,
      abortSignal: signal,
      timeout: 120_000,
    })),
    usage.track(sourceResearcher.generate({
      prompt: `Research topic:\n${prompt}\n\nSearch the web for a diverse, credible source packet, then synthesize the evidence.`,
      abortSignal: signal,
      timeout: 180_000,
    })),
  ]);

  ensureNotAborted(signal);
  const outline = outlineResult.output;
  const searchUrls = collectSearchUrls(discoveryResult.steps);
  const { verified, rejected } = verifySources(discoveryResult.output.sources, searchUrls);
  if (verified.length === 0) {
    throw new Error('The web search returned no sources that match the research packet.');
  }
  const discovery = { ...discoveryResult.output, sources: verified };
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
      message: `Verified source ${index + 1} against search results`,
      detail: `${source.publisher} · ${source.title}`,
      source: source as ResearchSource,
      model: LIVE_MODELS.researcher,
      progress: 28 + Math.round(((index + 1) / discovery.sources.length) * 18),
      taskId: 'search',
    });
  });
  if (rejected.length > 0) {
    emit({
      type: 'activity',
      agentId: 'reviewer',
      status: 'reviewing',
      message: `Discarded ${rejected.length} source${rejected.length === 1 ? '' : 's'} not returned by web search`,
      detail: rejected.map((source) => source.url).join(' · ').slice(0, 600),
      model: LIVE_MODELS.researcher,
      progress: 47,
      taskId: 'search',
    });
  }
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

  const paperResult = await usage.track(paperWriter.generate({
    prompt: `Research topic:\n${prompt}\n\nApproved outline:\n${JSON.stringify(outline, null, 2)}\n\nVerified source packet:\n${JSON.stringify(discovery, null, 2)}\n\nWrite the detailed sourced paper now.${existingWork}`,
    abortSignal: signal,
    timeout: 240_000,
  }));

  ensureNotAborted(signal);
  const sourceIds = new Set(discovery.sources.map((source) => source.id));
  const checkCitations = (draft: ResearchPaper, progress: number) => {
    const citations = reconcileCitations(draft, sourceIds);
    if (citations.removedIds.length > 0 || citations.uncitedSections.length > 0) {
      emit({
        type: 'activity',
        agentId: 'reviewer',
        status: 'reviewing',
        message: 'Citation check found unsupported references',
        detail: [
          citations.removedIds.length ? `Removed unknown source ids: ${citations.removedIds.join(', ')}` : '',
          citations.uncitedSections.length ? `Sections without a verified citation: ${citations.uncitedSections.join('; ')}` : '',
        ].filter(Boolean).join(' · '),
        model: LIVE_MODELS.reviewer,
        progress,
        taskId: 'build',
      });
    }
    return citations;
  };
  let citations = checkCitations(paperResult.output as ResearchPaper, 79);
  emit({
    type: 'paper',
    agentId: 'codex',
    status: 'done',
    message: 'Full research paper drafted',
    detail: `${citations.paper.sections.length} evidence-backed sections with ${discovery.sources.length} verified sources`,
    paper: citations.paper,
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

  const reviewPaper = async () => {
    const result = await usage.track(researchReviewer.generate({
      prompt: `Original topic:\n${prompt}\n\nResearch plan:\n${JSON.stringify(outline, null, 2)}\n\nVerified sources:\n${JSON.stringify(discovery.sources, null, 2)}\n\nPaper:\n${JSON.stringify(citations.paper, null, 2)}\n\n${citations.uncitedSections.length ? `Automated citation check: these sections cite no verified source: ${citations.uncitedSections.join('; ')}.\n\n` : ''}Review this paper now.`,
      abortSignal: signal,
      timeout: 120_000,
    }));
    ensureNotAborted(signal);
    return result.output;
  };
  const reviewLabels = { approved: 'Research review approved', changesRequested: 'Research review found follow-up work' };

  let review = await reviewPaper();
  let revised = false;
  if (review.verdict === 'changes-requested') {
    emitReview(emit, review, { ...reviewLabels, revised, progress: 86 });
    emitRevisionStart(emit, review, 'Revising the paper after editorial review', LIVE_MODELS.builder);
    const revision = await usage.track(paperWriter.generate({
      prompt: `Research topic:\n${prompt}\n\nApproved outline:\n${JSON.stringify(outline, null, 2)}\n\nVerified source packet:\n${JSON.stringify(discovery, null, 2)}\n\nCurrent paper:\n${JSON.stringify(citations.paper, null, 2)}\n\nEditorial review:\n${reviewFeedback(review)}\n\nRevise the paper to resolve every failed check. Cite only source ids from the packet. Return the complete revised paper.`,
      abortSignal: signal,
      timeout: 240_000,
    }));
    ensureNotAborted(signal);
    citations = checkCitations(revision.output as ResearchPaper, 90);
    revised = true;
    emit({
      type: 'paper',
      agentId: 'codex',
      status: 'done',
      message: 'Revised paper delivered',
      detail: `${citations.paper.sections.length} sections revised against the editorial review`,
      paper: citations.paper,
      model: LIVE_MODELS.builder,
      progress: 91,
      taskId: 'review',
    });
    emitReReview(emit, 'Re-reviewing the revised paper');
    review = await reviewPaper();
  }
  emitReview(emit, review, { ...reviewLabels, revised, progress: 96 });
  const paper = citations.paper;
  emit({
    type: 'complete',
    usage: usage.totals,
    message: 'Research run complete — paper and sources are ready',
    detail: `${paper.sections.length} sections · ${discovery.sources.length} sources${revised ? ' · revised once after review' : ''} · ${review.nextStep}`,
    progress: 100,
    taskId: 'ship',
  });

  return { outline, discovery, paper, review };
}

export function runLiveCollaboration({
  prompt,
  workType,
  refine,
  signal,
  emit,
}: {
  prompt: string;
  workType: WorkType;
  refine?: Refinement;
  signal: AbortSignal;
  emit: EmitLiveEvent;
}) {
  if (workType === 'design') return runDesignCollaboration({ prompt, refine, signal, emit });
  if (workType === 'research') return runResearchCollaboration({ prompt, refine, signal, emit });
  return runCodingCollaboration({ prompt, refine, signal, emit });
}
