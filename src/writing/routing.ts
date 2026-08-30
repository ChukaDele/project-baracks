import {
  CANONICAL_WRITING_PIPELINE,
  TRANSACTIONAL_WRITING_PIPELINE,
  type WritingGate,
  type WritingRoute,
} from './types.js';

const directWritingAction =
  /\b(?:write|rewrite|draft|prepare|polish|edit|compose|revise|proofread|summari[sz]e)\b/i;
const directWritingObject =
  /\b(?:this|notes?|essay|summary|report|memo|homepage|website|landing page|copy|proposal|post|newsletter|article|sop|procedure|warning|instructions?|documentation|docs?|readme|email|message|slack|reply|letter|statement|brief|prose|words|content|headline)\b/i;
const transformWritingAction =
  /\b(?:turn\s+(?:these\s+)?notes?\s+into\s+[^.!?]{0,40}\b(?:report|memo|proposal|post|article)|make\s+this\s+(?:sop|procedure|email|message|copy|prose)\s+(?:clearer|better)|do\s+my\s+(?:mba\s+)?(?:critical\s+)?summary|help\s+(?:me\s+)?with\s+(?:this\s+|an?\s+)?(?:essay|report|proposal))\b/i;

export function resolveWritingRoute(task: string): WritingRoute | undefined {
  const text = task.trim();
  const codeOnly =
    /\b(?:code|function|class|typescript|javascript|python|rust|sql|regex|api|bug|test|component|compiler)\b/i.test(
      text,
    ) &&
    !/\b(?:prose|copy|documentation|docs?|readme|commentary|explanation|email|message|report|essay|website|homepage|landing|proposal|sop)\b/i.test(
      text,
    );
  if (codeOnly) return undefined;
  if (
    !(directWritingAction.test(text) && directWritingObject.test(text)) &&
    !transformWritingAction.test(text)
  )
    return undefined;
  if (
    /\b(?:awwwards|visual design|ui design|layout|animation|frontend|implement|build)\b/i.test(
      text,
    ) &&
    !/\b(?:copy|prose|words|content|headline|writing|write|rewrite|draft)\b/i.test(text)
  )
    return undefined;

  const commercialAction =
    /\b(?:buy|book|register|subscribe|request a demo|apply|conversion|sales page|direct response)\b/i.test(
      text,
    );
  const transactional =
    !commercialAction &&
    (/\b(?:email|slack|chat|message|reply|respond|response|administrative)\b/i.test(text) ||
      /^(?:yes|no|thanks|thank you|sounds good|acknowledged)[.!]?$/i.test(text));
  const academic =
    /\b(?:academic|essay|critical summary|literature review|assignment|mba|dissertation|thesis)\b/i.test(
      text,
    );
  const technical =
    /\b(?:sop|procedure|warning|operating instructions?|controlled technical|asd[- ]?ste100|documentation|docs?|readme)\b/i.test(
      text,
    );
  const personal =
    /\b(?:linkedin|thought leadership|personal essay|newsletter|personal brand)\b/i.test(text);
  const brand =
    !personal &&
    /\b(?:homepage|website|landing page|positioning|brand|product messaging)\b/i.test(text);
  const proposal = /\bproposal\b/i.test(text);
  const report = /\b(?:report|strategy memo|memo)\b/i.test(text);
  const highStakes =
    academic ||
    proposal ||
    personal ||
    /\b(?:public|client-facing|important|sensitive|major website)\b/i.test(text) ||
    (brand && /\b(?:homepage|website|landing page)\b/i.test(text));
  const genre = academic
    ? 'academic'
    : technical
      ? 'technical'
      : personal
        ? 'personal-brand'
        : commercialAction
          ? 'direct-response'
          : brand
            ? 'brand'
            : proposal
              ? 'proposal'
              : report
                ? 'report'
                : transactional
                  ? 'transactional'
                  : 'general';
  const specialist = academic
    ? 'academic-writing'
    : technical
      ? 'technical-writing'
      : personal
        ? 'personal-brand-strategy'
        : commercialAction
          ? 'direct-response-writing'
          : brand
            ? 'brand-strategy'
            : undefined;

  const skills =
    transactional && !highStakes
      ? ['writing-os', 'prose-craft', 'natural-writing-qa']
      : [
          'writing-os',
          ...(specialist ? [specialist] : []),
          ...(technical ? ['asd-ste100'] : []),
          ...(academic ? ['academic-verify'] : []),
          'prose-craft',
          ...(!technical ? ['voice-fingerprint'] : []),
          'prose-lint',
          'natural-writing-qa',
          'writing-evaluator',
          ...(highStakes ? ['writing-red-team'] : []),
        ];
  const reasons: Record<string, string> = {};
  for (const skill of skills)
    reasons[skill] =
      skill === 'writing-os'
        ? 'mandatory canonical orchestrator for substantive writing'
        : `required by the ${genre}${highStakes ? ' high-stakes' : ''} writing route`;
  const gates: WritingGate[] =
    transactional && !highStakes
      ? ['route', 'draft', 'natural-writing-qa', 'final-verification']
      : [
          'route',
          'draft',
          'prose-lint',
          'natural-writing-qa',
          'substantive-evaluation',
          ...(highStakes ? ['independent-red-team' as const] : []),
          'revision',
          ...(academic || technical ? ['source-claim-check' as const] : []),
          'final-verification',
        ];
  return {
    substantive: !transactional || highStakes,
    transactional,
    genre,
    risk: highStakes ? 'high-stakes' : 'routine',
    skills,
    reasons,
    pipelineStages:
      transactional && !highStakes ? TRANSACTIONAL_WRITING_PIPELINE : CANONICAL_WRITING_PIPELINE,
    gates,
    lintProfile: technical
      ? 'asd-ste100'
      : academic
        ? 'academic'
        : brand || commercialAction
          ? 'marketing'
          : transactional
            ? 'transactional'
            : 'general',
    ...(technical
      ? {}
      : academic
        ? { voiceProfile: 'academic' }
        : personal
          ? { voiceProfile: 'personal' }
          : brand
            ? { voiceProfile: 'brand' }
            : {}),
  };
}
