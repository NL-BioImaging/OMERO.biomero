# OMERO.biomero

OMERO.web plugin for BIOMERO: a Django backend (`omero_biomero`) with a React
frontend (`webapp`) for workflow monitoring, importing and configuration inside
OMERO.web. Published to PyPI as `omero-biomero`.

## Read first

1. Shared rules for all component repositories:
   <https://github.com/NL-BioImaging/NL-BIOMERO/blob/master/.agents/skills/nl-biomero-engineering/SKILL.md>
2. Independent PR review procedure:
   <https://github.com/NL-BioImaging/NL-BIOMERO/blob/master/.agents/skills/nl-biomero-review/SKILL.md>
3. Development runbook for this repository:
   [`.agents/skills/omero-biomero-dev/SKILL.md`](.agents/skills/omero-biomero-dev/SKILL.md)
   and the `references/` it routes to.

## Layout

- `omero_biomero/`: Django app (views, urls, templates, settings, `tests/`).
- `webapp/`: React source (BlueprintJS, Tailwind, webpack, Jest via react-scripts).
- `omero_biomero/static/omero_biomero/assets/`: committed production frontend
  bundle; commit it together with the frontend source.
- `docs/`, `setup.py`, `pyproject.toml`: documentation and packaging.

## Build and test

- Python (in a virtual environment): `pip install -e .`, then
  `python manage.py test` (needs `omero-py` and Ice; see the README Testing
  section and `.agents/skills/omero-biomero-dev/references/django-api-testing.md`).
- Frontend tests, from `webapp/`: `yarn install --frozen-lockfile`, then
  `CI=true yarn test --watchAll=false --runInBand`.
- Frontend bundle, from `webapp/`: `yarn build` (clears and regenerates the
  committed assets).
- CI: `.github/workflows/ci.yml` runs the frontend tests and build, then
  `python manage.py test`; `publish-to-pypi.yml` publishes releases.

## Related repositories

biomero (core), biomero-scripts, BIOMERO.importer, NL-BIOMERO, BIOMERO.shallower,
biomero-schema, BIOMERO.ZarrViewer, all under <https://github.com/NL-BioImaging>.
Each has its own `AGENTS.md`.
