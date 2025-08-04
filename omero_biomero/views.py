#!/usr/bin/env python
# -*- coding: utf-8 -*-
import configparser
import datetime
import json
import jwt
import logging
import os
import time
import uuid

from biomero import SlurmClient
from collections import defaultdict
from configupdater import ConfigUpdater, Comment
from django.http import JsonResponse, HttpResponseBadRequest
from django.views.decorators.http import require_http_methods
from omeroweb.webclient.decorators import login_required, render_response
from omero.rtypes import unwrap, rbool, wrap, rlong
from omero_adi.utils.ingest_tracker import initialize_ingest_tracker

from .utils import (
    create_upload_order,
    get_react_build_file,
    prepare_workflow_parameters,
    parse_bool_env,
)
from .settings import (
    EXTENSION_TO_FILE_BROWSER,
    SUPPORTED_FILE_EXTENSIONS,
    EXTENSIONS_WITH_INVISIBLE_ACCOMPANYING_FILES,
    DEFAULT_MOUNT_PATH,
    EXTENSIONS_REQUIRING_PREPROCESSING,
    EXTENSIONS_NON_BROWSABLE,
    MAPPINGS_FILE,
)

logger = logging.getLogger(__name__)

@login_required()
@require_http_methods(["GET", "POST"])
def admin_config(request, conn=None, **kwargs):
    """
    Read the biomero config
    """
    if request.method == "GET":
        try:
            current_user = conn.getUser()
            username = current_user.getName()
            user_id = current_user.getId()
            is_admin = conn.isAdmin()
            if not is_admin:
                logger.error(f"Unauthorized request for user {user_id}:{username}")
                return JsonResponse({"error": "Unauthorized request"}, status=403)
            # Load the configuration file
            configs = configparser.ConfigParser(allow_no_value=True)
            # Loads from default locations and given location, missing files are ok
            configs.read(
                [
                    os.path.expanduser(SlurmClient._DEFAULT_CONFIG_PATH_1),
                    os.path.expanduser(SlurmClient._DEFAULT_CONFIG_PATH_2),
                    os.path.expanduser(SlurmClient._DEFAULT_CONFIG_PATH_3),
                ]
            )
            # Convert configparser object to JSON-like dict
            config_dict = {
                section: dict(configs.items(section)) for section in configs.sections()
            }

            return JsonResponse({"config": config_dict})
        except Exception as e:
            logger.error(f"Error retrieving BIOMERO config: {str(e)}")
            return JsonResponse({"error": str(e)}, status=500)

    elif request.method == "POST":
        """
        Save the biomero config
        """
        try:
            # Parse the incoming JSON payload
            data = json.loads(request.body)
            current_user = conn.getUser()
            username = current_user.getName()
            user_id = current_user.getId()
            is_admin = conn.isAdmin()
            if not is_admin:
                logger.error(f"Unauthorized request for user {user_id}:{username}")
                return JsonResponse({"error": "Unauthorized request"}, status=403)

            # Define the file path for saving the configuration
            config_path = os.path.expanduser(SlurmClient._DEFAULT_CONFIG_PATH_3)

            # Create ConfigUpdater object
            config = ConfigUpdater()

            # Read the existing configuration if the file exists
            if os.path.exists(config_path):
                config.read(config_path)

            # Extract the 'config' section from the incoming data
            config_data = data.get("config", {})

            def generate_model_comment(key):
                if key.endswith("_job"):
                    c = "# The jobscript in the 'slurm_script_repo'"
                elif key.endswith("_repo"):
                    c = "# The (e.g. github) repository with the descriptor.json file"
                else:
                    c = "# Adding or overriding job value for this workflow"
                return c

            # Update the config with new values
            for section, settingsd in config_data.items():
                if not isinstance(settingsd, dict):
                    raise ValueError(
                        f"Section '{section}' must contain key-value pairs."
                    )

                # If the section doesn't exist, add it
                if section not in config:
                    config.add_section(section)

                if section == "MODELS":
                    # Group keys by prefix (cellpose, stardist, etc.)
                    model_keys = defaultdict(list)
                    for key, value in settingsd.items():
                        # Split the key on the known suffixes
                        model_prefix = key
                        for suffix in ["repo", "job"]:
                            if f"_{suffix}" in key:
                                model_prefix = key.split(f"_{suffix}")[0]
                                break
                        model_keys[model_prefix].append((key, value))

                    # Sort the prefixes and insert the keys in the correct order
                    for model_prefix in sorted(model_keys.keys()):
                        # Add the model-specific keys
                        for key, value in model_keys[model_prefix]:
                            # If the key already exists, just update it
                            if key in config[section]:
                                config.set(section, key, value)
                            else:
                                if key == model_prefix:
                                    comment = f"""
    # -------------------------------------
    # {model_prefix.capitalize()} (added via web UI)
    # -------------------------------------
    # The path to store the container on the slurm_images_path"""
                                    config.set(section, key, value)
                                    (
                                        config[section][
                                            model_prefix
                                        ].add_before.comment(comment)
                                    )
                                else:
                                    # For new keys, add the key and a comment before it
                                    model_comment = generate_model_comment(key)

                                    if "job_" in key:
                                        (
                                            config[section][model_prefix + "_job"]
                                            .add_after.comment(model_comment)
                                            .option(key, value)
                                        )
                                    elif "_job" in key:
                                        (
                                            config[section][model_prefix + "_repo"]
                                            .add_after.comment(model_comment)
                                            .option(key, value)
                                        )
                                    else:
                                        (
                                            config[section][model_prefix]
                                            .add_after.comment(model_comment)
                                            .option(key, value)
                                        )

                    # Check for removing top-level keys and related keys
                    for key in list(config[section].keys()):
                        model_prefix = key
                        for suffix in ["repo", "job"]:
                            if f"_{suffix}" in key:
                                model_prefix = key.split(f"_{suffix}")[0]
                                break
                        if model_prefix not in model_keys:
                            # Remove the unwanted key or subsection
                            del config[section][key]

                    for key in list(config[section].keys()):
                        if (
                            key not in settingsd
                        ):  # If key isn't in new settings, remove it
                            del config[section][key]

                elif section == "CONVERTERS":
                    # add new or edits as normal
                    for key, value in settingsd.items():
                        config.set(section, key, value)
                    # Check for removing top-level keys and related keys
                    for key in list(config[section].keys()):
                        if key not in settingsd.keys():
                            del config[section][key]
                else:
                    # Update or add the keys in the section
                    for key, value in settingsd.items():
                        config.set(section, key, value)

            # Prepare the update timestamp comment
            timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            change_comment = f"Config automatically updated by {username} ({user_id}) via the web UI on {timestamp}"
            # Check if the changelog section exists, and create it if not
            if "changelog" not in config:
                config.add_section("changelog")

            # Add the change comment as the first block of the changelog section
            changelog_section = config["changelog"]
            if isinstance(changelog_section.first_block, Comment):
                changelog_section.first_block.detach()
            changelog_section.add_after.comment(change_comment)

            # Save the updated configuration while preserving comments
            with open(config_path, "w") as config_file:
                config.write(config_file)

            logger.info(f"Configuration saved successfully to {config_path}")
            return JsonResponse(
                {"message": "Configuration saved successfully", "path": config_path},
                status=200,
            )

        except json.JSONDecodeError:
            logger.error("Invalid JSON data in the request")
            return JsonResponse({"error": "Invalid JSON data"}, status=400)
        except ValueError as e:
            logger.error(f"Invalid configuration format: {str(e)}")
            return JsonResponse(
                {"error": f"Invalid configuration format: {str(e)}"}, status=400
            )
        except Exception as e:
            logger.error(f"Unexpected error: {str(e)}")
            return JsonResponse(
                {"error": f"Failed to save configuration: {str(e)}"}, status=500
            )
    else:
        logger.error("Unsupported HTTP method for 'config' endpoint")
        return HttpResponseBadRequest("Unsupported HTTP method. Use GET or POST.")


