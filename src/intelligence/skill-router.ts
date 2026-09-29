import { readFileSync } from 'node:fs';
import {
  discloseSkills,
  resolveSkills,
  type ResolvedSkill,
  type SkillDisclosure,
  type SkillResolution,
} from '../skills/resolver.js';
import { redactText } from '../security/redact.js';
import {
  DEFAULT_DECISION_CONFIDENCE,
  runDecision,
  type DecisionAdapter,
  type DecisionAnswer,
} from './decision-kernel.js';

const FIRST_PASS_LIMIT = 3;
const PER_SKILL_GUIDANCE_BYTES = 8_000;
const TOTAL_GUIDANCE_BYTES = 20_000;

export interface SmartSkillRouteResult {
  skills: ResolvedSkill[];
  ids: string[];
  guidance: string;
  usedSemanticRouting: boolean;
}

function authoritativeIds(resolution: SkillResolution): Set<string> {
  const ids = new Set<string>([
    ...(resolution.receipt.canonical?.skills ?? []),
    ...(resolution.receipt.writing?.skills ?? []),
  ]);
  for (const evidence of resolution.receipt.evidence) {
    if (
      evidence.selection === 'explicit' ||
      evidence.score >= 1_000 ||
      /\b(?:explicit|canonical|writing|required)\b/i.test(evidence.reason)
    ) {
      ids.add(evidence.id);
    }
  }
  return ids;
}

function choiceAnswer(
  answer: DecisionAnswer | undefined,
):
  | { choice: string; confidence: number; probabilities: Readonly<Record<string, number>> }
  | undefined {
  return answer?.type === 'choice' ? answer : undefined;
}

function bodyFor(skill: ResolvedSkill, disclosure: SkillDisclosure): string | undefined {
  const disclosed = disclosure.bodies.find((body) => body.id === skill.id)?.content;
  if (disclosed) return disclosed.slice(0, PER_SKILL_GUIDANCE_BYTES);
  if (!skill.path) return skill.reference.slice(0, PER_SKILL_GUIDANCE_BYTES);
  try {
    return readFileSync(skill.path, 'utf8').slice(0, PER_SKILL_GUIDANCE_BYTES);
  } catch {
    return skill.reference.slice(0, PER_SKILL_GUIDANCE_BYTES);
  }
}

function semanticGuidance(skills: readonly ResolvedSkill[], disclosure: SkillDisclosure): string {
  let guidance = '';
  for (const skill of skills) {
    const body = bodyFor(skill, disclosure);
    if (!body) continue;
    const section = `\n===== SEMANTICALLY ROUTED SKILL ${skill.id} =====\n${body}\n`;
    const remaining = TOTAL_GUIDANCE_BYTES - Buffer.byteLength(guidance, 'utf8');
    if (remaining <= 0) break;
    guidance += Buffer.from(section).subarray(0, remaining).toString('utf8');
  }
  return guidance.trim();
}

function deterministicResult(
  resolution: SkillResolution,
  disclosure: SkillDisclosure,
): SmartSkillRouteResult {
  return {
    skills: resolution.skills,
    ids: resolution.skills.map((skill) => skill.id),
    guidance: semanticGuidance(resolution.skills, disclosure),
    usedSemanticRouting: false,
  };
}

function candidateSkills(
  ids: readonly string[],
  deterministic: SkillResolution,
  input: { task: string; cwd: string },
): ResolvedSkill[] {
  const byId = new Map(deterministic.skills.map((skill) => [skill.id, skill]));
  const candidates: ResolvedSkill[] = [];
  for (const id of ids.slice(0, FIRST_PASS_LIMIT)) {
    let skill = byId.get(id);
    if (!skill) {
      try {
        skill = resolveSkills({ task: input.task, cwd: input.cwd, skills: [id], limit: 1 })
          .skills[0];
      } catch {
        skill = undefined;
      }
    }
    if (skill) candidates.push(skill);
  }
  return candidates;
}

/** Add a bounded semantic preference over the current resolver. Resolver
 * receipts, canonical routes, writing routes, and explicit selections remain
 * authoritative and are never rewritten or discarded. */
