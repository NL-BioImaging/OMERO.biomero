import json
import os
import logging
import uuid

from collections import defaultdict
from django.http import HttpResponseBadRequest, JsonResponse
from django.views.decorators.http import require_http_methods
from omeroweb.webclient.decorators import login_required, render_response
from omero_adi.utils.ingest_tracker import (
    initialize_ingest_tracker,
    log_ingestion_step,
    STAGE_NEW_ORDER,
)

from .settings import (
    SUPPORTED_FILE_EXTENSIONS,
    EXTENSION_TO_FILE_BROWSER,
    EXTENSIONS_WITH_HIDDEN_ACCOMPANYING_FILES,
    PREPROCESSING_EXTENSION_MAP,
    GROUP_TO_FOLDER_MAPPING_FILE_PATH,
    FOLDER_EXTENSIONS_NON_BROWSABLE,
    BASE_DIR,
    PREPROCESSING_CONFIG,
)
from .utils import build_extra_params

logger = logging.getLogger(__name__)


# TODO move this into the view function that needs it
def initialize_adi():
    """
    Called when the app is ready. We initialize the IngestTracker from ADI
    using an environment variable.
    """
    db_url = os.getenv("INGEST_TRACKING_DB_URL")
    if not db_url:
        logger.error("Environment variable 'INGEST_TRACKING_DB_URL' not set")
        return

    config = {"ingest_tracking_db": db_url}

    try:
        if initialize_ingest_tracker(config):
            logger.info("IngestTracker initialized successfully")
        else:
            logger.error("Failed to initialize IngestTracker")
    except Exception as e:
        logger.error(
            f"Unexpected error during IngestTracker initialization: {e}",
            exc__info=True,
        )


initialize_adi()


@login_required()
@render_response()
@require_http_methods(["GET"])
def get_folder_contents(request, conn=None, **kwargs):
    """
    Handles the GET request to retrieve folder contents.
    """

    # Extract the folder ID from the request
    item_id = request.GET.get("item_id", None)
    is_folder = request.GET.get("is_folder", False)

    # Split the item ID to get the folder ID and item UUID
    item_uuid = None
    if item_id and "#" in item_id:
        item_path, item_uuid = item_id.split("#") if item_id else (None, None)
    else:
        item_path = item_id

    logger.info(f"Connection: {conn.getUser().getName()}")

    # Determine the target path based on item_path or default to root folder
    target_path = (
        BASE_DIR if item_path is None else os.path.join(BASE_DIR, item_path)
    )
    logger.info(f"Target folder: {target_path}")

    # Validate if the path exists
    if not os.path.exists(target_path):
        return HttpResponseBadRequest(
            "Invalid folder ID or path does not exist."
        )

    # Get the contents of the folder/file
    contents = []
    clicked_item_metadata = None
    logger.info(f"Item path: {target_path}, Item UUID: {item_uuid}")

    if os.path.isfile(target_path):
        ext = os.path.splitext(target_path)[1]
        if ext in EXTENSION_TO_FILE_BROWSER:
            if is_folder:
                metadata = EXTENSION_TO_FILE_BROWSER[ext](
                    target_path, folder_uuid=item_uuid
                )
            elif item_uuid:
                metadata = EXTENSION_TO_FILE_BROWSER[ext](
                    target_path, image_uuid=item_uuid
                )
            else:
                metadata = EXTENSION_TO_FILE_BROWSER[ext](target_path)

            clicked_item_metadata = json.loads(metadata)

            for item in clicked_item_metadata["children"]:
                item_type = item.get("type", None)
                contents.append(
                    {
                        "name": item["name"],
                        "is_folder": item_type == "Folder",
                        "id": item_path + "#" + item["uuid"],
                        "metadata": item,
                        "source": "filesystem",
                    }
                )

        elif ext in SUPPORTED_FILE_EXTENSIONS:
            contents.append(
                {
                    "name": os.path.basename(target_path),
                    "is_folder": False,
                    "id": item_path,
                    "metadata": None,
                    "source": "filesystem",
                }
            )
        else:
            return HttpResponseBadRequest(
                "Invalid folder ID or path does not exist."
            )

    elif target_path.endswith(".zarr"):  # Handle .zarr folders as files
        contents.append(
            {
                "name": os.path.basename(target_path),
                "is_folder": False,
                "id": item_path,
                "metadata": None,
                "source": "filesystem",
            }
        )
    else:  # Folder case
        items = os.listdir(target_path)
        # If there is a file with extension in EXTENSIONS_WITH_HIDDEN_ACCOMPANYING_FILES, hide the accompanying files
        special_items = []
        for item in items:
            item_ext = os.path.splitext(item)[1]
            if item_ext in EXTENSIONS_WITH_HIDDEN_ACCOMPANYING_FILES:
                special_items.append(item)

        if special_items:
            # There can be only one key item; error if multiple
            if len(special_items) != 1:
                ext_list = ", ".join(EXTENSIONS_WITH_HIDDEN_ACCOMPANYING_FILES)
                return HttpResponseBadRequest(
                    f"There can be only one file with extension [{ext_list}] in the folder '{target_path}'"
                )
            item_ext = os.path.splitext(special_items[0])[1]
            logger.info(
                f"Special item found: {special_items[0]} ext {item_ext}"
            )
            contents.append(
                {
                    "name": special_items[0],
                    "is_folder": item_ext in EXTENSION_TO_FILE_BROWSER,
                    "id": os.path.relpath(special_items[0], BASE_DIR),
                    "metadata": None,
                    "source": "filesystem",
                }
            )

        else:
            for item in items:
                item_path = os.path.join(target_path, item)
                # Get extension, if any
                ext = os.path.splitext(item)[1]
                info = f"Item: {item}, Path: {item_path}, Extension: {ext}"
                is_folder = (
                    os.path.isdir(item_path) or ext in EXTENSION_TO_FILE_BROWSER
                ) and ext not in FOLDER_EXTENSIONS_NON_BROWSABLE

                metadata = None
                if ext in EXTENSION_TO_FILE_BROWSER:
                    metadata = EXTENSION_TO_FILE_BROWSER[ext](item_path)

                contents.append(
                    {
                        "name": item,
                        "is_folder": is_folder,
                        "id": os.path.relpath(item_path, BASE_DIR),
                        "info": info,
                        "metadata": metadata,
                        "source": "filesystem",
                    }
                )

    # Sort the contents by name, folders first
    contents.sort(key=lambda x: (not x["is_folder"], x["name"].lower()))

    return {
        "contents": contents,
        "item_id": item_id,
        "metadata": clicked_item_metadata,
    }