@login_required()
@require_http_methods(["POST"])
def run_workflow_script(
    request, conn=None, script_name="SLURM_Run_Workflow.py", **kwargs
):
    """
    Trigger a specific OMERO script to run based on the provided script name and parameters.
    """
    try:
        # Parse the incoming request body for workflow and script details
        data = json.loads(request.body)
        workflow_name = data.get("workflow_name")
        if not workflow_name:
            return JsonResponse({"error": "workflow_name is required"}, status=400)
        params = data.get("params", {})

        # Apply BIOMERO's type conversion logic
        params = prepare_workflow_parameters(workflow_name, params)

        # Connect to OMERO Script Service
        svc = conn.getScriptService()

        # Find the workflow script by name
        scripts = svc.getScripts()
        script = None
        for s in scripts:
            if unwrap(s.getName()) == script_name:
                script = s
                break

        if not script:
            return JsonResponse(
                {"error": f"Script {script_name} not found on server"}, status=404
            )

        # Run the script with parameters
        script_id = int(unwrap(script.id))
        input_ids = params.get("IDs", [])
        data_type = params.get("Data_Type", "Image")
        out_email = params.get("receiveEmail")
        attach_og = params.get("attachToOriginalImages")
        import_zp = params.get("importAsZip")
        uploadcsv = params.get("uploadCsv")
        output_ds = params.get("selectedDatasets", [])
        rename_pt = params.get("renamePattern")
        version = params.get("version")

        # Convert provided params to OMERO rtypes using wrap
        known_params = [
            "Data_Type",
            "IDs",
            "receiveEmail",
            "importAsZip",
            "uploadCsv",
            "attachToOriginalImages",
            "selectedDatasets",
            "renamePattern",
            "workflow_name",
            "cytomine_host",
            "cytomine_id_project",
            "cytomine_id_software",
            "cytomine_private_key",
            "cytomine_public_key",
            "version",
        ]
        inputs = {
            f"{workflow_name}_|_{key}": wrap(value)
            for key, value in params.items()
            if key not in known_params
        }
        inputs.update(
            {
                workflow_name: rbool(True),
                f"{workflow_name}_Version": wrap(version),
                "IDs": wrap([rlong(i) for i in input_ids]),
                "Data_Type": wrap(data_type),
                "E-mail": rbool(out_email),
                "Select how to import your results (one or more)": rbool(True),
                "1) Zip attachment to parent": rbool(import_zp),
                "2) Attach to original images": rbool(attach_og),
                "3a) Import into NEW Dataset": (
                    wrap(output_ds[0]) if output_ds else wrap("--NO THANK YOU--")
                ),
                "3b) Allow duplicate dataset (name)?": rbool(False),
                "3c) Rename the imported images": (
                    wrap(rename_pt) if rename_pt else wrap("--NO THANK YOU--")
                ),
                "4) Upload result CSVs as OMERO tables": rbool(uploadcsv),
            }
        )
        logger.debug(inputs)

        try:
            # Use runScript to execute
            proc = svc.runScript(script_id, inputs, None)
            omero_job_id = proc.getJob()._id
            msg = f"Started script {script_id} at {datetime.datetime.now()} with OMERO Job ID {unwrap(omero_job_id)}"
            logger.info(msg)
            return JsonResponse(
                {
                    "status": "success",
                    "message": f"Script {script_name} for {workflow_name} started successfully: {msg}",
                }
            )

        except Exception as e:
            logger.error(
                f"Error executing script {script_name} for {workflow_name}: {str(e)}"
            )
            return JsonResponse(
                {
                    "error": f"Failed to execute script {script_name} for {workflow_name}: {str(e)} -- inputs: {inputs}"
                },
                status=500,
            )

    except json.JSONDecodeError:
        logger.error("Invalid JSON data")
        return JsonResponse({"error": "Invalid JSON data"}, status=400)
    except Exception as e:
        logger.error(f"Error processing request: {str(e)}")
        return JsonResponse(
            {
                "error": f"Failed to execute workflow for {workflow_name} {inputs}: {str(e)}"
            },
            status=500,
        )


