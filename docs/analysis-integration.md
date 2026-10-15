# Analysis integration baseline

The 1.7.0b7 prerelease baseline from `analysis_integration` combines the current BIOMERO backend with
the embedded OMERO.Analysis host. It retains workflow history, shallow-Zarr
policy controls, and the single-store dependency requirements from `main`.

Use Analysis 1.0.1, optional WorkflowSkills 0.4.0 and DataQueryWorker 0.2.2.
Analysis 1.0.1 is published on
[PyPI](https://pypi.org/project/omero-analysis/1.0.1/) and
[GitHub Releases](https://github.com/NL-BioImaging/OMERO.Analysis/releases/tag/v1.0.1)
with identical application wheels, including the rebuilt frontend and complete
browser runtime. The notebook SDK retains its independent version.
The web environment must also satisfy this package's BIOMERO >=2.9.0b11 and importer >=1.5.0b8
requirements; the former 1.6.1 host backport is no longer the source baseline.

Analysis is optional: upgrading `omero-biomero` does not install Analysis,
WorkflowSkills or a query worker. The host is disabled when its feature flag
is absent or false. Install `omero-biomero==1.7.0b7` from PyPI; no deployment
patch or commit-based build is needed.

The current PR revision additionally protects unsaved Analysis edits on host
navigation, ignores obsolete upload responses, supports staged uploads, and
shows retryable launch errors. Its Blueprint theme and portals are scoped to the
plugin, layout uses Tailwind, and monitor renewal pauses while the panel or
document is inactive. These changes include regenerated frontend assets and
require the current source revision until a subsequent OMERO.biomero package is
published; the existing 1.7.0b7 wheel does not contain this follow-up revision.

Set `INTEGRATE_DATA_ANALYSIS=TRUE` and install/register `omero_analysis` to
enable the Data Analysis host. Source selection, remote input bindings and
managed-workspace resume use the same-origin Analysis iframe. Analysis checks
the installed host view, template and compiled assets before hiding its
standalone navigation entry.

The branch also incorporates the previously deployed fixes for cached image
selection, rejection of invalid workflow input IDs and renewal of user-scoped
monitor tokens. These fixes now belong to this repository instead of a
deployment-maintained source patch.

## Validation

- `cd webapp && yarn install --frozen-lockfile`
- `CI=true yarn test --watchAll=false --runInBand`
- `yarn build`
- `python manage.py test`
- Build and install the wheel, then run Analysis's installed-host contract test.

Before releasing a combined deployment, check Import, Analyze, Data Analysis,
workspace resume, source/group preservation and the disabled-integration
fallback in an authenticated browser. The workflow-version descriptor issue
[#32](https://github.com/NL-BioImaging/OMERO.biomero/issues/32) is a separate
known limitation; this integration update does not claim to fix it.
