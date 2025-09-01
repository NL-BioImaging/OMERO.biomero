# OMERO.biomero Plugin

## Description

The OMERO.biomero plugin adds functionality to the OMERO web client, allowing users to upload images directly from the web client. The uploads are in-place, meaning that the data is not duplicated in OMERO but remains where it is. Users can monitor their uploads using a dashboard.

Additionally, the plugin provides a user-friendly interface to execute OMERO scripts and BioMero workflows and monitor their execution.

## Features

- **Image Uploads**: Upload images directly from the OMERO web client without duplicating data.
- **Upload Monitoring**: Monitor the status and history of uploads using a dashboard.
- **Script Execution**: Execute OMERO scripts through a user-friendly interface and monitor their execution.
- **Workflow Execution**: Execute BioMero workflows on SLURM cluster and monitor their execution.

## Technologies Used

- **Frontend**: React
- **Backend**: Python/Django

## Development

The following instructions assume Ubuntu OS.
For development, we use [NL-BIOMERO](https://github.com/Cellular-Imaging-Amsterdam-UMC/NL-BIOMERO) - dockerized OMERO setup.

### Setup and development of plugin core/Django files

1. Install Docker.
2. Clone the [omero-biomero](https://github.com/Cellular-Imaging-Amsterdam-UMC/omero-biomero.git).
3. Clone the [NL-BIOMERO](https://github.com/Cellular-Imaging-Amsterdam-UMC/NL-BIOMERO) repository and enter it. Switch to branch `BOOST`.
4. **Folders with both repositories must be in the same parent folder**.
5. Enter `NL-BIOMERO` repository and start OMERO containers: `docker compose --file docker-compose-dev.yml up`. This compose file enables restarting OMERO Webclient server without causing the container to exit. It does **not** automatically start the Webclient server. It also mounts omero-biomero as a volume in the Webclient container. Changes to the plugin code are automatically reflected in the Webclient because pip installs the plugin in editable mode (see below).
6. In new terminal, enter `omero-biomero` repository and execute `./omero-init.sh`. This will start the OMERO Webclient server **in background mode**. It also installs the plugin in editable mode, so changes to the plugin code are automatically reflected in the Webclient.
7. After making changes to the code **outside of the folder webapp**, they should be automatically reflected in the webclient. You can also execute `./omero-update.sh` to restart the Webclient server and apply changes.

### Testing

To run tests, create virtual environment, activate it and install dependencies:

```
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

Then you need to install omero-adi from the NL-BIOMERO repository:

```
pip install -e ../NL-BIOMERO/omeroadi/
```

(NL-BIOMERO repo must be cloned to the same directory)

Then you can run the tests using:

```
python3 manage.py test
```

### Setup and development of the plugin frontend

1. Install Node.js and Yarn.
   - For Windows, install Corepack as superuser, then you can run yarn commands like `corepack yarn install`
2. Enter `omero-biomero` repository and enter the `webapp` folder.
3. Run `yarn install` to install the necessary packages.
4. Run `yarn watch` to watch for changes in the code and automatically rebuild the code on save. Each time code is rebuilt, Webclient server will automatically restart (~30s), which will update JS bundle in the Webclient static folder. Reload the Webclient page to see changes.
5. To build the code for production, run `yarn build`. This will also copy the JS bundle to the Webclient static folder and restart the Webclient server.

### Troubleshooting

- Sometimes the plugin page loading will fail after multiple server restarts and you will see 404 error in the console, informing that plugin JS bundle could not be found, even though the files \*_are_ present on the server at the correct location. We found that the only way to fix this is to restart NL-BIOMERO containers: `docker compose --file docker-compose-dev.yml up` in the `NL-BIOMERO` repository.