export async function smartSkillRoute(
  input: { task: string; cwd: string; limit?: number },
  options: { adapter?: DecisionAdapter; confidence?: number; telemetry?: boolean } = {},
): Promise<SmartSkillRouteResult> {
  const deterministic = resolveSkills({
    task: input.task,
    cwd: input.cwd,
    ...(input.limit === undefined ? {} : { limit: input.limit }),
  });
  const disclosure = discloseSkills({
    task: input.task,
    cwd: input.cwd,
    ...(input.limit === undefined ? {} : { limit: input.limit }),
  });
  const fallback = deterministicResult(deterministic, disclosure);
  const roster = disclosure.manifest;
  if (roster.length === 0) return fallback;

  const rosterCriteria: Record<string, string> = {
    none: 'No installed skill is a useful match for this task.',
  };
  roster.forEach((skill, index) => {
    rosterCriteria[`skill_${index}`] = `${skill.id}: ${skill.load}`;
  });
  const first = await runDecision(
    {
      decision: 'skill-routing-roster',
      state: {
        task: redactText(input.task),
        manifest: roster.map((skill, index) => ({
          index,
          id: skill.id,
          state: skill.state,
          source: skill.source,
          load: skill.load,
        })),
      },
      questions: {
        best_skill: {
          type: 'choice',
          instructions: 'Select the single best installed skill for the task, or none.',
          criteria: rosterCriteria,
        },
        needs_skill: {
          type: 'noul',
          instructions: 'Would following a specialized installed skill materially help this task?',
          criteria: {
            true: 'A specialized installed skill would materially improve the work.',
            false: 'No specialized skill is needed for this task.',
          },
        },
      },
    },
    { adapter: options.adapter, telemetry: options.telemetry },
  );
  if (!first.available) return fallback;
  const threshold = options.confidence ?? DEFAULT_DECISION_CONFIDENCE;
  const best = choiceAnswer(first.answers.best_skill);
  const needsSkill = first.answers.needs_skill;
  if (!best || needsSkill?.type !== 'noul') return fallback;
  const required = authoritativeIds(deterministic);
  if (best.choice === 'none' && best.confidence >= threshold && needsSkill.noul <= 1 - threshold) {
    const skills = deterministic.skills.filter((skill) => required.has(skill.id));
    return {
      skills,
      ids: skills.map((skill) => skill.id),
      guidance: semanticGuidance(skills, disclosure),
      usedSemanticRouting: true,
    };
  }
  if (best.confidence < threshold || needsSkill.noul < threshold) return fallback;

  const rankedIds = Object.entries(best.probabilities)
    .filter(([key]) => key !== 'none')
    .sort((left, right) => right[1] - left[1])
    .map(([key]) => {
      const match = /^skill_(\d+)$/.exec(key);
      return match ? roster[Number.parseInt(match[1]!, 10)]?.id : undefined;
    })
    .filter((id): id is string => Boolean(id))
    .slice(0, FIRST_PASS_LIMIT);
  const candidates = candidateSkills(rankedIds, deterministic, input);
  if (candidates.length === 0) return fallback;
  const detailCriteria: Record<string, string> = {
    none: 'None of these candidate skills is sufficiently relevant after reading its guidance.',
  };
  candidates.forEach((skill, index) => {
    detailCriteria[`candidate_${index}`] = `${skill.id}: ${skill.reason}`;
  });
  const second = await runDecision(
    {
      decision: 'skill-routing-detail',
      state: {
        task: redactText(input.task),
        candidates: candidates.map((skill, index) => ({
          index,
          id: skill.id,
          reason: skill.reason,
          guidance: bodyFor(skill, disclosure) ?? null,
        })),
      },
      questions: {
        best_skill: {
          type: 'choice',
          instructions:
            'After reading the bounded candidate guidance, select the best skill or none.',
          criteria: detailCriteria,
        },
      },
    },
    { adapter: options.adapter, telemetry: options.telemetry },
  );
  if (!second.available) return fallback;
  const detailed = choiceAnswer(second.answers.best_skill);
  if (!detailed || detailed.confidence < threshold) return fallback;
  const selectedMatch = /^candidate_(\d+)$/.exec(detailed.choice);
  const selected = selectedMatch ? candidates[Number.parseInt(selectedMatch[1]!, 10)] : undefined;
  const selectedIds = new Set(required);
  if (selected) selectedIds.add(selected.id);
  const pool = new Map([...deterministic.skills, ...candidates].map((skill) => [skill.id, skill]));
  const skills = [...selectedIds].flatMap((id) => {
    const skill = pool.get(id);
    return skill ? [skill] : [];
  });
  return {
    skills,
    ids: skills.map((skill) => skill.id),
    guidance: semanticGuidance(skills, disclosure),
    usedSemanticRouting: true,
  };
}
