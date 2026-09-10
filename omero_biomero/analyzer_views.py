import datetime
import json
import logging
import os
import re
from django.core.cache import cache


from biomero import SlurmClient
from biomero.constants import workflow_batched, workflow, transfer
import biomero.constants as constants
from django.http import JsonResponse
from django.views.decorators.http import require_http_methods
from omeroweb.webclient.decorators import login_required
from omero.rtypes import unwrap, rbool, wrap, rlong, rlist
import omero.model

from .utils import parse_bool_env

logger = logging.getLogger(__name__)

def get_roi_script_capability(script_service, scripts=None):
    """Ask OMERO whether the optional Labels2Rois script is installed."""
    scripts = scripts if scripts is not None else script_service.getScripts()
    matches = [script for script in scripts
               if unwrap(script.getName()) == constants.LABELS_TO_ROIS_SCRIPT]
    if not matches:
        return {
            "available": False,
            "reason": "The Labels2Rois utility script is not installed.",
        }

    return {
        "available": True,
        "reason": None,
    }


@login_required()
@require_http_methods(["POST"])
def run_workflow_script(request, conn=None, **kwargs):
    """
    Trigger a specific OMERO script to run based on the provided script name and parameters.
    """
    try:
        # Parse the incoming request body for workflow and script details
        data = json.loads(request.body)
        # Prefer workflow name from URL (new API), fallback to body (old API)
        workflow_name = kwargs.get("name") or data.get("workflow_name")
        if not workflow_name:
            return JsonResponse({"error": "workflow_name is required"}, status=400)
        params = data.get("params", {})
        launch_warnings = []
        execution_mode = (
            "detached"
            if parse_bool_env(
                os.environ.get(
                    constants.slurm_env.BIOMERO_DETACHED_WORKFLOWS
                ),
                default=False,
            )
            else "inline"
        )
        if (
            params.get("importPlateLabelPreview", False)
            and not parse_bool_env(
                os.environ.get("BIOMERO_SHALLOW_ZARR"), default=False
            )
        ):
            return JsonResponse({
                "error": (
                    "Plate mask preview requires BIOMERO_SHALLOW_ZARR=true"
                )
            }, status=400)
        
        # Determine which script to use based on batch processing settings
        batch_enabled = params.get("batchEnabled", False)
        script_name = constants.RUN_WF_BATCHED_SCRIPT if batch_enabled else constants.RUN_WF_SCRIPT
        
        # Extract and use the active group ID if provided from the frontend
        active_group_id = params.pop("active_group_id", None)
        
        # Get the current user's username and available groups for debugging
        current_user = conn.getUser()
        username = current_user.getName()
        
        # Use group switching approach similar to BIOMERO.importer
        if active_group_id is not None:
            logger.info(
                f"Switching to group {active_group_id} for user {username} "
                f"in workflow {workflow_name}"
            )
            
            # Use the same approach as BIOMERO.importer: switch to group
            # This ensures OMERO script runs with correct group permissions
            try:
                # First, try to set the group directly if the user has access
                conn.setGroupForSession(active_group_id)
                
                # Verify the group switch was successful
                current_group = conn.getEventContext().groupId
                if current_group != active_group_id:
                    logger.warning(
                        f"Group switch may not have taken effect. "
                        f"Expected: {active_group_id}, Current: {current_group}"
                    )
                else:
                    logger.info(
                        f"Successfully switched to group {active_group_id} "
                        f"for workflow {workflow_name}"
                    )
                
            except Exception as group_error:
                logger.error(
                    f"Failed to switch to group {active_group_id}: "
                    f"{group_error}"
                )
                return JsonResponse({
                    "error": f"Cannot access group {active_group_id}. "
                             "Check group permissions."
                }, status=403)
        else:
            # Log when no group is specified (uses default)
            current_group = conn.getEventContext().groupId
            logger.info(
                f"No group specified for workflow {workflow_name}, "
                f"using current group {current_group}"
            )

        # Apply BIOMERO's type conversion logic
        params = prepare_workflow_parameters(workflow_name, params)

        # Verify group context before running script
        current_context = conn.getEventContext()
        current_group_id = current_context.groupId
        current_user_id = current_context.userId
        
        logger.info(
            f"BIOMERO GROUP DEBUG: About to run script {script_name} "
            f"for workflow {workflow_name} "
            f"with user {current_user_id} in group {current_group_id}. "
            f"Originally requested group: {active_group_id}"
        )
        
        if active_group_id and current_group_id != active_group_id:
            logger.error(
                f"Group context mismatch! Expected: {active_group_id}, "
                f"Actual: {current_group_id}"
            )
            return JsonResponse({
                "error": f"Group context failed to switch to "
                         f"{active_group_id}. "
                         f"Currently in group {current_group_id}."
            }, status=500)

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
        output_sc = params.get("selectedScreens", [])
        output_ds_id = params.get("selectedDatasetId")  # OMERO ID (int or None)
        output_sc_id = params.get("selectedScreenId")   # OMERO ID (int or None)
        import_plate_label_preview = bool(
            params.get("importPlateLabelPreview", False))
        plate_label_preview_name = str(
            params.get("plateLabelPreviewName", "") or "").strip()
        rename_enabled = params.get("enableRename", False)
        rename_pt = params.get("renamePattern", "")
        version = params.get("version")
        attach_file_outputs = params.get("attachFileOutputs", False)
        file_output_target = params.get("fileOutputTarget")
        if file_output_target is None:
            # Cached/older clients did not send a target mode. Preserve the
            # historic input Dataset/Plate behavior for those submissions.
            file_output_target = constants.file_output_targets.INPUT_CONTAINER
        if file_output_target not in constants.file_output_targets.USER_VALUES:
            return JsonResponse({
                "error": "Invalid file annotation destination"
            }, status=400)
        create_rois = bool(params.get("createRois", False))
        delete_label_images_after_rois = bool(
            params.get("deleteLabelImagesAfterRois", False))
        clear_existing_rois = bool(params.get("clearExistingRois", False))
        clear_roi_filter = str(params.get("clearRoiFilter", "") or "").strip()
        roi_label_pattern = str(params.get("roiLabelPattern", "") or "").strip()
        roi_shape = str(params.get("roiShape", "Polygon") or "Polygon")
        roi_color = str(params.get("roiColor", "") or "").strip().upper()
        # EXPERIMENTAL: ZARR format support
        use_zarr = params.get("useZarrFormat", False)
        # Always default to 0.4 so omero-cli-zarr doesn't fall back to 0.5 (Zarr v3)
        ome_zarr_version = params.get("omeZarrVersion", transfer.OME_ZARR_VERSION_0_4)
        # Batch processing parameters
        batch_enabled = params.get("batchEnabled", False)
        batch_count = params.get("batchCount", 1)
        batch_size = params.get("batchSize", len(input_ids) if input_ids else 1)

        # This optional view is meaningful only for a Plate result imported to
        # a Screen. SLURM_Run_Workflow applies the importer/shallow feature
        # gates as the final authority; normalize the UI contract here too.
        import_plate_label_preview = bool(
            import_plate_label_preview
            and data_type == transfer.DATA_TYPE_PLATE
            and (output_sc or output_sc_id)
        )
        if not import_plate_label_preview:
            plate_label_preview_name = ""

        if create_rois and data_type == transfer.DATA_TYPE_PLATE:
            create_rois = False
            launch_warnings.append({
                "code": "roi_plate_unsupported",
                "message": (
                    "ROI postprocessing for Plate workflows is not yet "
                    "supported; the Plate result will still be imported."
                ),
            })

        if create_rois:
            roi_capability = get_roi_script_capability(svc, scripts)
            if not roi_capability["available"]:
                create_rois = False
                launch_warnings.append({
                    "code": "roi_script_unavailable",
                    "message": (
                        "ROI postprocessing was requested but will be skipped: "
                        f"{roi_capability['reason']}"
                    ),
                })
            else:
                has_import_destination = bool(
                    output_ds or output_sc or output_ds_id or output_sc_id)
                if not has_import_destination:
                    return JsonResponse({
                        "error": (
                            "ROI creation requires importing result images "
                            "into a Dataset or Screen."
                        )
                    }, status=400)
                if roi_shape not in ("Polygon", "Mask"):
                    return JsonResponse({
                        "error": "ROI shape must be Polygon or Mask"
                    }, status=400)
                if roi_color and not re.fullmatch(r"#[0-9A-F]{6}", roi_color):
                    return JsonResponse({
                        "error": "ROI color must be empty or use #RRGGBB format"
                    }, status=400)
                # An empty selector requests conservative, best-effort
                # selection after imported results are matched to sources.
                # The frontend already uses its loaded descriptor to send "*"
                # when every image output is declared as a label. Do not fetch
                # descriptors again here: that adds an external GitHub request
                # to workflow submission and can exceed Gunicorn's timeout.

        delete_label_images_after_rois = (
            create_rois and delete_label_images_after_rois)
        clear_existing_rois = create_rois and clear_existing_rois
        if not clear_existing_rois:
            clear_roi_filter = ""

        # Convert provided params to OMERO rtypes using wrap
        known_params = [
            transfer.DATA_TYPE,
            transfer.IDS,
            "receiveEmail",
            "importAsZip",
            "uploadCsv",
            "attachToOriginalImages",
            "selectedDatasets",
            "selectedScreens",
            "selectedDatasetId",
            "selectedScreenId",
            "importPlateLabelPreview",
            "plateLabelPreviewName",
            "renamePattern",
            "enableRename",
            "workflow_name",
            "cytomine_host",
            "cytomine_id_project",
            "cytomine_id_software",
            "cytomine_private_key",
            "cytomine_public_key",
            "version",
            "useZarrFormat",  # EXPERIMENTAL: ZARR format support
            "omeZarrVersion",  # handled explicitly below
            "batchEnabled",   # Frontend flag (not sent to script)
            "batchCount",     # Frontend calculated (not sent to script)
            "batchSize",      # Converted to Batch_Size for script
            "attachFileOutputs",  # Converted to workflow.OUTPUT_ATTACH_FILE_OUTPUTS
            "fileOutputTarget",   # Converted to workflow target policy
            "createRois",         # Converted to workflow.OUTPUT_CREATE_ROIS
            "deleteLabelImagesAfterRois",  # Converted to workflow.ROI_DELETE_LABEL_IMAGES
            "clearExistingRois",      # Converted to workflow.ROI_CLEAR_EXISTING
            "clearRoiFilter",         # Converted to workflow.ROI_CLEAR_FILTER
            "roiLabelPattern",    # Converted to workflow.ROI_LABEL_PATTERN
            "roiShape",           # Converted to workflow.ROI_SHAPE
            "roiColor",           # Converted to workflow.ROI_COLOR
        ]
        # File-attachment params arrive as FILE_{param_id}: int annotation ID.
        # Must be rlong — wrap() would give rstring if the value is a string.
        inputs = {
            f"{workflow_name}_|_{key}": wrap(value)
            for key, value in params.items()
            if key not in known_params and not key.startswith("FILE_")
        }
        inputs.update({
            f"{workflow_name}_|_FILE_{key[5:]}": (
                rlist([rlong(int(v)) for v in value if v not in ('', None)])
                if isinstance(value, list)
                else rlong(int(value))
            )
            for key, value in params.items()
            if key.startswith("FILE_") and value not in (None, '', [])
        })
        inputs.update(
            {
                workflow_name: rbool(True),
                f"{workflow_name}_Version": wrap(version),
                transfer.IDS: wrap([rlong(i) for i in input_ids]),
                transfer.DATA_TYPE: wrap(data_type),
                workflow.EMAIL: rbool(out_email),
                workflow.USE_ZARR_FORMAT: rbool(use_zarr),  # EXPERIMENTAL
                transfer.OME_VERSION: wrap(ome_zarr_version),  # always explicit, default 0.4
                workflow_batched.BATCH_SIZE: wrap(batch_size) if batch_enabled else None,  # Only for batched script
                workflow.SELECT_IMPORT: rbool(True),
                workflow.OUTPUT_PARENT: rbool(import_zp),
                workflow.OUTPUT_ATTACH: rbool(attach_og),
                workflow.OUTPUT_NEW_DATASET: (
                    wrap(output_ds[0]) if output_ds else wrap(workflow.NO)
                ),
                workflow.OUTPUT_NEW_SCREEN: (
                    wrap(output_sc[0]) if output_sc else wrap(workflow.NO)
                ),
                constants.results.OUTPUT_ATTACH_NEW_DATASET_ID: (
                    rlong(int(output_ds_id)) if output_ds_id else None
                ),
                constants.results.OUTPUT_ATTACH_NEW_SCREEN_ID: (
                    rlong(int(output_sc_id)) if output_sc_id else None
                ),
                constants.results.IMPORT_PLATE_LABEL_PREVIEW: rbool(
                    import_plate_label_preview),
                constants.results.PLATE_LABEL_PREVIEW_NAME: wrap(
                    plate_label_preview_name),
                workflow.OUTPUT_DUPLICATES: rbool(False),
                workflow.OUTPUT_RENAME: (
                    wrap(rename_pt) if (rename_enabled and rename_pt) else wrap(workflow.NO)
                ),
                workflow.OUTPUT_CSV_TABLE: rbool(uploadcsv),
                workflow.OUTPUT_ATTACH_FILE_OUTPUTS: rbool(attach_file_outputs),
                workflow.OUTPUT_ATTACH_FILE_OUTPUTS_TARGET: wrap(
                    file_output_target),
                workflow.OUTPUT_CREATE_ROIS: rbool(create_rois),
                workflow.ROI_LABEL_PATTERN: wrap(roi_label_pattern),
                workflow.ROI_SHAPE: wrap(roi_shape),
                workflow.ROI_COLOR: wrap(roi_color),
            }
        )
        if delete_label_images_after_rois:
            inputs[workflow.ROI_DELETE_LABEL_IMAGES] = rbool(True)
        if clear_existing_rois:
            inputs[workflow.ROI_CLEAR_EXISTING] = rbool(True)
            inputs[workflow.ROI_CLEAR_FILTER] = wrap(clear_roi_filter)
        
        # Remove None values for non-batched workflows
        inputs = {k: v for k, v in inputs.items() if v is not None}
        logger.debug(inputs)

        try:
            # Use runScript to execute
            proc = svc.runScript(script_id, inputs, None)
            omero_job_id = proc.getJob()._id
            msg = f"Started script {script_id} at {datetime.datetime.now()} with OMERO Job ID {unwrap(omero_job_id)}"
            logger.info(msg)

            # Register with OMERO.web Activities panel so the script run
            # shows up in the user's Activities view (bell icon).
            # Mirrors the pattern used by omeroweb/webclient/views.py::run_script().
            # The key must be str(proc) — a "ProcessCallback/UUID:..." Ice proxy
            # string — so the activities() poller recognises it as a script job.
            if "callback" not in request.session:
                request.session["callback"] = {}
            job_id = str(proc)
            request.session["callback"][job_id] = {
                "job_type": "script",
                "job_name": workflow_name,
                "start_time": str(datetime.datetime.now()),
                "status": "in progress",
            }
            request.session.modified = True

            return JsonResponse(
                {
                    "status": "success",
                    "message": f"Script {script_name} for {workflow_name} started successfully: {msg}",
                    "jobId": job_id,
                    "executionMode": execution_mode,
                    "warnings": launch_warnings,
                    "effectiveOptions": {
                        "createRois": create_rois,
                        "deleteLabelImagesAfterRois":
                            delete_label_images_after_rois,
                        "clearExistingRois": clear_existing_rois,
                        "clearRoiFilter": clear_roi_filter,
                        "importPlateLabelPreview":
                            import_plate_label_preview,
                        "plateLabelPreviewName": plate_label_preview_name,
                    },
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
    """GET /api/analyzer/workflows/ → {"workflows": [name, ...]}"""
    try:
        with SlurmClient.from_config(config_only=True) as sc:
            workflows = list(sc.slurm_model_images.keys())
        return JsonResponse({"workflows": workflows})
    except Exception as e:
        logger.error(f"Error listing workflows: {str(e)}")
        return JsonResponse({"error": str(e)}, status=500)


def _is_versioned_url(url_or_name: str) -> bool:
    """Return True when the identifier points at a pinned GitHub tree ref."""
    return bool(url_or_name and "/tree/v" in str(url_or_name))


@login_required()
@require_http_methods(["GET"])
def get_workflow_metadata(request, conn=None, **kwargs):
    """
    GET /api/analyzer/workflows/<name>/   → descriptor for a configured workflow.
    GET /api/analyzer/workflows/?repo=URL → descriptor fetched directly from GitHub.

    Returns the biomero-schema descriptor dict enriched with ``githubUrl``.

    Caching strategy:
    - Versioned URLs (/tree/vX.Y.Z) are immutable → 24-hour Django cache TTL.
    - Unversioned / name-only lookups         → 1-hour Django cache TTL.
    - A separate ``*:stale`` key is stored indefinitely so that when GitHub
      returns a rate-limit error (429) the last known good data is served
      instead of a hard error.
    """
    workflow_name = kwargs.get("name")
    repo_url = request.GET.get("repo", "").strip()

    if not workflow_name and not repo_url:
        return JsonResponse(
            {"error": "Workflow name (URL segment) or ?repo= parameter required"},
            status=400,
        )

    identifier = repo_url or workflow_name
    cache_key = f"workflow_metadata:{identifier}"
    stale_key = f"{cache_key}:stale"
    no_cache = "no-cache" in request.headers.get("Cache-Control", "")

    cached = None if no_cache else cache.get(cache_key)
    if cached is not None:
        response = JsonResponse(cached)
        response["X-Cache"] = "HIT"
        return response

    try:
        with SlurmClient.from_config(config_only=True) as sc:
            if repo_url:
                metadata = sc.generic_descriptor_from_github(repo_url)
                enriched = {**metadata, "githubUrl": repo_url}
            else:
                if workflow_name not in sc.slurm_model_images:
                    return JsonResponse(
                        {"error": "Workflow not found"}, status=404
                    )
                metadata = sc.generic_descriptor_from_github(workflow_name)
                github_url = sc.slurm_model_repos.get(workflow_name)
                enriched = {**metadata, "name": workflow_name, "githubUrl": github_url}

        # Versioned URLs are immutable — cache aggressively.
        ttl = 86400 if _is_versioned_url(identifier) else 3600
        cache.set(cache_key, enriched, ttl)
        # Always refresh the stale fallback with no expiry so it survives future 429s.
        cache.set(stale_key, enriched, None)
        response = JsonResponse(enriched)
        response["X-Cache"] = "MISS"
        return response
    except Exception as e:
        # On GitHub rate-limit (or any transient error) try to serve stale data.
        stale = cache.get(stale_key)
        if stale is not None:
            logger.warning(
                f"GitHub error for {identifier!r} — serving stale cache: {e}"
            )
            response = JsonResponse(stale)
            response["X-Cache"] = "STALE"
            return response
        logger.error(
            f"Error fetching metadata for workflow {workflow_name or repo_url}: {str(e)}"
        )
        return JsonResponse({"error": str(e)}, status=500)


@login_required()
def get_workflows(request, conn=None, **kwargs):
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

            # Try to get script parameters with retry logic
            params = None
            for attempt in range(3):  # Try up to 3 times
                try:
                    params = scriptService.getParams(script_id)
                    if params is not None:
                        break  # Success, exit retry loop
                except Exception as e:
                    error_msg = str(e)
                    if attempt == 2:  # Last attempt
                        # Check if this is a SLURM connection error
                        if "Can't find params" in error_msg:
                            logger.warning(f"Script {script_id} ({script.name}) requires SLURM cluster connection which is unavailable")
                            # Create informative fallback data for SLURM scripts
                            params = type('MockParams', (), {
                                'name': script.name.replace('_', ' '),
                                'description': 'SLURM cluster connection required but unavailable. Please ensure the SLURM cluster is running and accessible.',
                                'authors': ['BIOMERO'],
                                'version': 'Unknown (SLURM offline)'
                            })()
                        else:
                            logger.error(f"Failed to get params for script {script_id} ({script.name}) after 3 attempts: {error_msg}")
                    else:
                        logger.warning(f"Attempt {attempt + 1} failed for script {script_id}: {error_msg}, retrying...")
                        # Brief pause before retry
                        import time
                        time.sleep(0.1)

            if params is None:
                script_data = {
                    "id": script_id,
                    "name": script.name.replace("_", " "),
                    "description": "No description available",
                    "authors": "Unknown",
                    "version": "Unknown",
                }
            else:
                logger.info(f"Fetched params for script {script_id}: {params}")
                script_data = {
                    "id": script_id,
                    "name": params.name.replace("_", " "),
                    "description": unwrap(params.description)
                    or "No description available",
                    "authors": (
                        ", ".join(params.authors)
                        if params.authors
                        else "Unknown"
                    ),
                    "version": params.version or "Unknown",
                }

            script_menu_data.append(script_data)
        except Exception as ex:
            error_message = (
                f"Error fetching script details for script {script_id}:"
                f" {str(ex)}"
            )
            logger.error(error_message)
            error_logs.append(error_message)

    return JsonResponse({
        "script_menu": script_menu_data,
        "error_logs": error_logs,
    })


def prepare_workflow_parameters(workflow_name, params):
    """
    Coerce numeric workflow params to the correct Python type before wrap().

    Blueprint's NumericInput can store a mid-edit string (e.g. "0.", "1.0")
    in formData; wrap() would produce the wrong OMERO rtype for those.
    int(float(val)) handles "1.0" -> 1 since int("1.0") raises ValueError.
    """
    try:
        # Get the workflow descriptor using SlurmClient
        with SlurmClient.from_config(config_only=True) as sc:
            if workflow_name not in sc.slurm_model_images:
                logger.warning(
                    f"Workflow {workflow_name} not found in BIOMERO config"
                )
                return params

            metadata = sc.generic_descriptor_from_github(workflow_name)
    except Exception as e:
        logger.warning(
            f"Could not fetch workflow metadata for {workflow_name}: {e}"
        )
        return params

    # File-attachment types must be routed as OMERO FileAnnotation IDs (rlong),
    # not wrapped as generic values. Rename them to FILE_{key} so the
    # inputs-construction block below picks them up via the rlong path.
    _FILE_ATTACHMENT_TYPES = ('file', 'array', 'measurement', 'executable')

    # Coerce each param to the type declared in the descriptor
    inputs_spec = metadata.get("inputs", [])
    coerced = dict(params)
    keys_to_rename = {}  # file-attachment params: old_key -> FILE_{old_key}
    for inp in inputs_spec:
        key = inp.get("id")
        type_ = inp.get("type", "")
        if key not in coerced:
            continue
        val = coerced[key]
        # File-attachment params: mark for renaming; skip numeric coercion
        if type_ in _FILE_ATTACHMENT_TYPES:
            keys_to_rename[key] = f"FILE_{key}"
            continue
        try:
            if type_ in ("integer", "Integer"):
                coerced[key] = int(float(val))  # handle "1.0" -> 1
            elif type_ in ("float", "Float"):
                coerced[key] = float(val)
            elif type_ in ("Number", "number"):
                # Use the default-value's Python type to decide int vs float
                default_val = inp.get("default-value")
                if isinstance(default_val, float):
                    coerced[key] = float(val)
                else:
                    coerced[key] = int(float(val))
        except (ValueError, TypeError) as coerce_err:
            logger.warning(
                f"Could not coerce param {key}={val!r} to {type_}: {coerce_err}"
            )
        else:
            logger.info(f"Converted {key}: {val!r} -> {coerced[key]!r} ({type_})")
    # Apply file-attachment renames so downstream routing uses FILE_ prefix
    for old_key, new_key in keys_to_rename.items():
        coerced[new_key] = coerced.pop(old_key)
        logger.info(f"Routing file-attachment param {old_key!r} -> {new_key!r} (will be sent as rlong IDs)")
    return coerced


@login_required()
def get_slurm_status(request, conn=None, **kwargs):
    """
    Check SLURM cluster availability and get workflow version information.
    """
    import logging
    logger = logging.getLogger(__name__)
    
    # Use the main workflow script name - same approach as run_workflow_script
    script_name = constants.RUN_WF_SCRIPT  # Contains all workflow version info
    
    logger.info(f"Starting SLURM status check for script: {script_name}")
    roi_capability = {
        "available": False,
        "reason": "ROI capability could not be checked.",
    }
    
    try:
        scriptService = conn.getScriptService()
        
        # Find the script by name (same approach as run_workflow_script)
        scripts = scriptService.getScripts()
        roi_capability = get_roi_script_capability(scriptService, scripts)
        script = None
        for s in scripts:
            if unwrap(s.getName()) == script_name:
                script = s
                break

        if not script:
            error_msg = f"SLURM script '{script_name}' not found on server"
            logger.error(error_msg)
            return JsonResponse({
                "status": "offline",
                "message": error_msg,
                "last_checked": datetime.datetime.now().isoformat(),
                "icon": "error",
                "intent": "danger",
                "workflow_versions": {},
                "capabilities": {"roi_postprocessing": roi_capability},
            })
        
        # Get the script ID and fetch params
        script_id = int(unwrap(script.id))
        logger.info(f"Found script with ID: {script_id}")
        
        params = scriptService.getParams(script_id)
        logger.info(f"Retrieved script parameters successfully")
        logger.info(f"Retrieved script parameters")
        
        # Extract workflow versions from params
        workflow_versions = {}
        
        # Parse the params inputs to find workflow versions
        if hasattr(params, 'inputs') and params.inputs:
            for key, param in params.inputs.items():
                # Look for version parameters (e.g., "stardist_Version", "cellpose_Version")
                if key.endswith('_Version') and hasattr(param, 'values') and param.values:
                    # Extract workflow name (remove "_Version" suffix)
                    workflow_name = key.replace('_Version', '')
                    
                    # Extract available versions from the values list
                    versions = []
                    if hasattr(param.values, '_val'):
                        for version_obj in param.values._val:
                            if hasattr(version_obj, '_val'):
                                versions.append(version_obj._val)
                    
                    if versions:
                        workflow_versions[workflow_name] = {
                            'available_versions': versions,
                            'latest_version': versions[0] if versions else None  # Assume first is latest
                        }
        
        # Count workflow statuses for better messaging
        total_workflows = len(workflow_versions)
        ready_workflows = sum(1 for versions in workflow_versions.values() 
                            if versions['latest_version'] and versions['latest_version'].strip())
        unavailable_workflows = total_workflows - ready_workflows
        
        if unavailable_workflows == 0:
            status_message = f"SLURM cluster is available. {ready_workflows} workflows ready."
        else:
            status_message = f"SLURM cluster is available. {ready_workflows} ready, {unavailable_workflows} unavailable."
        
        status = {
            "status": "online",
            "message": status_message,
            "last_checked": datetime.datetime.now().isoformat(),
            "icon": "tick-circle",
            "intent": "success",
            "workflow_versions": workflow_versions,
            "capabilities": {"roi_postprocessing": roi_capability},
        }
        
        logger.info(f"SLURM status check successful. Status: {status['status']}, Workflows: {total_workflows}")
        
    except Exception as e:
        error_msg = str(e)
        logger.error(f"SLURM status check failed: {error_msg}", exc_info=True)
        if "NoValidConnectionsError" in error_msg or "Connection refused" in error_msg or "timed out" in error_msg.lower():
            status = {
                "status": "offline",
                "message": "SLURM cluster is offline or unreachable",
                "last_checked": datetime.datetime.now().isoformat(),
                "icon": "error",
                "intent": "danger",
                "workflow_versions": {}
            }
        elif "Can't find params" in error_msg or "ValidationException" in error_msg:
            # Script crashed on load — SLURM may be fine but the script has an error
            status = {
                "status": "unknown",
                "message": "Run-workflow script failed to load — check script logs for details",
                "last_checked": datetime.datetime.now().isoformat(),
                "icon": "warning-sign",
                "intent": "warning",
                "workflow_versions": {}
            }
        else:
            status = {
                "status": "unknown",
                "message": f"SLURM status check failed: {error_msg}",
                "last_checked": datetime.datetime.now().isoformat(),
                "icon": "warning-sign",
                "intent": "warning",
                "workflow_versions": {}
            }
    
    status.setdefault(
        "capabilities", {"roi_postprocessing": roi_capability})
    return JsonResponse(status)


@login_required()
@require_http_methods(["GET"])
def get_attachments(request, conn=None, **kwargs):
    """
    Return OMERO file annotations (attachments) accessible to the current user.

    Query params:
        format   (repeatable) — filter by file extension, e.g. ?format=csv&format=parquet
        search   — substring match on file name (case-insensitive)
        group    — OMERO group ID to query in; defaults to the user's active group

    Response shape:
        {
            "attachments": [
                {
                    "id": 42,
                    "name": "measurements.csv",
                    "size": 1234,
                    "mimetype": "text/csv",
                    "extension": "csv",
                    "parents": [
                        {"type": "Image", "id": 7, "name": "my_image.tif"}
                    ]
                },
                ...
            ]
        }
    """
    formats = [f.lower() for f in request.GET.getlist("format") if f]
    search = (request.GET.get("search") or "").strip().lower()
    group_id = request.GET.get("group")

    try:
        if group_id is not None:
            try:
                conn.setGroupForSession(int(group_id))
            except Exception as e:
                logger.warning(f"get_attachments: could not switch to group {group_id}: {e}")

        # listFileAnnotations() uses loadSpecifiedAnnotations which:
        # - loads OriginalFile objects (so getName/getSize work without lazy loading)
        # - excludes companion files and original metadata by default
        # - respects the current group session set above
        filtered = []
        for ann in conn.listFileAnnotations():
            orig_file = ann.getFile()
            if orig_file is None:
                continue

            name = orig_file.getName() or ""
            ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""

            if formats and ext not in formats:
                continue
            if search and search not in name.lower():
                continue

            filtered.append(ann)

        if not filtered:
            return JsonResponse({"attachments": []})

        # Bulk-fetch parent links using conn.getAnnotationLinks() — the built-in
        # omero-py gateway method that properly passes SERVICE_OPTS (including group
        # context) and wraps IDs as rlong. One call per object type.
        ann_ids = [ann.getId() for ann in filtered]
        parent_map = {}   # ann_id -> [{"type": ..., "id": ..., "name": ...}]
        linked_by_map = {}  # ann_id -> full name of the person who created the first link found

        for obj_type in ("Image", "Dataset", "Project", "Plate", "Screen"):
            try:
                for link in conn.getAnnotationLinks(obj_type, ann_ids=ann_ids):
                    child = link.getChild()
                    parent = link.getParent()
                    if child is None or parent is None:
                        continue
                    cid = child.getId()
                    parent_map.setdefault(cid, []).append({
                        "type": obj_type,
                        "id": parent.getId(),
                        "name": parent.getName() or "",
                    })
                    if cid not in linked_by_map:
                        lowner = link.getOwner()
                        linked_by_map[cid] = lowner.getFullName() if lowner else None
            except Exception:
                pass  # object type may not expose annotation links

        attachments = []
        for ann in filtered:
            orig_file = ann.getFile()
            name = orig_file.getName() or ""
            ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
            ann_id = ann.getId()
            ann_date = ann.getDate()
            ann_owner = ann.getOwner()
            attachments.append({
                "id": ann_id,
                "file_id": orig_file.getId(),
                "name": name,
                "size": orig_file.getSize(),
                "mimetype": orig_file.getMimetype() or "",
                "extension": ext,
                "ns": ann.getNs() or "",
                "description": ann.getDescription() or "",
                "date": ann_date.isoformat() if ann_date else None,
                "owner": ann_owner.getFullName() if ann_owner else None,
                "linked_by": linked_by_map.get(ann_id),
                "parents": parent_map.get(ann_id, []),
            })

        return JsonResponse({"attachments": attachments})

    except Exception as e:
        logger.exception("get_attachments failed")
        return JsonResponse({"error": str(e)}, status=500)


@login_required()
@require_http_methods(["GET"])
def get_object_annotations(request, conn=None, **kwargs):
    """
    Return file annotations attached to a specific OMERO object.
    Used by the "By Parent" tree browser to lazily load annotations per node.

    Query params:
        object_type  — one of: Project, Dataset, Image, Plate, Screen
        object_id    — integer ID of the object

    Response shape:
        {"annotations": [{"id", "name", "size", "mimetype", "extension"}, ...]}
    """
    ALLOWED_TYPES = {"Project", "Dataset", "Image", "Plate", "Screen"}

    object_type = (request.GET.get("object_type") or "").strip()
    if object_type not in ALLOWED_TYPES:
        return JsonResponse({"error": f"Invalid object_type. Must be one of: {', '.join(sorted(ALLOWED_TYPES))}"}, status=400)

    try:
        object_id = int(request.GET.get("object_id", ""))
    except (ValueError, TypeError):
        return JsonResponse({"error": "object_id must be an integer"}, status=400)

    try:
        obj = conn.getObject(object_type, object_id)
        if obj is None:
            return JsonResponse({"error": f"{object_type} {object_id} not found"}, status=404)

        annotations = []
        for ann in obj.listAnnotations():
            # Only file annotations
            if ann.OMERO_TYPE != omero.model.FileAnnotationI:
                continue
            orig_file = ann.getFile()
            if orig_file is None:
                continue
            name = orig_file.getName() or ""
            ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
            ann_date = ann.getDate()
            ann_owner = ann.getOwner()
            annotations.append({
                "id": ann.getId(),
                "file_id": orig_file.getId(),
                "name": name,
                "size": orig_file.getSize(),
                "mimetype": orig_file.getMimetype() or "",
                "extension": ext,
                "ns": ann.getNs() or "",
                "description": ann.getDescription() or "",
                "date": ann_date.isoformat() if ann_date else None,
                "owner": ann_owner.getFullName() if ann_owner else None,
            })

        # Enrich with linked_by from annotation links
        if annotations:
            ann_ids_list = [a["id"] for a in annotations]
            linked_by_map = {}
            try:
                for link in conn.getAnnotationLinks(object_type, ann_ids=ann_ids_list):
                    child = link.getChild()
                    if child and child.getId() not in linked_by_map:
                        lowner = link.getOwner()
                        linked_by_map[child.getId()] = lowner.getFullName() if lowner else None
            except Exception:
                pass
            for a in annotations:
                a["linked_by"] = linked_by_map.get(a["id"])

        return JsonResponse({"annotations": annotations})

    except Exception as e:
        logger.exception("get_object_annotations failed")
        return JsonResponse({"error": str(e)}, status=500)