@login_required()
@require_http_methods(["GET"])
def list_workflows(request, conn=None, **kwargs):
    """
    List available workflows using SlurmClient.
    """
    try:
        with SlurmClient.from_config(config_only=True) as sc:
            workflows = list(sc.slurm_model_images.keys())
        return JsonResponse({"workflows": workflows})
    except Exception as e:
        logger.error(f"Error listing workflows: {str(e)}")
        return JsonResponse({"error": str(e)}, status=500)


@login_required()
@require_http_methods(["GET"])
def get_workflow_metadata(request, conn=None, **kwargs):
    """
    Get metadata for a specific workflow.
    """
    # workflow_name = request.GET.get("workflow", None)
    workflow_name = kwargs.get("name")
    if not workflow_name:
        return JsonResponse({"error": "Workflow name is required"}, status=400)

    try:
        with SlurmClient.from_config(config_only=True) as sc:
            if workflow_name not in sc.slurm_model_images:
                return JsonResponse({"error": "Workflow not found"}, status=404)

            metadata = sc.pull_descriptor_from_github(workflow_name)
        return JsonResponse(metadata)
    except Exception as e:
        logger.error(f"Error fetching metadata for workflow {workflow_name}: {str(e)}")
        return JsonResponse({"error": str(e)}, status=500)


