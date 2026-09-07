---
name: omero-biomero-dev
description: Development runbook for the OMERO.biomero Django and React web plugin. Use when changing omero_biomero views, URLs, templates, settings, or tests; changing webapp React components, BlueprintJS/Tailwind UI, API calls, polling, state, or generated frontend assets; adding database-backed monitoring; updating configuration or deployment surfaces; or debugging OMERO.biomero integration with BIOMERO importer and converter services.
---

# OMERO.biomero Development

Work from the repository root, the directory containing `.agents`. Inspect the
current branch, `git status`, and the nearest related implementation and tests
before editing. Match local conventions and make the smallest coherent change;
do not reformat or rewrite unrelated code.

Preserve released behavior and deployment compatibility unless the user
explicitly authorizes a breaking change. Treat generated frontend bundles as
tracked deployment artifacts: frontend source and its production bundle must be
committed and published together.

## Workflow

1. Trace the behavior end to end: React caller, shared state/API service,
   Django URL/view, database or OMERO gateway access, tests, and deployment
   configuration.
2. Write a focused regression or behavior test and observe it fail when
   practical. If implementation and tests must be batched, temporarily disable
   the new behavior to prove the positive test goes red, then restore it.
3. Implement using the nearest established pattern. Extract shared code only
   when behavior genuinely repeats.
4. Run the narrowest useful checks, then the relevant backend/frontend suite.
   Read the repository README's Testing section before choosing commands. For
   backend or integration changes, include its documented `python manage.py
   test` run; for React behavior, also run the focused `yarn test` selection
   described by the frontend reference.
5. Run Python installation and tests through the repository-local `venv`.
   Install the editable package and test requirements into that environment
   when imports are missing; never fall back to bare `python` or `pip`.
6. During local-only work, including local commits, do not start a competing
   frontend watcher, invoke `clear-assets` directly, or produce a release build;
   preserve the developer's watch/dev output. When the task includes pushing
   frontend changes, run `corepack yarn build` from `webapp` immediately before
   the final commit and push, verify the generated manifest and assets, and
   include them in the published commit. Do not publish frontend source with a
   stale bundle. Inspect the complete diff and run `git diff --check`.
7. During merges, treat conflicts under the generated frontend asset directory
   as disposable output, not source to reconcile manually. Resolve the actual
   frontend source first and choose either side's generated files only as needed
   to clear Git's conflicts. From the resulting merged source, run
   `corepack yarn build` in `webapp` and replace the chosen artifacts with that
   fresh output. Commit the regenerated assets in the merge commit or an
   immediate follow-up, and push the merge and asset update together.

## Reference Routing

Read only the references needed for the task:

- [references/frontend.md](references/frontend.md): React state and effects,
  BlueprintJS/Tailwind conventions, reusable UI, polling, accessibility,
  frontend tests, lint, and watcher-owned assets.
- [references/django-api-testing.md](references/django-api-testing.md): Django
  and OMERO view patterns, authentication and authorization, safe APIs and SQL,
  backend tests, and CI verification.
- [references/config-and-deployment.md](references/config-and-deployment.md):
  configuration/admin UI consistency, templates, dependencies, generated
  assets, and sibling deployment repositories.
- [references/importer-converter-debug.md](references/importer-converter-debug.md):
  Docker/Podman importer-converter debugging, logs, OMERO database checks, and
  physical-unit registration pitfalls.

## Core Rules

- Prefer BlueprintJS components, then existing Tailwind utilities. Add custom
  CSS only when neither expresses the required behavior.
- Keep feature-local state local. Put data in `AppContext` only when multiple
  independent consumers require the same source of truth.
- Treat effect dependencies, cleanup, request cancellation, stale responses,
  overlapping polling, inactive tabs, document visibility, stable keys, and
  loading/error/empty states as mandatory review points.
- Require authentication on plugin APIs and derive user scope from the OMERO
  connection, never from client-supplied identity. Validate inputs, parameterize
  SQL, preserve CSRF handling, encode generated links, and keep secrets and raw
  infrastructure errors out of responses.
- Reuse constants, API helpers, components, and derived state rather than
  duplicating values. Do not add global state merely to avoid passing a prop.
- Preserve unrelated worktree changes. Do not use destructive Git commands.