@login_required()
@require_http_methods(["POST"])
def import_selected(request, conn=None, **kwargs):
    try:
        data = json.loads(request.body)
        upload = data.get("upload", {})
        selected_items = upload.get("selectedLocal", [])
        selected_destinations = upload.get("selectedOmero", [])
        selected_group = upload.get("group")  # Get group from request

        if not selected_items:
            return JsonResponse({"error": "No items selected"}, status=400)
        if not selected_destinations:
            return JsonResponse(
                {"error": "No destinations selected"}, status=400
            )
        if not selected_group:
            return JsonResponse({"error": "No group specified"}, status=400)

        # Get the current user's information
        current_user = conn.getUser()
        username = current_user.getName()
        user_id = current_user.getId()

        # Validate the group
        available_groups = [g.getName() for g in conn.getGroupsMemberOf()]
        if selected_group not in available_groups:
            return JsonResponse(
                {"error": f"User is not a member of group: {selected_group}"},
                status=403,
            )

        # Log the import attempt
        logger.info(
            f"User {username} (ID: {user_id}, group: {selected_group}) attempting to import {len(selected_items)} items"
        )

        # Call process_files with validated group
        process_files(
            selected_items, selected_destinations, selected_group, username
        )

        return JsonResponse(
            {
                "status": "success",
                "message": f"Successfully queued {len(selected_items)} items for import",
            }
        )
    except json.JSONDecodeError:
        return JsonResponse({"error": "Invalid JSON data"}, status=400)
    except Exception as e:
        logger.error(f"Import error: {str(e)}")
        return JsonResponse({"error": str(e)}, status=500)


@login_required()
@require_http_methods(["GET", "POST"])
def group_mappings(request, conn=None, **kwargs):
    """Handle group mappings GET and POST requests."""
    try:
        if request.method == "GET":
            # Read mappings from file if it exists
            if os.path.exists(GROUP_TO_FOLDER_MAPPING_FILE_PATH):
                with open(GROUP_TO_FOLDER_MAPPING_FILE_PATH, "r") as f:
                    mappings = json.load(f)
            else:
                mappings = {}

            return JsonResponse({"mappings": mappings})

        elif request.method == "POST":
            # Get the current user info
            current_user = conn.getUser()
            username = current_user.getName()
            user_id = current_user.getId()
            is_admin = conn.isAdmin()

            # Only allow admins to update mappings
            if not is_admin:
                return JsonResponse(
                    {"error": "Only administrators can update group mappings"},
                    status=403,
                )

            try:
                data = json.loads(request.body)
                mappings = data.get("mappings", {})

                # Save mappings to file
                with open(GROUP_TO_FOLDER_MAPPING_FILE_PATH, "w") as f:
                    json.dump(mappings, f, indent=2)

                logger.info(
                    f"Group mappings updated by {username} (ID: {user_id})"
                )
                return JsonResponse({"message": "Mappings saved successfully"})

            except json.JSONDecodeError:
                return JsonResponse({"error": "Invalid JSON data"}, status=400)

    except Exception as e:
        logger.error(f"Error handling group mappings: {str(e)}")
        return JsonResponse({"error": str(e)}, status=500)


