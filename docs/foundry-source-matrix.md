# Foundry source matrix

Purpose: preserve why each reusable pack exists and where its strongest evidence comes from. “Source” means prior art and constraints, not automatic code copying.

| Area | Internal evidence | External primary/strong source | Current treatment |
|---|---|---|---|
| Webapp | Surface Talent | W3C WCAG, framework/provider official docs | Project-proven source |
| Auth/RBAC | JSS WorkOS adapter + canonical app identity; Surface Talent capability enforcement | WorkOS, Better Auth, OWASP/NIST auth guidance | Extract provider-neutral identity pack |
| Privacy lifecycle | Surface Talent export/erasure/SAR/retention/anonymisation | UK ICO, EU Commission, Nigeria NDPC | Extract operational privacy pack; jurisdiction overlays remain current-source reviewed |
| Agent/autonomy | Project Baracks/Major | provider official docs + eval practices | Project-proven source |
| Data provenance | JSS immutable events, source provenance and cohort model | data-system official references as needed | Project-proven source |
| Billing/entitlements | Internal sources still weak | Stripe Billing, Entitlements, Customer Portal | Borrow concepts; prove in first billing project |
| Transactional email | Internal sources still shallow | React Email + Resend | Borrow rendering/versioning patterns; provider remains replaceable |
| Analytics/experimentation | JSS event model | PostHog product analytics, flags, experiments, replay privacy | Separate event truth from vendor implementation |
| Uptime/status/incident | Surface operational runbooks | OpenStatus infra-as-code status/monitoring | Candidate pack |
| SEO/public web | Surface Talent website + personal/web projects | Google Search Central | Candidate → prove on next public site |
| Commerce | Internal source weak | Shopify Hydrogen/headless commerce | Candidate overlay, not core archetype |
| Mobile native | Internal source weak | Expo official agent skills + EAS | Candidate → first real native project proof |
| Accessibility | Surface Talent manual + axe work | W3C WCAG 2.2/WAI | Global UI baseline |
| Experience sites | Surface/web projects + Emil/Rayna patterns | Awwwards/FWA references per project | Project style/experience pack, never universal taste |
| Design system | Rayna + Surface Talent | W3C/design-system primary docs as needed | Candidate extraction |
| Finance/data product | Bredge Finance OS | accounting/provider sources per project | Needs deeper internal extraction before promotion |
| Fintech/regulatory | Idara expected primary internal source | regulator/partner official sources | Blocked until Idara repo/source is accessible |
| Decks | Renaissance, sponsorship, strategy work | Sequoia for investor narrative; purpose-specific primary references | Deliverable family with type-specific storylines |
| Documents | Proposal/report/coursework workflows | domain/format official references | Deliverable family |
| Spreadsheets/models | Bredge finance work | spreadsheet/model QA sources | Deliverable family |

## Selected external anchors

- Stripe Billing: https://docs.stripe.com/billing
- Stripe Entitlements: https://docs.stripe.com/billing/entitlements
- Stripe Customer Portal: https://docs.stripe.com/customer-management
- Expo Skills: https://docs.expo.dev/skills/
- React Email: https://react.email/
- Resend Templates: https://resend.com/features/templates
- PostHog feature flags: https://posthog.com/docs/feature-flags
- PostHog replay privacy: https://posthog.com/docs/session-replay/privacy
- OpenStatus: https://www.openstatus.dev/docs
- Google Search Central: https://developers.google.com/search/docs
- Shopify Hydrogen: https://shopify.dev/docs/api/hydrogen/latest
- W3C WAI/WCAG: https://www.w3.org/WAI/standards-guidelines/wcag/
- UK ICO: https://ico.org.uk/
- Nigeria NDPC: https://ndpc.gov.ng/

## Promotion rule

Before an external candidate becomes a protected Foundry default:
1. identify the exact problem it solves;
2. prefer the smallest reusable principle over copying a whole stack;
3. test it in a representative project;
4. record failures/edge cases;
5. add resolver/behavior evals;
6. only then mark it Foundry-approved.
