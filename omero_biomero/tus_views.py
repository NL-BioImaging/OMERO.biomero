"""
Custom TUS protocol implementation for resumable uploads.
Implements TUS 1.0.0 protocol without depending on django-tus.
"""

import json
import logging
import os
import uuid
from pathlib import Path

from django.http import HttpResponse, JsonResponse
from django.views import View
from django.views.decorators.csrf import csrf_exempt
from django.utils.decorators import method_decorator

from .settings import TUS_UPLOAD_DIR, TUS_DESTINATION_DIR

logger = logging.getLogger(__name__)


def ensure_directories():
    """Ensure TUS directories exist."""
    Path(TUS_UPLOAD_DIR).mkdir(parents=True, exist_ok=True)
    Path(TUS_DESTINATION_DIR).mkdir(parents=True, exist_ok=True)


def get_metadata_path(resource_id):
    """Get the path to the metadata file for a given resource."""
    return os.path.join(TUS_UPLOAD_DIR, f"{resource_id}.meta")


def load_metadata(resource_id):
    """Load metadata from file."""
    meta_path = get_metadata_path(resource_id)
    if not os.path.exists(meta_path):
        return None
    try:
        with open(meta_path, "r") as f:
            return json.load(f)
    except (json.JSONDecodeError, IOError) as e:
        logger.error(f"Failed to load metadata for {resource_id}: {e}")
        return None


def save_metadata(resource_id, metadata):
    """Save metadata to file."""
    meta_path = get_metadata_path(resource_id)
    try:
        with open(meta_path, "w") as f:
            json.dump(metadata, f)
    except IOError as e:
        logger.error(f"Failed to save metadata for {resource_id}: {e}")


def delete_metadata(resource_id):
    """Delete metadata file."""
    meta_path = get_metadata_path(resource_id)
    if os.path.exists(meta_path):
        os.remove(meta_path)


