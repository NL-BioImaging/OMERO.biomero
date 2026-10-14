# Frontend Development

## Follow Existing Structure

- Start at `webapp/src/index.js`, then trace the selected top-level app,
  `AppContext.js`, `apiService.js`, `constants.js`, and the nearest component.
- Keep domain components under `biomero/` or `importer/`; put a component under
  `shared/` only when both domains genuinely use it.
- Keep transport functions in `apiService.js` and endpoint constants in the
  existing constants layer. Keep rendering and user interaction in components.
- Prefer derived values over mirrored state. Memoize only when it prevents
  meaningful work or stabilizes a dependency; do not use memoization by habit.

## Components and Styling

- Use BlueprintJS controls and states first: `Button`, `InputGroup`, `HTMLTable`,
  `Tag`, `ProgressBar`, `Spinner`, `Callout`, `NonIdealState`, `Tooltip`,
  `ButtonGroup`, dialogs, and form controls.
- Use the existing Tailwind setup for layout, spacing, sizing, responsive
  wrapping, overflow, and small visual adjustments.
- Add component CSS only as a last resort. Scope it narrowly and avoid global
  overrides of Blueprint classes.
- Preserve the surrounding density, typography, intent colors, and icon style.
  Do not introduce a second design system.
- Use semantic controls, associated labels, keyboard-reachable actions, visible
  focus states, and text/tooltips for icon-only actions. Do not communicate
  status by color alone.

## State, Effects, and Requests

- Keep one authoritative state value and derive filtered, paged, or formatted
  data from it. Lift state only to the nearest common consumer.
- Include every reactive value used by an effect, or make the dependency stable
  with `useCallback`. Do not silence `react-hooks/exhaustive-deps` without a
  documented lifecycle reason.
- Cancel obsolete Axios/fetch requests on dependency changes and unmount. Guard
  against late responses overwriting newer state.
- Debounce server-backed search. Reset or clamp pagination when filters or totals
  change.
- For polling, schedule the next refresh only after the current request settles.
  Prevent overlaps, pause while the owning tab or document is inactive, refresh
  on reactivation, and clean up timers and requests.
- Distinguish initial loading from background refresh. Preserve existing rows on
  a transient refresh failure and surface a non-destructive warning.
- Render explicit initial-loading, empty, initial-error, and stale-data states.
  Use stable domain identifiers for React keys, never an array index when an ID
  exists.
- Treat clipboard, date parsing, numeric progress, JSON parsing, and generated
  links as fallible. Validate or catch them and provide user feedback.

## Testing and Verification

- Replace generic scaffold tests with behavior tests using Testing Library.
  Query by role, label, and visible text instead of implementation details.
- Mock API boundaries, not React internals. Use fake timers for debouncing and
  polling, and verify cleanup, cancellation, stale-response protection, and
  inactive-tab behavior.
- Cover success, empty, initial failure, background failure, manual refresh,
  pagination/search, and accessible actions for asynchronous UI.

Run from `webapp/`:

```powershell
$env:CI='true'
corepack yarn test --watchAll=false --runInBand
.\node_modules\.bin\eslint.cmd src
```

During local-only work, including local commits, do not start a competing
watcher, invoke `clear-assets` directly, or produce a release build. Preserve
generated output from the developer's existing watcher. When the task includes
pushing frontend changes, run this from `webapp/` on the host platform
immediately before the final commit and push:

```text
corepack yarn build
```

The build performs its own asset cleanup and production compilation. Verify the
updated manifest and files under `omero_biomero/static/omero_biomero/assets`,
then commit those generated artifacts with the frontend source. Do not publish
frontend source while its packaged bundle is stale.

## Merging Generated Assets

Generated bundle names and manifests commonly conflict across branches. Do not
hand-merge their contents. Resolve the React and other frontend source first;
choose either side of generated-asset conflicts only to let Git establish the
merged tree. Then run `corepack yarn build` from `webapp/` and use its output as
the authoritative assets for the merged source.

The regenerated assets may be included in the merge commit or in an immediate
follow-up commit. Push the merge and regenerated-assets commit together; do not
publish a merge that leaves the arbitrary conflict-resolution bundle in place.
