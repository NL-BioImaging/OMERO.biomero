#!/bin/bash
# Initialize OMERO.biomero for development in the OMERO.web container

# Name of the Docker container
CONTAINER_NAME="nl-biomero-omeroweb-1"

# Command to execute inside the container
# COMMAND1="/usr/local/bin/entrypoint.sh"
COMMAND0="chmod a+w /opt/omero/web/OMERO.web/var/static"

COMMAND1="/opt/omero/web/venv3/bin/python -m pip install -e /opt/omero/web/OMERO.biomero"
COMMAND2="/opt/omero/web/venv3/bin/omero-biomero-setup"

COMMAND3="/opt/omero/web/venv3/bin/omero web stop"
COMMAND4="/opt/omero/web/OMERO.biomero/startup.sh"

docker exec --user root "$CONTAINER_NAME" sh -c "$COMMAND0"
docker exec --user root "$CONTAINER_NAME" sh -c "$COMMAND1"
docker exec --user root "$CONTAINER_NAME" sh -c "$COMMAND2"
docker exec --user omero-web "$CONTAINER_NAME" sh -c "$COMMAND3"
docker exec --user omero-web "$CONTAINER_NAME" sh -c "$COMMAND4"
