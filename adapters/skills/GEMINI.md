# Major skill invocation

The installed catalogue is `~/.major/skills.catalog.json` (managed projects also expose `.agents/skills.catalog.json`). Discover skills with `major skill search --query "<need>"`. Explicit invocation is `major skill resolve --task "<task>" --skill <id>`; repeat `--skill` to compose skills. Every requested skill is mandatory: unknown, deprecated, or unavailable selections fail clearly. Omit `--skill` to preserve automatic resolution. Inspect the JSON receipt with `--json`.
