export interface CanonicalSkillRoute {
  routeIds: string[];
  skills: string[];
  reasons: Record<string, string>;
  /** Only additive routes matched: other skills keep their normal selection. */
  additive: boolean;
}

const FINANCE_ROUTE_ID = 'anthropic-finance';

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

  const ciFailure =
    matches(text, /\b(?:debug|fix|repair)\s+(?:the\s+)?ci\b/u) ||
    (matches(
      text,
      /\b(?:ci|github actions|actions run|workflow run|pipeline|status checks|checks|build)\b/u,
    ) &&
      matches(
        text,
        /\b(?:fail(?:s|ed|ing|ures?)?|red|broken|flaky|stuck|timed? ?out)\b/u,
      ) &&
      matches(
        text,
        /\b(?:ci|github actions|actions run|workflow run|pull request|pr|status checks|checks)\b/u,
      ));
  // `major` is also an adjective ("fix major layout issues"), so the verb form
  // must end the phrase or name a Major-only noun.
  const majorNoun = String.raw`(?:repo|repository|skills?|resolver|router|routing|installer|learning loop|control plane|validator|self[- ]maintenance)`;
  const majorSelfChange =
    matches(
      text,
      new RegExp(
        String.raw`\b(?:audit|review|fix|change|update|improve|repair|refactor|maintain|harden|debug|clean up)\s+(?:of\s+)?(?:the\s+)?major(?:'s)?(?=\s*$|\s*[.,;:!?]|\s+(?:and|itself|so|to|for)\b|\s+${majorNoun}\b)`,
        'u',
      ),
    ) || matches(text, new RegExp(String.raw`\bmajor's\s+(?:own\s+)?${majorNoun}\b`, 'u'));
  const forecasting =
    matches(
      text,
      /\b(?:financial model|fp&a|fpa|financial projections?|revenue projections?|three[- ]statement)\b/u,
    ) ||
    (matches(text, /\b(?:forecast(?:s|ing)?|budget(?:s|ing)?|cash ?flow|runway)\b/u) &&
      matches(
        text,
        /\b(?:revenue|p&l|profit|cash|burn|hiring|headcount|financial|finance|quarter(?:ly)?|fiscal|months|expenses?|margins?|spreadsheet|next year|annual)\b/u,
      ));
  const reverseEngineering = matches(
    text,
    /\b(?:reverse[- ]engineer(?:s|ed|ing)?|replicate (?:the|its|their) behaviou?r|make ours work like|interoperate with)\b/u,
  );
  const visualReference =
    matches(text, /\b(?:pixel[- ]perfect|make it look like|clone (?:this|the|their) (?:ui|site|website|page|design|app))\b/u) ||
    (matches(text, /\b(?:screenshots?|mockups?|mock-ups?|screen recording)\b/u) &&
      matches(
        text,
        /\b(?:recreate|replicate|clone|rebuild|match|copy|port)\b|\bbuild (?:this|the|it|that)\b(?:\s+\w+){0,3}\s+from\b/u,
      ));
  const wholeProductRebuild = matches(
    text,
    /\b(?:rebuild|recreate|clone|reconstruct|replicate)\s+(?:their|the competitor'?s?|an existing|[a-z]+'s)\s+(?:whole|entire|full|complete)\s+(?:product|app|application|platform|system)\b|\bfeature parity\b/u,
  );
  const websiteRelease =
    web &&
    matches(
      text,
      /\b(?:go live|going live|launch (?:the )?(?:site|website|landing page)|before launch|pre-launch|ready to launch|handover|hand over|hand it over|closeout|close out|final qa|release[- ]ready|ready to ship|looks done|mark (?:it |this )?(?:as )?complete|send (?:it )?to (?:the )?client)\b/u,
    );

  if (ciFailure) add('ci-recovery', ['ci-recovery']);
  if (majorSelfChange) add('major-self-maintenance', ['major-self-maintenance']);
  if (forecasting) add('forecasting', ['fpa-forecasting-extrapolation']);
  if (reverseEngineering) add('reverse-engineering', ['engineering-by-reference']);
  if (wholeProductRebuild) add('whole-product-reconstruction', ['reference-engineering']);
  if (websiteRelease) add('website-release', ['website-design-qa']);
  if (visualReference) add('visual-reference', ['reference-replica']);

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
    ]);
  } else if (web && browserQa) {
    add('web-browser-qa', ['website-design-qa', 'remote-first-web-development']);
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
      ...(web || browserQa ? ['website-design-qa'] : []),
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
  if (personalBrand)
    add('personal-brand', [
      'personal-brand-strategy',
      ...(matches(text, /\blinkedin\b/u) ? ['linkedin-gtm-and-content'] : []),
    ]);
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
      ...(browserQa ? ['website-design-qa'] : []),
    ]);
  }

  if (codeReview) {
    add('code-review', [
      'exact-head-pr-review',
      ...(performanceConcern ? ['performance-caching'] : []),
    ]);
  }

  if (legacyCleanup) add('legacy-cleanup', ['legacy-cleanup']);
  if (workspaceCleanup) add('workspace-cleanup', ['workspace-lifecycle-management']);

  // Anthropic financial-services specialists (pinned, ~/.agents/skills). Their terms are also
  // ordinary engineering words, so software work vetoes them, and the route only ever adds skills.
  const financeText = text.replace(/\s+/gu, ' ');
  const financeSpecialists: Array<[RegExp, string]> = [
    [/\bclient (?:performance|portfolio|quarterly|investment) reports?\b/u, 'client-report'],
    [/\bclient review (?:meeting|prep|pack)\b/u, 'client-review'],
    [/\binvestment proposals?\b/u, 'investment-proposal'],
    [/\b(?:dcf|discounted cash flows?)\b/u, 'dcf-model'],
    [/\b(?:lbo|leveraged buyouts?)\b/u, 'lbo-model'],
    [/\b(?:3|three)[- ]statements? (?:financial )?models?\b/u, '3-statement-model'],
    [/\b(?:comparable compan(?:y|ies)|comparables|trading comps|comps (?:table|analysis|on|for)|run comps|peer multiples)\b/u, 'comps-analysis'],
    [/\b(?:merger (?:model|analysis)|accretion|accretive|dilution analysis|pro forma eps)\b/u, 'merger-model'],
    [/\b(?:irr|moic)\b/u, 'returns-analysis'],
    [/\b(?:audit|check)\b.{0,60}\b(?:spreadsheet|workbook|excel model|financial model)\b|\bcheck my formulas\b|\bmodel (?:won.t|doesn.t|does not) balance\b/u, 'audit-xls'],
    [/\b(?:clean|tidy)\b.{0,50}\b(?:spreadsheet|excel|workbook|xlsx)\b/u, 'clean-data-xls'],
    [/\bcompetitive landscape (?:deck|slides?|analysis)\b/u, 'competitive-analysis'],
    [/\b(?:refresh|update|roll)\b.{0,50}\b(?:deck|presentation(?! layer))\b.{0,50}\b(?:numbers|quarter\w*|earnings|comps)\b/u, 'deck-refresh'],
    [/\b(?:qc|check|review)\b.{0,50}\b(?:investment banking|banker|client-ready)\b.{0,20}\b(?:deck|presentation)\b/u, 'ib-check-deck'],
    [/\b(?:investment banking|banker|sell-side|m&a)\b.{0,40}\bpitch (?:deck|book)\b|\bpitch ?books?\b/u, 'pitch-deck'],
    [/\b(?:ppt|pptx|powerpoint)\b.{0,30}\btemplate\b.{0,30}\bskill\b/u, 'ppt-template-creator'],
    [/\bheadless\b.{0,40}\b(?:xlsx|excel)\b/u, 'xlsx-author'],
    [/\bheadless\b.{0,40}\b(?:pptx|powerpoint)\b/u, 'pptx-author'],
    [/\bearnings (?:update|analysis|report|note|review|call)\b|\bq[1-4] earnings\b/u, 'earnings-analysis'],
    [/\b(?:pre-earnings|earnings preview)\b/u, 'earnings-preview'],
    [/\b(?:initiat(?:e|ing|ion)(?: of)? coverage|initiation report)\b/u, 'initiating-coverage'],
    [/\bmorning (?:meeting )?note\b/u, 'morning-note'],
    [/\b(?:investment thesis|thesis tracker)\b/u, 'thesis-tracker'],
    [/\bcatalyst calendar\b/u, 'catalyst-calendar'],
    [/\b(?:stock (?:screen|idea)s?|investment ideas?)\b/u, 'idea-generation'],
    [/\b(?:sector|industry) (?:overview|primer|landscape report)\b/u, 'sector-overview'],
    [/\b(?:update|roll)\b.{0,40}\bmodel\b.{0,40}\b(?:earnings|estimates|new guidance)\b/u, 'model-update'],
    [/\b(?:draft|build|write|prepare|structure)\b.{0,40}\b(?:cim|confidential information memorandum|offering memorandum)\b/u, 'cim-builder'],
    [/\b(?:anonymous|sell-side|m&a|deal) (?:company )?teaser\b/u, 'teaser'],
    [/\bbuyer (?:list|universe)\b|\b(?:potential|strategic) acquirers\b/u, 'buyer-list'],
    [/\bprocess letter\b|\bbid instructions\b/u, 'process-letter'],
    [/\bdata ?pack\b/u, 'datapack-builder'],
    [/\bstrip profiles? (?:of|for)\b|\bcreate (?:a )?strip profiles?\b/u, 'strip-profile'],
    [/\bdeal tracker\b|\blive deals\b/u, 'deal-tracker'],
    [/\bscreen(?:ing)? (?:this |the |these |our |new |inbound )*(?:deals?|deal flow|cim|teaser)\b|\b(?:review|triage) (?:this |the )?cim\b|\b(?:review|triage) (?:this |the )?(?:deal|sell-side|m&a) teaser\b/u, 'deal-screening'],
    [/\bdeal sourcing\b|\bsource (?:deals|targets)\b/u, 'deal-sourcing'],
    [/\b(?:due diligence|diligence|dd) (?:checklist|tracker|request list)\b/u, 'dd-checklist'],
    [/\bdd (?:meeting|call|prep)\b|\b(?:due diligence|diligence|management presentation|expert network)\b.{0,40}\b(?:meeting|call|prep)\b/u, 'dd-meeting-prep'],
    [/\b(?:ic memo|investment committee|investment memo)\b/u, 'ic-memo'],
    [/\bportfolio monitoring\b|\bportcos?\b.{0,60}\b(?:kpis?|covenants?|against plan)\b|\bportfolio compan(?:y|ies)\b.{0,60}\b(?:kpis?|covenants?|against plan)\b|\bkpis?\b.{0,30}\bportcos?\b/u, 'portfolio-monitoring'],
    [/\bunit economics\b|\bltv\s*[/]?\s*cac\b|\b(?:analy[sz]e|calculate|compute)\b.{0,30}\bnet retention\b/u, 'unit-economics'],
    [/\bvalue creation plan\b|\b100[- ]day plan\b.{0,40}\b(?:acquisition|post-close|portfolio|portco|deal)\b/u, 'value-creation-plan'],
    [/\bportfolio\b.{0,40}\bai (?:readiness|opportunit\w+)\b|\bai readiness\b.{0,40}\bportfolio\b/u, 'ai-readiness'],
    [/\b(?:gl|general ledger)\b.{0,40}\b(?:reconcil\w*|recon|subledger)\b|\breconcil\w+\b.{0,40}\b(?:gl|general ledger)\b/u, 'gl-recon'],
    [/\b(?:recon|reconciliation) breaks?\b|\bbreak[- ]trac\w+\b/u, 'break-trace'],
    [/\baccruals? (?:schedule|entries)\b/u, 'accrual-schedule'],
    [/\bnav (?:pack|tie[- ]?out)\b|\btie[- ]?out\b.{0,40}\bnav\b|\blp statements?\b/u, 'nav-tieout'],
    [/\broll[- ]?forward\b.{0,40}\b(?:schedule|account|balance)\b/u, 'roll-forward'],
    [/\b(?:variance|flux) (?:commentary|explanations?)\b|\b(?:variance|flux) analysis\b.{0,30}\b(?:p&l|budget|actuals?|forecast|close|month|quarter|january|february|march|april|may|june|july|august|september|october|november|december)\b/u, 'variance-commentary'],
    [/\bkyc\b.{0,50}\b(?:parse|extract|packet|documents?)\b|\bparse\b.{0,50}\bkyc\b/u, 'kyc-doc-parse'],
    [/\bkyc\b.{0,50}\b(?:rules?|risk rating)\b|\baml rules?\b/u, 'kyc-rules'],
  ];
  const softwareWork = /\b(?:apis?|sdk|react|components?|endpoints?|migrations?|css|frontend|backend|websocket|postgres|sql|landing page|ui|module|checkout|repo|repository|pull request|scheduler|loading state|schema|auth|signup|sign-up|upload|security (?:issues?|audit)|report screen)\b/u;
  const softwareWord = /\b(?:apps?|code|deploy\w*|bugs?|database|dashboard|security|feature|inventory)\b|(?<!-)\bpages?\b/u;
  // These terms stay financial even beside a word like "app" or "page".
  const unambiguousFinance = new Set(["dcf-model", "lbo-model", "3-statement-model", "audit-xls", "ic-memo", "unit-economics", "gl-recon", "accrual-schedule", "nav-tieout", "variance-commentary", "roll-forward", "portfolio-monitoring", "dd-checklist", "kyc-doc-parse", "kyc-rules", "comps-analysis", "cim-builder", "initiating-coverage", "merger-model", "returns-analysis", "thesis-tracker", "sector-overview", "earnings-analysis", "morning-note", "strip-profile", "investment-proposal"]);
  const pickedFinance = matches(financeText, softwareWork)
    ? []
    : financeSpecialists
        .filter(([pattern, id]) => matches(financeText, pattern) && (unambiguousFinance.has(id) || !matches(financeText, softwareWord)))
        .map(([, id]) => id);
  if (pickedFinance.length > 0) {
    // Accounting work keeps Major's own control skill.
    const accounting = ['gl-recon', 'break-trace', 'accrual-schedule', 'nav-tieout', 'roll-forward', 'variance-commentary'];
    add(FINANCE_ROUTE_ID, [
      'finance-skills-routing',
      ...pickedFinance,
      ...(pickedFinance.some((id) => accounting.includes(id)) ? ['reconciliation-close-statements'] : []),
    ]);
  }

  // Emil Kowalski (AIforUI) craft specialists. They sit beneath
  // design-direction-and-taste, which stays the single taste authority, so they
  // are appended after every other route and only on narrow craft triggers.
  const uiSurface =
    web ||
    matches(
      text,
      /\b(?:ui|ux|interface|css|html|react|component|iphone|ios|android|safari|pwa|modal|drawer|popover|tooltip|toast|dropdown|button|signup|sign[- ]up|login|webpage|web page)\b/u,
    );
  if (uiSurface) {
    const emil: Array<[RegExp, string, boolean?]> = [
      [/\b(?:100vh|dvh|svh|safe[- ]area|notch|dynamic island|pull[- ]to[- ]refresh|sticky hover|tap highlight|feels? (?:native|like a website)|native feel|pwa|iphone|ios|android|safari)\b/u, 'emil-mobile-native'],
      [/\b(?:easing|ease[- ]?(?:in|out)|cubic[- ]bezier|springs?|animation duration|enter animation|exit animation|micro-?interactions?|animations? (?:feel|is|are|looks?))\b|\b(?:review|fix|tune) (?:the )?(?:\w+ )?animations?\b/u, 'emil-animations', motion],
      [/\b(?:forms?|inputs?|textarea|checkbox|autofocus|double[- ]submit|form validation)\b/u, 'emil-forms-and-inputs'],
      [/\b(?:landing page|marketing (?:site|page)|homepage|hero section|pricing page|changelog|rss feed|waitlist)\b/u, 'emil-marketing-pages'],
      [/\b(?:pre-?launch|prep(?:are)? for prod(?:uction)?|production[- ]ready|ready to ship|ship check|launch checklist|before (?:launch|release|the demo)|go(?:ing)? live|final sweep)\b/u, 'emil-prep-for-prod'],
      [/\b(?:ui|design|component|interface) (?:diff|review|pull request|pr)\b|\breview (?:this |the )?(?:ui|interface|generated component)\b/u, 'emil-ui-review'],
      [/\b(?:ai[- ]generated|vibe[- ]coded|ai slop|de-?slop|unslop|cookie[- ]cutter|purple gradient|glassmorphism)\b/u, 'emil-unslop-design'],
      [/\b(?:typography|typeface|font pairing|kerning|letter-spacing|line-height|tabular nums?)\b/u, 'emil-typography'],
      [/\b(?:oklch|color palette|colour palette|tonal scale|apca|contrast ratio)\b/u, 'emil-color'],
      [/\b(?:border[- ]radius|box-shadow|shadows?|elevation|concentric radius)\b/u, 'emil-surfaces'],
      [/\b(?:compound components?|props api|component api|aschild|controlled (?:or|vs\.?) uncontrolled)\b/u, 'emil-component-design'],
      [/\b(?:virtuali[sz](?:e|ation)|layout shift|cls|re-?renders?|jank(?:y)?|transition: ?all)\b/u, 'emil-performance'],
      [/\b(?:tap targets?|hit areas?|screen readers?|aria|focus trap|keyboard navigation|reduced motion|a11y)\b/u, 'emil-touch-and-accessibility'],
      [/\b(?:polish pass|feels? (?:off|unfinished)|font[- ]smoothing)\b/u, 'emil-ui-polish'],
      [/\b(?:design\.md|design system docs?|design system documentation)\b/u, 'emil-design-system-docs'],
      [/\b(?:live picker|several versions|a few versions|prototype)\b/u, 'emil-prototype'],
    ];
    const picked = emil.filter(([pattern, , skip]) => !skip && matches(text, pattern)).map(([, id]) => id);
    if (picked.length > 0) add('emil-craft', picked);
  }
  if (matches(text, /\blapse\b/u)) add('emil-lapse', ['emil-ask-lapse']);
  if (matches(text, /\bwhich (?:emil )?skills?\b/u)) add('emil-router', ['emil-ask-emil']);

  if (routes.length === 0) return undefined;

  const routeIds = unique(routes.map((route) => route.id));
  const skills = unique(routes.flatMap((route) => route.skills));
  const reasons: Record<string, string> = {};
  for (const route of routes) {
    for (const skill of route.skills) {
      reasons[skill] ??= 'required by canonical ' + route.id + ' route';
    }
  }

  return { routeIds, skills, reasons, additive: routeIds.every((id) => id === FINANCE_ROUTE_ID) };
}