@login_required()
@require_http_methods(["GET"])
def get_workflow_github(request, conn=None, **kwargs):
    """
    Fetch the GitHub link for a specific workflow.
    """
    workflow_name = kwargs.get("name")
    if not workflow_name:
        return JsonResponse({"error": "Workflow name is required"}, status=400)

    try:
        with SlurmClient.from_config(config_only=True) as sc:
            if workflow_name not in sc.slurm_model_repos:
                return JsonResponse({"error": "Workflow not found"}, status=404)

            github = sc.slurm_model_repos[workflow_name]
        return JsonResponse({"url": github})
    except Exception as e:
        logger.error(
            f"Error fetching descriptor for workflow {workflow_name}: {str(e)}"
        )
        return JsonResponse({"error": str(e)}, status=500)


@login_required()
def get_script_menu(request, conn=None, **kwargs):
    script_ids = request.GET.get("script_ids", "").split(",")
    script_ids = [int(id) for id in script_ids if id.isdigit()]

    script_menu_data = []
    error_logs = []

    scriptService = conn.getScriptService()

    for script_id in script_ids:
        try:
            script = conn.getObject("OriginalFile", script_id)
            if script is None:
                error_logs.append(f"Script {script_id} not found")
                continue

            try:
                params = scriptService.getParams(script_id)
            except Exception as e:
                logger.warning(f"Exception for script {script_id}: {str(e)}")
                params = None

            if params is None:
                script_data = {
                    "id": script_id,
                    "name": script.name.replace("_", " "),
                    "description": "No description available",
                    "authors": "Unknown",
                    "version": "Unknown",
                }
            else:
                script_data = {
                    "id": script_id,
                    "name": params.name.replace("_", " "),
                    "description": unwrap(params.description)
                    or "No description available",
                    "authors": (
                        ", ".join(params.authors) if params.authors else "Unknown"
                    ),
                    "version": params.version or "Unknown",
                }

            script_menu_data.append(script_data)
        except Exception as ex:
            error_message = (
                f"Error fetching script details for script {script_id}: {str(ex)}"
            )
            logger.error(error_message)
            error_logs.append(error_message)

    return JsonResponse({"script_menu": script_menu_data, "error_logs": error_logs})


### Importer and other database pages ###

# Configure base directory to point to the mounted L-Drive
BASE_DIR = "/L-Drive"

logger.info("\n=== Directory Access Check ===")
logger.info(f"Checking directory structure and permissions:")
logger.info(f"L-Drive directory: {BASE_DIR}")
logger.info(f"   - Exists: {os.path.exists(BASE_DIR)}")
logger.info(
    f"   - Readable: {os.access(BASE_DIR, os.R_OK) if os.path.exists(BASE_DIR) else 'N/A'}"
)
logger.info(
    f"   - Executable: {os.access(BASE_DIR, os.X_OK) if os.path.exists(BASE_DIR) else 'N/A'}"
)


