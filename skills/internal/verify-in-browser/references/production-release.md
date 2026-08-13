# Production web release checks

Use the applicable checks for a public launch or production promotion.

## Critical journeys

- Prove real navigation, forms, scheduling, account, checkout or other conversion paths against the intended environment.
- Check back/forward behavior, deep links, refresh, cancellation, duplicate submission, touch input and a real 404.
- Confirm analytics and consent behavior without exposing personal data.
- Compare staging and production configuration, routes, redirects, headers and cache behavior.

## Performance

- Measure representative LCP and CLS rather than inferring them from code.
- Inspect bundle and hydration warnings when the framework exposes them.
- Check image/font loading, layout shift, long tasks and avoidable request waterfalls.
- Record the device, network profile, URL and exact deployed revision.

## Search and sharing

- Check title, description, canonical URL, robots directives and sitemap where the surface is indexable.
- Validate structured data only when the page uses it.
- Check link previews and social metadata when launch scope includes sharing.
- Keep previews non-indexable until the exact approved production revision is promoted.

## Release evidence

- Record the exact deployment URL and revision.
- Preserve screenshots/traces for critical paths and failures.
- Require an independent reviewer for Product launch.
- Recheck the public custom domain after propagation. A preview pass does not prove production routing.
