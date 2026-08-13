# Visual-direction dossier

## Brief translation

```text
Product:
Primary users:
Primary task:
Business objective:
Emotional impression:
Trust requirement:
Information density:
Interaction complexity:
Desktop/mobile priority:
Existing brand constraints:
Required components:
Reference competitors:
What must feel familiar:
What may be experimental:
What must not be copied:
```

## Artifact

```text
design-research/
├── brief.md
├── reference-index.md
├── direction-a-conservative/
│   ├── moodboard
│   ├── rationale.md
│   └── reference-map.md
├── direction-b-progressive/
│   ├── moodboard
│   ├── rationale.md
│   └── reference-map.md
├── direction-c-exploratory/
│   ├── moodboard
│   ├── rationale.md
│   └── reference-map.md
└── recommendation.md
```

Use the lowest-effort browsable visual artifact: internal HTML, Figma frames, PDF or slides. Keep a project-local artifact or manifest for every direction. A Figma or external moodboard manifest records the source URL and permitted captured/exported evidence; the durable approval record points to that local manifest.

## Reference map

| Product area | Reference | What we take | Why it fits | What changes | What we reject |
| --- | --- | --- | --- | --- | --- |

## Approval matrix

| Criterion | Conservative | Progressive | Exploratory |
| --- | ---: | ---: | ---: |
| User comprehension | /10 | /10 | /10 |
| Trust | /10 | /10 | /10 |
| Brand distinctiveness | /10 | /10 | /10 |
| Implementation speed | /10 | /10 | /10 |
| Technical risk | /10 | /10 | /10 |
| Accessibility risk | /10 | /10 | /10 |
| Performance risk | /10 | /10 | /10 |
| MVP fit | /10 | /10 | /10 |
| Long-term potential | /10 | /10 | /10 |

## Durable approval decision

Copy `templates/project/DESIGN-DIRECTION.md` to `design-research/direction-decision.md`. Record the selected direction or coherent hybrid, one of the allowed approval sources, sanitized owner evidence, all three moodboards, the reference map and the resulting design contract. Keep `Status: pending` until the owner selects, approves a hybrid or explicitly delegates.

Run `major design check design-research/direction-decision.md` before broad production UI code. A fresh session must re-run this check rather than infer approval from chat history.

## Design contract

Record the approved thesis, tokens, typography, color, spacing, grid, components, motion, imagery, responsive rules, accessibility, performance budgets, reference map, exclusions, MVP/post-MVP split and acceptance criteria.
