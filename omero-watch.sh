#!/bin/bash
# Watch for changes in the OMERO.biomero directory and update the OMERO.web container

# Directory to monitor
WATCHED_DIR="omero_biomero"

# Name of the Docker container
CONTAINER_NAME="nl-biomero-omeroweb-1"

# Command to execute inside the container
COMMAND0="chmod a+w /opt/omero/web/OMERO.web/var/static"
COMMAND1="/opt/omero/web/venv3/bin/pip install -e /opt/omero/web/OMERO.biomero"
COMMAND2="/opt/omero/web/venv3/bin/omero-biomero-setup"
COMMAND3="/opt/omero/web/venv3/bin/omero web stop"
COMMAND4="/opt/omero/web/OMERO.biomero/startup.sh"

# Monitor for changes
inotifywait -m -r -e close_write --format '%w%f' \
  --exclude './webapp(/.*)?' "$WATCHED_DIR" |
while read FILE; do
  echo "File changed: $FILE"

  # Execute the command in the Docker container
  docker exec --user root "$CONTAINER_NAME" sh -c "$COMMAND2"
  docker exec --user omero-web "$CONTAINER_NAME" sh -c "$COMMAND3"
  docker exec --user omero-web "$CONTAINER_NAME" sh -c "$COMMAND4"
done
