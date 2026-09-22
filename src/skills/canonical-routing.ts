export interface CanonicalSkillRoute {
  routeIds: string[];
  skills: string[];
  reasons: Record<string, string>;
}

interface RouteFragment {
  id: string;
  skills: string[];
}

function matches(text: string, pattern: RegExp): boolean {
  return pattern.test(text);
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

export function resolveCanonicalSkillRoute(task: string): CanonicalSkillRoute | undefined {
  const text = task.toLowerCase();
  const routes: RouteFragment[] = [];
  const add = (id: string, skills: string[]) => routes.push({ id, skills });

  const presentation = matches(
    text,
    /\b(?:presentation|slide(?:s| deck)?|deck|pitch deck|board deck|strategy deck|investor deck|sales deck|ghost deck)\b/u,
  );
  const reviewAction = matches(
    text,
    /\b(?:review|audit|critique|check|qa|quality|polish|fix|improve|assess|evaluate)\b/u,
  );
  const web = matches(
    text,
    /\b(?:website|web app|webapp|landing page|frontend|front-end|ui|user interface|next\.?js|react app|dashboard)\b/u,
  );
  const visualDesignNegated = matches(
    text,
    /\b(?:do not|don't|not|without)\b.{0,48}\b(?:visual|design|redesign|layout|ui|ux|user experience)\b/u,
  );
  const visualDesign =
    matches(
      text,
      /\b(?:design|redesign|visual|layout|hierarchy|spacing|premium|minimalist|generic|boxy|responsive|art direction|polish|overlap(?:ping)?)\b/u,
    ) && !visualDesignNegated;
  const browserQa = matches(
    text,
    /\b(?:browser|qa|acceptance|staging|preview|production|breakpoint|viewport|responsive test|e2e|end[- ]to[- ]end)\b/u,
  );
  const motion = matches(
    text,
    /\b(?:gsap|scrolltrigger|scroll trigger|sticky|pinned|pinning|scrollytelling|card stack(?:ing)?|parallax|three\.?js|scroll[- ]driven|hero video)\b/u,
  );
  const newProject = matches(
    text,
    /\b(?:new (?:\w+\s+){0,3}(?:product|project|app|web app|website|platform|saas)|start (?:a|an|the)? ?new (?:\w+\s+){0,3}(?:product|project|app|website)|set up (?:a|an|the)? ?new (?:\w+\s+){0,3}(?:product|project|app|website)|from scratch)\b/u,
  );
  const openSourceFirst =
    matches(text, /\b(?:open source|open-source|prior art|existing implementation|adopt or wrap|reuse before build)\b/u) &&
    matches(text, /\b(?:find|search|check|review|before|adopt|wrap|reuse|evaluate|build)\b/u);
  const technicalContext = matches(
    text,
    /\b(?:app|web app|website|frontend|backend|api|code|login|auth|database|query|sql|server|build|deploy|runtime|browser|console|test|ci|function|component)\b/u,
  );
  const bug =
    matches(
      text,
      /\b(?:bugs?|broken|breaks|regression|not working|doesn'?t work|does not work|root cause|debug|debugging|diagnose)\b/u,
    ) ||
    (matches(text, /\b(?:stuck|failures?|failing|failed|errors?|issues?)\b/u) &&
      (technicalContext ||
        matches(text, /\b(?:fix|investigate|troubleshoot|reproduce|diagnose|debug|why|root cause)\b/u)));
  const seo = matches(
    text,
    /\b(?:seo|search engine optimization|organic search|technical seo|on-page seo|keyword|serp|search console|gsc|internal linking|backlink|geo\b|aeo\b|ai search)\b/u,
  );
  const source = matches(
    text,
    /\b(?:url|article|video|youtube|podcast|transcript|document|file|paper|book|source|pdf|docx|spreadsheet|attachment|uploaded)\b/u,
  );
  const sourceAnalysis =
    source &&
    matches(
      text,
      /\b(?:analy[sz]e|deep dive|extract|read|study|summari[sz]e|compare|mechanism|implication|counterexample|contradiction|apply)\b/u,
    );
  const knowledgeIngest = matches(
    text,
    /\b(?:ingest|index|store|import|add|dispatch)\b.{0,80}\b(?:knowledge|brain|memory|research system|knowledge system|gbrain|durable knowledge)\b/u,
  );
  const research = matches(
    text,
    /\b(?:research|market analysis|market research|competitor analysis|competitive analysis|synthesi[sz]e the evidence|decision memo)\b/u,
  );
  const competitor = matches(text, /\b(?:competitors?|competitive|best[- ]in[- ]class|market alternatives)\b/u);
  const productDecision = matches(
    text,
    /\b(?:product opportunity|product strategy|product decision|roadmap|prioriti[sz]ation|discovery|requirements?|scope decision|mvp)\b/u,
  );
  const technicalWriting = matches(
    text,
    /\b(?:sop|procedure|operating instructions?|controlled technical|warning|work instruction|runbook)\b/u,
  );
  const personalBrand = matches(
    text,
    /\b(?:linkedin|thought leadership|personal brand|personal essay|newsletter)\b/u,
  );
  const writingEvaluation =
    matches(text, /\b(?:essay|writing|prose|draft|article|post)\b/u) &&
    matches(text, /\b(?:evaluate|critique|review|assess)\b/u) &&
    matches(text, /\b(?:thesis|evidence|specificity|reasoning|voice|source fidelity|argument|clarity)\b/u);
  const security = matches(
    text,
    /\b(?:security|vulnerabilit(?:y|ies)|attack path|threat model|secret handling|data access control)\b/u,
  );
  const strongAuth = matches(
    text,
    /\b(?:auth|authentication|authorization|authorisation|login|log in|sign[- ]?in|sign[- ]?up|password|access control|rbac)\b/u,
  );
  const accountAccessContext = matches(
    text,
    /\b(?:user|users|account|accounts|admin|app|web app|saas|candidate|recruiter|workspace|tenant|member|members)\b/u,
  );
  const auth =
    strongAuth ||
    (accountAccessContext && matches(text, /\b(?:permissions?|roles?|sessions?)\b/u));
  const valuation = matches(
    text,
    /\b(?:valuation|merger|acquisition|m&a|comparable compan(?:y|ies)|comps\b|precedent transaction|dcf\b|leveraged buyout|lbo\b|investment analysis)\b/u,
  );
  const pdfOutputNegated = matches(
    text,
    /\b(?:do not|don't|not|without)\b.{0,48}\b(?:create|generate|export|render|make|convert|produce|deliver|write|prepare|format)\b.{0,24}\bpdf\b/u,
  );
  const pdfOutput =
    matches(text, /\bpdf\b/u) &&
    matches(
      text,
      /\b(?:create|generate|export|render|make|convert|produce|deliver|write|prepare|format)\b/u,
    ) &&
    !pdfOutputNegated;
  const operationsContext = matches(
    text,
    /\b(?:operations?|operating|process|workflow|capacity|team|business|service delivery)\b/u,
  );
  const operations =
    matches(text, /\b(?:operations workflow|operating workflow|process improvement|workflow improvement)\b/u) ||
    (operationsContext &&
      matches(
        text,
        /\b(?:bottleneck|capacity planning|control gaps?|automation opportunities?|efficiency|throughput)\b/u,
      ));
  const vercel = matches(text, /\bvercel\b/u);
  const deploy = matches(text, /\b(?:deploy|deployment|preview|production release|ship)\b/u);
  const pr = matches(text, /\b(?:pull request|\bpr\b|head sha|exact head|diff review)\b/u);
  const codeReview =
    matches(
      text,
      /\b(?:code review|review this (?:pull request|pr|diff|implementation)|review (?:this )?(?:frontend|backend|typescript|javascript|python|react|next\.?js)? ?code)\b/u,
    ) || pr;
  const performanceConcern = matches(
    text,
    /\b(?:performance|latency|throughput|optimi[sz]e|optimization|slow|slowness)\b/u,
  );
  const humanBlocker = matches(
    text,
    /\b(?:oauth|2fa|mfa|captcha|consent|human approval|manual approval|payment authorization|payment authorisation)\b/u,
  );
  const legacyCleanup = matches(
    text,
    /\b(?:legacy|obsolete|deprecated|stale configuration|stale config|duplicate config|provider swap|migration cleanup|redundant code)\b/u,
  );
  const workspaceCleanup = matches(
    text,
    /\b(?:duplicate (?:local )?(?:repo|repository|project|workspace)|redundant local project|disk pressure|archive project|delete project copy|project copies)\b/u,
  );

  if (presentation) {
    add('presentation', [
      'presentation-storylining',
      ...(visualDesign || reviewAction ? ['design-direction-and-taste'] : []),
      ...(reviewAction ? ['cross-modal-review'] : []),
    ]);
  }

  if (newProject) {
    add('new-project', [
      'project-start',
      'mvp-speed-prioritisation',
      'product-management-core',
      'prior-art-discovery',
      ...(web ? ['remote-first-web-development'] : []),
    ]);
  }

  if (web && visualDesign) {
    add('web-design', ['design-direction-and-taste', 'remote-first-web-development']);
  }

  const webBuildAction =
    matches(text, /\b(?:build|implement|create|develop)\b/u) ||
    (matches(text, /\bredesign\b/u) && !visualDesignNegated);
  if (web && webBuildAction) {
    add('web-build', ['remote-first-web-development']);
  }

  const visualUiReview =
    web &&
    reviewAction &&
    (visualDesign ||
      browserQa ||
      matches(text, /\b(?:ux|user experience|responsive|mobile|desktop|tablet|confusing|inconsistent)\b/u));
  if (visualUiReview) {
    add('web-ui-review', [
      'website-design-qa',
      'remote-first-web-development',
      ...(browserQa ? ['browser-release-qa'] : []),
    ]);
  } else if (web && browserQa) {
    add('web-browser-qa', ['browser-release-qa', 'remote-first-web-development']);
  }

  if (motion) {
    add('responsive-motion', [
      'responsive-motion-systems',
      'website-design-qa',
      'remote-first-web-development',
    ]);
  }

  if (openSourceFirst) {
    add('prior-art', [
      'open-source-leverage',
      'prior-art-discovery',
      ...(matches(text, /\b(?:reusable|module|component|template|package|asset)\b/u)
        ? ['reusable-asset-discovery']
        : []),
    ]);
  }

  if (bug) {
    add('debug', [
      'root-cause-qa',
      'debugging',
      ...(web || browserQa ? ['browser-release-qa'] : []),
    ]);
  }

  if (seo) add('seo', ['seo-os']);

  if (sourceAnalysis) {
    add('source-analysis', ['source-ingestion', 'strategic-reading']);
  }

  if (knowledgeIngest) add('knowledge-ingest', ['knowledge-ingest']);

  if (research) {
    add('knowledge-work', [
      'knowledge-work',
      ...(competitor ? ['competitive-product-audit'] : []),
      ...(productDecision ? ['product-management-core'] : []),
    ]);
  }

  if (technicalWriting) add('technical-writing', ['technical-writing', 'asd-ste100']);
  if (personalBrand) add('personal-brand', ['personal-brand-strategy']);
  if (writingEvaluation) add('writing-evaluation', ['writing-evaluator']);

  if (security || auth) {
    add('security', [
      ...(security ? ['security-audit'] : []),
      ...(auth ? ['auth-security'] : []),
      ...(auth && matches(text, /\b(?:build|implement|create|add|set up|setup)\b/u)
        ? ['prior-art-discovery']
        : []),
    ]);
  }

  if (valuation) add('valuation', ['valuation-investment-ma']);
  if (pdfOutput) add('pdf', ['pdf-reporting-qa']);
  if (operations) add('operations', ['operations-improvement-core']);
  if (humanBlocker) add('human-blocker', ['human-blocker-orchestration']);

  if (vercel && deploy) {
    add('vercel-deploy', [
      'deploy-to-vercel',
      'vercel-cli-with-tokens',
      'remote-first-web-development',
      ...(browserQa ? ['browser-release-qa'] : []),
    ]);
  }

  if (codeReview) {
    add('code-review', [
      'review',
      ...(performanceConcern ? ['performance'] : []),
      ...(pr ? ['exact-head-pr-review'] : []),
    ]);
  }

  if (legacyCleanup) add('legacy-cleanup', ['legacy-cleanup']);
  if (workspaceCleanup) add('workspace-cleanup', ['workspace-lifecycle-management']);

  if (routes.length === 0) return undefined;

  const routeIds = unique(routes.map((route) => route.id));
  const skills = unique(routes.flatMap((route) => route.skills));
  const reasons: Record<string, string> = {};
  for (const route of routes) {
    for (const skill of route.skills) {
      reasons[skill] ??= 'required by canonical ' + route.id + ' route';
    }
  }

  return { routeIds, skills, reasons };
}