def process_files(selected_items, selected_destinations, group, username):
    """
    Process selected files & destinations to create upload orders with
    appropriate preprocessing.
    """
    # Group files by preprocessing config
    files_by_preprocessing = defaultdict(list)

    for item in selected_items:
        # Support old string & new object format (backward compatible)
        if isinstance(item, dict):
            # New format with localPath and uuid
            local_path = item.get("localPath")
            subfile_uuid = item.get("uuid")
        else:
            # Old format - just a string path
            local_path = item
            subfile_uuid = None

        abs_path = os.path.abspath(os.path.join(BASE_DIR, local_path))

        logger.info(
            "Importing: %s to %s (UUID: %s)",
            abs_path,
            selected_destinations,
            subfile_uuid,
        )

        for sample_parent_type, sample_parent_id in selected_destinations:
            if sample_parent_type in ("screens", "Screen"):
                sample_parent_type = "Screen"
            elif sample_parent_type in ("datasets", "Dataset"):
                sample_parent_type = "Dataset"
            else:
                raise ValueError(
                    f"Unknown type {sample_parent_type} for id {sample_parent_id}"
                )

            file_ext = os.path.splitext(local_path)[1].lower()
            preprocessing_key = PREPROCESSING_EXTENSION_MAP.get(file_ext)

            file_info = {
                "path": abs_path,
                "uuid": subfile_uuid,
                "original_item": item,
            }
            files_by_preprocessing[(
                sample_parent_type,
                sample_parent_id,
                preprocessing_key,
            )].append(file_info)

    # Now create orders for each group
    for (
        sample_parent_type,
        sample_parent_id,
        preprocessing_key,
    ), file_infos in files_by_preprocessing.items():

        # Extract just the file paths for the Files field
        files = [file_info["path"] for file_info in file_infos]

        order_info = {
            "Group": group,
            "Username": username,
            "DestinationID": sample_parent_id,
            "DestinationType": sample_parent_type,
            "UUID": str(uuid.uuid4()),
            "Files": files,
        }

        cfg = (
            PREPROCESSING_CONFIG.get(preprocessing_key)
            if preprocessing_key
            else None
        )
        if cfg:
            order_info["preprocessing_container"] = cfg["container"]
            order_info["preprocessing_inputfile"] = "{Files}"
            order_info["preprocessing_outputfolder"] = "/data"
            order_info["preprocessing_altoutputfolder"] = "/out"

            template_extra = cfg.get("extra_params") or {}
            uses_uuid_placeholder = any(
                isinstance(v, str) and "{UUID}" in v
                for v in template_extra.values()
            )

            if uses_uuid_placeholder:
                uuid_files = [f for f in file_infos if f["uuid"]]
                non_uuid_files = [f for f in file_infos if not f["uuid"]]

                if not uuid_files:
                    logger.warning(
                        "Preprocessing key '%s' uses {UUID} but no UUIDs "
                        "found in %d files.",
                        preprocessing_key,
                        len(file_infos),
                    )
                    extra_params = build_extra_params(template_extra, None)
                    if extra_params:
                        order_info["extra_params"] = extra_params
                else:
                    for f in uuid_files:
                        per_order = order_info.copy()
                        per_order["Files"] = [f["path"]]
                        per_order["UUID"] = str(uuid.uuid4())
                        extra_params = build_extra_params(
                            template_extra, f["uuid"]
                        )
                        if extra_params:
                            per_order["extra_params"] = extra_params
                        create_upload_order(per_order)

                    if non_uuid_files:
                        grouped = order_info.copy()
                        grouped["Files"] = [f["path"] for f in non_uuid_files]
                        grouped["UUID"] = str(uuid.uuid4())
                        extra_params = build_extra_params(
                            template_extra, None
                        )
                        if extra_params:
                            grouped["extra_params"] = extra_params
                        create_upload_order(grouped)
                    continue
            else:
                if any(f["uuid"] for f in file_infos):
                    logger.info(
                        "Ignoring %d provided file UUID(s) for "
                        "preprocessing key '%s' without {UUID} placeholder.",
                        sum(1 for f in file_infos if f["uuid"]),
                        preprocessing_key,
                    )
                extra_params = build_extra_params(template_extra, None)
                if extra_params:
                    order_info["extra_params"] = extra_params

        # Create order (either no preprocessing or already enriched)
        create_upload_order(order_info)


def create_upload_order(order_dict):
    # Log the new order using the original attributes.
    log_ingestion_step(order_dict, STAGE_NEW_ORDER)
