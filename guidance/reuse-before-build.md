# Reuse before build

For every non-trivial new capability, complete a reuse decision before custom implementation.

Search in this order:

1. current repository;
2. installed Major skills and project templates;
3. current dependencies;
4. official framework or platform capability;
5. maintained open-source library or template;
6. commercial or free tool already available;
7. custom implementation only when the prior options do not meet the requirement.

Record the decision in `.major/adoption-records/<problem-slug>.md` using `templates/project/ADOPTION.md` as the shape. The record must cover functional fit, integration effort, maintenance, license, security, performance, lock-in, current and likely cost, reversibility, custom code avoided and evidence.

Custom building requires a concrete gap in the considered options. Preference, novelty or familiarity with custom code is not enough.

Do not let this gate become research theatre. Small bug fixes, copy changes, established project patterns and trivial configuration do not need a record. Stop once evidence clearly selects a reversible option.

No adoption record grants paid spend, production access, credential transfer or destructive authority. Existing approval gates still apply.