@method_decorator(csrf_exempt, name="dispatch")
class TusUploadView(View):
    """
    TUS 1.0.0 protocol implementation for resumable uploads.

    Requires authentication via OMERO session.

    Supports:
    - POST: Create a new upload resource
    - HEAD: Get upload status/offset
    - PATCH: Upload chunk data
    - OPTIONS: Return TUS capabilities
    """

    TUS_VERSION = "1.0.0"
    TUS_EXTENSION = "creation,termination"
    TUS_MAX_SIZE = 50 * 1024 * 1024 * 1024  # 50GB max

    def _check_auth(self, request):
        """Check if request is authenticated. Returns error response or None."""
        if not hasattr(request, "session") or "connector" not in request.session:
            response = HttpResponse("Authentication required", status=401)
            response["Tus-Resumable"] = self.TUS_VERSION
            return response
        return None

    def _get_user_id(self, request):
        """Get user ID from session or connector."""
        # Try direct session key first (set by OMERO.web)
        user_id = request.session.get("user_id")
        if user_id is not None:  # Use 'is not None' to handle user_id = 0 (root user)
            logger.debug(f"Got user_id from session: {user_id}")
            return user_id

        # OMERO.web stores connector as a dict (via __dict__), not an object
        connector_data = request.session.get("connector")
        if connector_data:
            logger.debug(f"Connector data type: {type(connector_data)}")
            if isinstance(connector_data, dict):
                user_id = connector_data.get("user_id")
                if user_id is not None:  # Handle user_id = 0 (root user)
                    logger.debug(f"Got user_id from connector dict: {user_id}")
                    return user_id
            elif (
                hasattr(connector_data, "user_id")
                and connector_data.user_id is not None
            ):
                logger.debug(
                    f"Got user_id from connector object: {connector_data.user_id}"
                )
                return connector_data.user_id

        # Log session keys for debugging
        logger.warning(
            f"Could not find user_id. Session keys: {list(request.session.keys())}"
        )
        if connector_data:
            logger.warning(f"Connector data: {connector_data}")

        # Fallback to Django auth
        return request.session.get("_auth_user_id")

    def _check_ownership(self, request, meta):
        """Check if current user owns the upload. Returns error response or None."""
        user_id = self._get_user_id(request)
        if meta.get("user_id") and str(meta["user_id"]) != str(user_id):
            return HttpResponse("Access denied", status=403)
        return None

    def options(self, request, resource_id=None):
        """Return TUS server capabilities."""
        response = HttpResponse(status=204)
        response["Tus-Resumable"] = self.TUS_VERSION
        response["Tus-Version"] = self.TUS_VERSION
        response["Tus-Extension"] = self.TUS_EXTENSION
        response["Tus-Max-Size"] = str(self.TUS_MAX_SIZE)
        response["Access-Control-Allow-Origin"] = "*"
        response["Access-Control-Allow-Methods"] = "POST, HEAD, PATCH, OPTIONS, DELETE"
        response["Access-Control-Allow-Headers"] = (
            "Tus-Resumable, Upload-Length, Upload-Metadata, "
            "Upload-Offset, Content-Type, X-CSRFToken"
        )
        response["Access-Control-Expose-Headers"] = (
            "Tus-Resumable, Upload-Offset, Upload-Length, Location"
        )
        return response

    def post(self, request):
        """Create a new upload resource."""
        auth_error = self._check_auth(request)
        if auth_error:
            return auth_error

        ensure_directories()

        # Store the user ID with the upload for later verification
        user_id = self._get_user_id(request)

        # Parse upload length
        upload_length = request.headers.get("Upload-Length")
        if not upload_length:
            return HttpResponse("Missing Upload-Length header", status=400)

        try:
            upload_length = int(upload_length)
        except ValueError:
            return HttpResponse("Invalid Upload-Length", status=400)

        # Parse metadata (filename, etc.)
        metadata_header = request.headers.get("Upload-Metadata", "")
        metadata = self._parse_metadata(metadata_header)
        filename = metadata.get("filename", "unknown")

        # Generate unique resource ID
        resource_id = str(uuid.uuid4())

        # Create empty file for chunks
        chunk_path = os.path.join(TUS_UPLOAD_DIR, resource_id)
        with open(chunk_path, "wb") as f:
            pass  # Create empty file

        # Store metadata to file (including user ID for ownership verification)
        meta = {
            "length": upload_length,
            "offset": 0,
            "filename": filename,
            "metadata": metadata,
            "chunk_path": chunk_path,
            "user_id": user_id,
        }
        save_metadata(resource_id, meta)

        logger.info(f"Created TUS upload resource: {resource_id} for file: {filename}")

        # Build location URL
        location = request.build_absolute_uri(f"/omero_biomero/upload/{resource_id}")

        response = HttpResponse(status=201)
        response["Location"] = location
        response["Tus-Resumable"] = self.TUS_VERSION
        response["Access-Control-Allow-Origin"] = "*"
        response["Access-Control-Expose-Headers"] = "Location, Tus-Resumable"
        return response

    def head(self, request, resource_id=None):
        """Get current upload offset."""
        auth_error = self._check_auth(request)
        if auth_error:
            return auth_error

        if not resource_id:
            return HttpResponse("Missing resource ID", status=400)

        resource_id = str(resource_id)
        meta = load_metadata(resource_id)
        if meta is None:
            return HttpResponse("Upload not found", status=404)

        ownership_error = self._check_ownership(request, meta)
        if ownership_error:
            return ownership_error

        response = HttpResponse(status=200)
        response["Upload-Offset"] = str(meta["offset"])
        response["Upload-Length"] = str(meta["length"])
        response["Tus-Resumable"] = self.TUS_VERSION
        response["Access-Control-Allow-Origin"] = "*"
        response["Access-Control-Expose-Headers"] = (
            "Upload-Offset, Upload-Length, Tus-Resumable"
        )
        return response

    def patch(self, request, resource_id=None):
        """Receive chunk data."""
        auth_error = self._check_auth(request)
        if auth_error:
            return auth_error

        if not resource_id:
            return HttpResponse("Missing resource ID", status=400)

        resource_id = str(resource_id)
        meta = load_metadata(resource_id)
        if meta is None:
            return HttpResponse("Upload not found", status=404)

        ownership_error = self._check_ownership(request, meta)
        if ownership_error:
            return ownership_error

        # Check offset
        client_offset = request.headers.get("Upload-Offset")
        if client_offset is None:
            return HttpResponse("Missing Upload-Offset header", status=400)

        try:
            client_offset = int(client_offset)
        except ValueError:
            return HttpResponse("Invalid Upload-Offset", status=400)

        if client_offset != meta["offset"]:
            return HttpResponse(
                f"Offset mismatch: expected {meta['offset']}, got {client_offset}",
                status=409,
            )

        # Stream chunk data directly to file to avoid memory issues with large chunks
        chunk_path = meta["chunk_path"]
        bytes_written = 0

        try:
            with open(chunk_path, "ab") as f:
                # Stream from request in larger pieces for better throughput
                # 1MB buffer balances memory usage with I/O efficiency
                while True:
                    piece = request.read(1024 * 1024)  # 1MB read buffer
                    if not piece:
                        break
                    f.write(piece)
                    bytes_written += len(piece)
        except Exception as e:
            logger.error(f"Error writing chunk for {resource_id}: {e}")
            return HttpResponse(f"Error writing chunk: {e}", status=500)

        new_offset = meta["offset"] + bytes_written
        meta["offset"] = new_offset
        save_metadata(resource_id, meta)

        # Check if upload is complete
        if new_offset >= meta["length"]:
            self._finalize_upload(resource_id, meta)

        response = HttpResponse(status=204)
        response["Upload-Offset"] = str(new_offset)
        response["Tus-Resumable"] = self.TUS_VERSION
        response["Access-Control-Allow-Origin"] = "*"
        response["Access-Control-Expose-Headers"] = "Upload-Offset, Tus-Resumable"
        return response

    def delete(self, request, resource_id=None):
        """Cancel/delete an upload."""
        auth_error = self._check_auth(request)
        if auth_error:
            return auth_error

        if not resource_id:
            return HttpResponse("Missing resource ID", status=400)

        resource_id = str(resource_id)
        meta = load_metadata(resource_id)
        if meta is None:
            return HttpResponse("Upload not found", status=404)

        ownership_error = self._check_ownership(request, meta)
        if ownership_error:
            return ownership_error

        chunk_path = meta["chunk_path"]

        if os.path.exists(chunk_path):
            os.remove(chunk_path)

        delete_metadata(resource_id)

        logger.info(f"TUS upload {resource_id} cancelled/deleted")

        response = HttpResponse(status=204)
        response["Tus-Resumable"] = self.TUS_VERSION
        return response

    def _parse_metadata(self, header):
        """Parse TUS Upload-Metadata header."""
        import base64

        metadata = {}
        if not header:
            return metadata

        for item in header.split(","):
            item = item.strip()
            if " " in item:
                key, value = item.split(" ", 1)
                try:
                    metadata[key] = base64.b64decode(value).decode("utf-8")
                except Exception:
                    metadata[key] = value
            else:
                metadata[item] = None

        return metadata

    def _finalize_upload(self, resource_id, meta):
        """Move completed upload to user-specific destination directory."""
        ensure_directories()

        chunk_path = meta["chunk_path"]
        filename = meta["filename"]
        user_id = meta.get("user_id", "unknown")

        # Create per-user subdirectory to avoid filename conflicts between users
        user_dest_dir = os.path.join(TUS_DESTINATION_DIR, f"user_{user_id}")
        Path(user_dest_dir).mkdir(parents=True, exist_ok=True)

        # Ensure unique filename in destination (handle duplicates from same user)
        dest_path = os.path.join(user_dest_dir, filename)
        counter = 1
        base, ext = os.path.splitext(filename)
        while os.path.exists(dest_path):
            new_filename = f"{base}_{counter}{ext}"
            dest_path = os.path.join(user_dest_dir, new_filename)
            counter += 1
            if counter > 1000:  # Safety limit
                logger.error(f"Too many duplicate files for {filename}")
                break

        # Move file to destination
        try:
            os.rename(chunk_path, dest_path)
        except OSError:
            # If rename fails (e.g., cross-filesystem), copy and delete
            import shutil

            shutil.copy2(chunk_path, dest_path)
            os.remove(chunk_path)

        # Store the final destination path in metadata before cleaning up
        final_filename = os.path.basename(dest_path)

        logger.info(
            f"TUS upload {resource_id} complete for user {user_id}: {dest_path}"
        )

        # Clean up metadata file
        delete_metadata(resource_id)
