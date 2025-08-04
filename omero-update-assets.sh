#!/bin/bash
# Update OMERO.biomero assets in the OMERO.web container

# Define the Docker container name
CONTAINER_NAME="nl-biomero-omeroweb-1"

# Define source and destination directories inside the container
SRC_DIR="/opt/omero/web/OMERO.biomero/static/omero_biomero/assets"
DEST_DIR="/opt/omero/web/OMERO.web/var/static/omero_biomero/assets"

# Execute the Docker command to copy files
docker exec "$CONTAINER_NAME" bash -c "cp -r ${SRC_DIR}/* ${DEST_DIR}/"

# Check if the command was successful
if [ $? -eq 0 ]; then
  echo "Files successfully copied from $SRC_DIR to $DEST_DIR in container $CONTAINER_NAME."
else
  echo "Failed to copy files in container $CONTAINER_NAME."
  exit 1
fi