def ready():
    """
    Called when the app is ready. We initialize the IngestTracker using an environment variable.
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
            f"Unexpected error during IngestTracker initialization: {e}", exc__info=True
        )


logger.info("Setting up IngestTracker for imports")
ready()
logger.info("IngestTracker ready")


def check_directory_access(path):
    """Check if a directory exists and is accessible."""
    try:
        exists = os.path.exists(path)
        readable = os.access(path, os.R_OK) if exists else False
        executable = os.access(path, os.X_OK) if exists else False

        if not exists:
            return False, f"Directory does not exist: {path}"
        if not readable:
            return False, f"Directory is not readable: {path}"
        if not executable:
            return False, f"Directory is not executable (searchable): {path}"

        return True, "Directory is accessible"
    except Exception as e:
        return False, f"Error checking directory access: {str(e)}"


@login_required()
@render_response()
def omero_biomero_upload(request, conn=None, **kwargs):
    """Render the server-side browser page."""
    metabase_site_url = os.environ.get("METABASE_SITE_URL")
    metabase_secret_key = os.environ.get("METABASE_SECRET_KEY")
    metabase_dashboard_id = os.environ.get("METABASE_IMPORTS_DB_PAGE_DASHBOARD_ID")

    current_user = conn.getUser()
    username = current_user.getName()
    user_id = current_user.getId()
    is_admin = conn.isAdmin()

    payload = {
        "resource": {"dashboard": int(metabase_dashboard_id)},
        "params": {"user_name": [username]},
        "exp": round(time.time()) + (60 * 30),  # 30-minute expiration
    }
    token = jwt.encode(payload, metabase_secret_key, algorithm="HS256")

    context = {
        "template": "omero_biomero/webclient_plugins/react_app.html",  # Unified template
        "user_name": username,
        "user_id": user_id,
        "is_admin": is_admin,
        "metabase_site_url": metabase_site_url,
        "metabase_token": token,
        "app_name": "uploader",  # Pass different app name
        "main_js": get_react_build_file("main.js"),  # Unified JS key
        "main_css": get_react_build_file("main.css"),  # Unified CSS key
        "title": "Server Side Browser & Imports Database",
    }
    return context


@login_required()
@require_http_methods(["GET"])
def list_directory(request, conn=None, **kwargs):
    logger.info("\n=== list_directory called ===")
    logger.info(f"Request URL: {request.build_absolute_uri()}")
    logger.info(f"Request path: {request.path}")
    logger.info(f"Request GET params: {request.GET}")

    # Check access to L-Drive
    can_access, message = check_directory_access(BASE_DIR)
    if not can_access:
        logger.error(f"L-Drive access check failed: {message}")
        return JsonResponse({"error": message}, status=403)

    current_path = request.GET.get("path", "")
    abs_current_path = os.path.abspath(os.path.join(BASE_DIR, current_path))

    logger.info(f"Checking access to requested path: {abs_current_path}")
    can_access, message = check_directory_access(abs_current_path)
    if not can_access:
        logger.error(f"Target directory access check failed: {message}")
        return JsonResponse({"error": message}, status=403)

    if not abs_current_path.startswith(BASE_DIR):
        logger.warning(f"Access denied - path {abs_current_path} not within {BASE_DIR}")
        return JsonResponse(
            {"error": "Access denied - path outside of allowed directory"}, status=403
        )

    try:
        items = os.listdir(abs_current_path)
        logger.info(f"Successfully listed directory: {abs_current_path}")
        logger.info(f"Found {len(items)} items")

        dirs = []
        files = []
        for item in items:
            item_path = os.path.join(abs_current_path, item)
            rel_item_path = os.path.relpath(item_path, BASE_DIR)
            if os.path.isdir(item_path):
                dirs.append({"name": item, "path": rel_item_path})
            else:
                files.append({"name": item, "path": rel_item_path})

        return JsonResponse(
            {"current_path": current_path, "dirs": dirs, "files": files}
        )
    except OSError as e:
        logger.error(f"Failed to list directory {abs_current_path}: {str(e)}")
        return JsonResponse({"error": str(e)}, status=500)


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
            return JsonResponse({"error": "No destinations selected"}, status=400)
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
        process_files(selected_items, selected_destinations, selected_group, username)

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


def process_files(selected_items, selected_destinations, group, username):
    """
    Process the selected files and destinations to create upload orders with appropriate preprocessing.
    """
    files_by_preprocessing = defaultdict(list)  # Group files by preprocessing config
    # Path to root folder from settings
    base_dir = os.getenv("IMPORT_MOUNT_PATH", "/L-Drive")

    for item in selected_items:
        # Handle both old string format and new object format for backward compatibility
        if isinstance(item, dict):
            # New format with localPath and uuid
            local_path = item.get("localPath")
            subfile_uuid = item.get("uuid")
        else:
            # Old format - just a string path
            local_path = item
            subfile_uuid = None

        abs_path = os.path.abspath(os.path.join(base_dir, local_path))

        logger.info(
            f"Importing: {abs_path} to {selected_destinations} (UUID: {subfile_uuid})"
        )

        for sample_parent_type, sample_parent_id in selected_destinations:
            if sample_parent_type in ("screens", "Screen"):
                sample_parent_type = "Screen"
                if local_path.endswith(".db"):
                    preprocessing_key = "screen_db"
                else:
                    preprocessing_key = "screen_no_preprocessing"
            elif sample_parent_type in ("datasets", "Dataset"):
                sample_parent_type = "Dataset"

                # Check if this is a Leica file with UUID (sub-image selection)
                if subfile_uuid and any(
                    ext in local_path.lower()
                    for ext in EXTENSIONS_REQUIRING_PREPROCESSING
                ):
                    preprocessing_key = "dataset_leica_uuid"
                else:
                    preprocessing_key = "dataset_no_preprocessing"
            else:
                raise ValueError(
                    f"Unknown type {sample_parent_type} for id {sample_parent_id}"
                )

            # Group files by preprocessing key, including UUID info
            file_info = {"path": abs_path, "uuid": subfile_uuid, "original_item": item}
            files_by_preprocessing[
                (sample_parent_type, sample_parent_id, preprocessing_key)
            ].append(file_info)

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

        # Apply preprocessing based on key
        if preprocessing_key == "screen_db":
            order_info["preprocessing_container"] = (
                "cellularimagingcf/cimagexpresstoometiff:v0.7"
            )
            order_info["preprocessing_inputfile"] = "{Files}"
            order_info["preprocessing_outputfolder"] = "/data"
            order_info["preprocessing_altoutputfolder"] = "/out"
            order_info["extra_params"] = {"saveoption": "single"}

        elif preprocessing_key == "dataset_leica_uuid":
            # New Leica UUID preprocessing
            order_info["preprocessing_container"] = (
                "cellularimagingcf/convertleica-docker:v1.2.0"
            )
            order_info["preprocessing_inputfile"] = "{Files}"
            order_info["preprocessing_outputfolder"] = "/data"
            order_info["preprocessing_altoutputfolder"] = "/out"

            # Handle multiple files with UUIDs
            if len(file_infos) == 1 and file_infos[0]["uuid"]:
                # Single file with UUID
                order_info["extra_params"] = {"image_uuid": file_infos[0]["uuid"]}
            else:
                # Multiple files or mixed UUID/non-UUID files
                # Create separate orders for each UUID file
                uuid_files = [f for f in file_infos if f["uuid"]]
                if uuid_files:
                    # Process UUID files separately
                    for file_info in uuid_files:
                        single_order_info = order_info.copy()
                        single_order_info["Files"] = [file_info["path"]]
                        single_order_info["UUID"] = str(uuid.uuid4())
                        single_order_info["extra_params"] = {
                            "image_uuid": file_info["uuid"]
                        }
                        create_upload_order(single_order_info)

                    # Process non-UUID files together (if any)
                    non_uuid_files = [f["path"] for f in file_infos if not f["uuid"]]
                    if non_uuid_files:
                        order_info["Files"] = non_uuid_files
                        # order_info["extra_params"] = {"saveoption": ""}
                        create_upload_order(order_info)
                    return  # Skip the normal create_upload_order call below

        # elif preprocessing_key == "dataset_custom_preprocessing":
        #     order_info["preprocessing_container"] = "some-other-container"
        #     order_info["preprocessing_inputfile"] = "{Files}"
        #     order_info["preprocessing_outputfolder"] = "/custom-output-folder"
        #     order_info["preprocessing_altoutputfolder"] = "/custom-alt-output"
        #     order_info["extra_params"] = {"custom_param": "value"}

        # No preprocessing for other cases
        create_upload_order(order_info)


@login_required()
@render_response()
def biomero(request, conn=None, **kwargs):
    metabase_site_url = os.environ.get("METABASE_SITE_URL")
    metabase_secret_key = os.environ.get("METABASE_SECRET_KEY")
    metabase_dashboard_id_monitor_workflows = os.environ.get(
        "METABASE_WORKFLOWS_DB_PAGE_DASHBOARD_ID"
    )
    metabase_dashboard_id_imports = os.environ.get(
        "METABASE_IMPORTS_DB_PAGE_DASHBOARD_ID"
    )

    # Gracefully parse ADI_ENABLED with multiple format support
    adi_enabled = parse_bool_env(os.environ.get("ADI_ENABLED"), default=True)
    analyze_enabled = parse_bool_env(os.environ.get("ANALYZE_ENABLED"), default=True)

    current_user = conn.getUser()
    username = current_user.getName()
    user_id = current_user.getId()
    is_admin = conn.isAdmin()

    payload_monitor_workflows = {
        "resource": {"dashboard": int(metabase_dashboard_id_monitor_workflows)},
        "params": {"user": [user_id]},
        "exp": round(time.time()) + (60 * 30),
    }
    token_monitor_workflows = jwt.encode(
        payload_monitor_workflows, metabase_secret_key, algorithm="HS256"
    )

    payload_imports = {
        "resource": {"dashboard": int(metabase_dashboard_id_imports)},
        "params": {"user_name": [username]},
        "exp": round(time.time()) + (60 * 30),
    }
    token_imports = jwt.encode(payload_imports, metabase_secret_key, algorithm="HS256")

    context = {
        "metabase_site_url": metabase_site_url,
        "metabase_token_monitor_workflows": token_monitor_workflows,
        "metabase_token_imports": token_imports,
        "template": "omero_biomero/webclient_plugins/react_app.html",
        "user_name": username,
        "user_id": user_id,
        "is_admin": is_admin,
        "main_js": get_react_build_file("main.js"),
        "main_css": get_react_build_file("main.css"),
        "title": "Biomero",
        "app_name": "biomero",
        "adi_enabled": adi_enabled,
        "analyze_enabled": analyze_enabled,
    }
    return context


@login_required()
@render_response()
@require_http_methods(["GET"])
def get_folder_contents(request, conn=None, **kwargs):
    """
    Handles the GET request to retrieve folder contents.
    """
    base_dir = os.getenv("IMPORT_MOUNT_PATH", DEFAULT_MOUNT_PATH)

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

    # Determine the target path based on item_path or default to the root folder
    target_path = base_dir if item_path is None else os.path.join(base_dir, item_path)
    logger.info(f"Target folder: {target_path}")

    # Validate if the path exists
    if not os.path.exists(target_path):
        return HttpResponseBadRequest("Invalid folder ID or path does not exist.")

    # Get the contents of the folder/file
    contents = []
    clicked_item_metadata = None
    logger.info(f"Item path: {target_path}, Item UUID: {item_uuid}")

    # Check if path is a file or folder
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
            return HttpResponseBadRequest("Invalid folder ID or path does not exist.")

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
        # If there is a file with extension in EXTENSIONS_WITH_INVISIBLE_ACCOMPANYING_FILES, hide the accompanying files
        primary_items = []
        for item in items:
            if item in EXTENSIONS_WITH_INVISIBLE_ACCOMPANYING_FILES:
                primary_items.append(item)

        if primary_items:
            # There can be only one key item, return error if there are multiple
            if len(primary_items) > 1:
                ext_list = ", ".join(EXTENSIONS_WITH_INVISIBLE_ACCOMPANYING_FILES)
                return HttpResponseBadRequest(
                    f"There can be only one file with extension [{ext_list}] in the folder '{target_path}'"
                )

            contents.append(
                {
                    "name": primary_items[0],
                    "is_folder": False,
                    "id": os.path.relpath(primary_items[0], base_dir),
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
                ) and ext not in EXTENSIONS_NON_BROWSABLE

                metadata = None
                if ext in EXTENSION_TO_FILE_BROWSER:
                    metadata = EXTENSION_TO_FILE_BROWSER[ext](item_path)

                contents.append(
                    {
                        "name": item,
                        "is_folder": is_folder,
                        "id": os.path.relpath(item_path, base_dir),
                        "info": info,
                        "metadata": metadata,
                        "source": "filesystem",
                    }
                )

    # Sort the contents by name, folders first
    contents.sort(key=lambda x: (not x["is_folder"], x["name"].lower()))

    return {"contents": contents, "item_id": item_id, "metadata": clicked_item_metadata}


@login_required()
@require_http_methods(["GET", "POST"])
def group_mappings(request, conn=None, **kwargs):
    """Handle group mappings GET and POST requests."""
    try:
        if request.method == "GET":
            # Read mappings from file if it exists
            if os.path.exists(MAPPINGS_FILE):
                with open(MAPPINGS_FILE, "r") as f:
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
                with open(MAPPINGS_FILE, "w") as f:
                    json.dump(mappings, f, indent=2)

                logger.info(f"Group mappings updated by {username} (ID: {user_id})")
                return JsonResponse({"message": "Mappings saved successfully"})

            except json.JSONDecodeError:
                return JsonResponse({"error": "Invalid JSON data"}, status=400)

    except Exception as e:
        logger.error(f"Error handling group mappings: {str(e)}")
        return JsonResponse({"error": str(e)}, status=500)
