# <img src="https://raw.githubusercontent.com/NL-BioImaging/OMERO.biomero/refs/tags/v1.2.1/webapp/src/img/biomero-logo.svg" alt="BIOMERO" height="28" style="height:28px; width:auto; vertical-align:middle;"> OMERO.biomero Plugin
[![Upload Python Package](https://github.com/NL-BioImaging/OMERO.biomero/actions/workflows/publish-to-pypi.yml/badge.svg?event=release)](https://github.com/NL-BioImaging/OMERO.biomero/actions/workflows/publish-to-pypi.yml) [![CI](https://github.com/NL-BioImaging/OMERO.biomero/actions/workflows/ci.yml/badge.svg)](https://github.com/NL-BioImaging/OMERO.biomero/actions/workflows/ci.yml) 
> 🚀 **This package is part of <img src="https://raw.githubusercontent.com/NL-BioImaging/OMERO.biomero/refs/tags/v1.2.1/webapp/src/img/biomero-logo.svg" alt="BIOMERO" height="16" style="height:16px; width:auto; vertical-align:middle;"> BIOMERO 2.0** — For complete deployment and FAIR infrastructure setup, start with the [**NL-BIOMERO Documentation**](https://nl-bioimaging.github.io/NL-BIOMERO/) 📖



## Description

The OMERO.biomero plugin adds functionality to the OMERO web client, allowing users to upload images directly from the web client. The uploads are in-place, meaning that the data is not duplicated in OMERO but remains where it is. Users can monitor their uploads using a dashboard.

Additionally, the plugin provides a user-friendly interface to execute OMERO scripts and BioMero workflows and monitor their execution.

## Features

- **Image Uploads**: Upload images directly from the OMERO web client without duplicating data.
- **Upload Monitoring**: Monitor the status and history of uploads using a dashboard.
- **Script Execution**: Execute OMERO scripts through a user-friendly interface and monitor their execution.
- **Workflow Execution**: Execute BIOMERO workflows on SLURM cluster and monitor their execution.
- **Detached Workflow Execution**: With a compatible BIOMERO worker supervisor, queued workflows continue after the submitting browser or OMERO session ends.
- **Optional ROI Output**: Import label-image results and convert them into Polygon or Mask ROIs on the original images. BIOMERO automatically matches results to source images and selects label-like outputs on a best-effort basis.

### Detached workflows and session guidance

OMERO.biomero reads `BIOMERO_DETACHED_WORKFLOWS` so its submission message can
match the backend execution mode. When detached mode is enabled, the successful
response confirms that the workflow was handed to the background supervisor;
the user may close the tab or browser, and monitoring and automatic result
import continue independently of that web session. Deployments do not need
seven-day or infinite OMERO sessions, or an unusually large web-session cookie,
just to cover the complete workflow duration.

When detached mode is disabled, OMERO.biomero retains the warning to keep the
browser and OMERO session active because the workflow still runs inline.
NL-BIOMERO applies the setting consistently to the web and worker services. See the
[NL-BIOMERO detached-workflow guide](https://nl-bioimaging.github.io/NL-BIOMERO/sysadmin/detached-workflows.html)
for configuration and verification.

### File annotation destination behavior

Workflow dialogs now let users choose where non-image result files are
attached. The new UI defaults to **Auto**, which attaches to the selected
result destination when one exists and otherwise to the input container. This
is an intentional behavior change from older dialogs, which attached files to
the input Dataset or Plate. Cached and older clients that do not send the new
destination field retain that historical input-container behavior.

## Technologies Used

- **Frontend**: React
- **Backend**: Python/Django

## Group folder mapping compatibility

Administrators manage importer group-to-folder mappings in the importer Admin
Settings page. Saving mappings always writes the complete mapping object to:

- `group-mappings.json`, configured by `OMERO_BIOMERO_GROUP_MAPPINGS_FILE`.

When `biomero-config.json` already exists, saving also replaces its
`group_mappings` key. A missing legacy config is not created solely for group
mappings. Its location is configured by `OMERO_BIOMERO_CONFIG_FILE`.

The conditional second write preserves compatibility with BIOMERO scripts that still read
`biomero-config.json["group_mappings"]` directly. Both locations are replaced
with the complete submitted object, so deleting a mapping in the UI also removes
it from both files. Other top-level keys in `biomero-config.json` are preserved.

Reads remain backward compatible with deployments that only have
`biomero-config.json`: mappings from both files are merged, and values from
`group-mappings.json` take precedence when the same group exists in both.

## Development

The following instructions assume Ubuntu OS.
For development, we use [NL-BIOMERO](https://github.com/NL-BioImaging/NL-BIOMERO) - dockerized OMERO setup.

### Plate ROI postprocessing TODO

ROI creation from workflow label Images is currently exposed only for Image
and Dataset workflows. The Plate workflow UI deliberately hides this option,
while the backend continues to normalize requests from older clients to
`createRois=false` for compatibility.

The existing result code can enumerate the original Images in a Plate, but its
general result-to-source matcher still relies on names, similarity, and stable
ordering. Plate ROI support must instead pair only label-backed result Images
to their original Images by exact Plate/well/field membership (for example,
`A/1/1` to `A/1/1`). It must also exclude the normal source-backed result Plate
from label conversion and validate matching dimensions and coordinates before
calling `Labels2Rois`. Keep the UI gate until those rules have unit coverage and
a live multi-well Plate test.

### Setup and development of plugin core/Django files

1. Install Docker.
2. Clone the [omero-biomero](https://github.com/NL-BioImaging/OMERO.biomero.git).
3. Clone the [NL-BIOMERO](https://github.com/NL-BioImaging/NL-BIOMERO) repository and enter it.
4. **Folders with both repositories must be in the same parent folder**.
5. Enter `NL-BIOMERO` repository and start OMERO containers: `docker compose --file docker-compose-dev.yml up`. This compose file enables restarting OMERO Webclient server without causing the container to exit. It does **not** automatically start the Webclient server. It also mounts omero-biomero as a volume in the Webclient container. Changes to the plugin code are automatically reflected in the Webclient because pip installs the plugin in editable mode (see below).
6. In new terminal, enter `omero-biomero` repository and execute `./omero-init.sh`. This will start the OMERO Webclient server **in background mode**. It also installs the plugin in editable mode, so changes to the plugin code are automatically reflected in the Webclient.
7. After making changes to the code **outside of the folder webapp**, they should be automatically reflected in the webclient. You can also execute `./omero-update.sh` to restart the Webclient server and apply changes.

### Testing

To run tests, create virtual environment, activate it and install the package in editable mode (this automatically pulls all dependencies from setup.py):

```
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -e .
```

Then you can run the tests using:

```
python manage.py test
```

**Note**: All dependencies (including `biomero-importer>=1.0.0b5`) are automatically installed from setup.py when you install with `-e .`

### Setup and development of the plugin frontend

1. Install Node.js and Yarn.
   - For Windows, install Corepack as superuser, then you can run yarn commands like `corepack yarn install`
2. Enter `omero-biomero` repository and enter the `webapp` folder.
3. Run `yarn install` to install the necessary packages.
4. Run `yarn watch` to watch for changes in the code and automatically rebuild the code on save. Each time code is rebuilt, Webclient server will automatically restart (~30s), which will update JS bundle in the Webclient static folder. Reload the Webclient page to see changes.
5. To build the code for production, run `yarn build`. This will also copy the JS bundle to the Webclient static folder and restart the Webclient server.

### Troubleshooting

- Sometimes the plugin page loading will fail after multiple server restarts and you will see 404 error in the console, informing that plugin JS bundle could not be found, even though the files \*_are_ present on the server at the correct location. We found that the only way to fix this is to restart NL-BIOMERO containers: `docker compose --file docker-compose-dev.yml up` in the `NL-BIOMERO` repository.
