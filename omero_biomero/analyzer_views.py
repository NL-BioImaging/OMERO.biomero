import datetime
import json
import logging
from django.core.cache import cache


from biomero import SlurmClient
from biomero.constants import workflow_batched, workflow, transfer
from django.http import JsonResponse
from django.views.decorators.http import require_http_methods
from omeroweb.webclient.decorators import login_required
from omero.rtypes import unwrap, rbool, wrap, rlong

logger = logging.getLogger(__name__)


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
        
        # Determine which script to use based on batch processing settings
        batch_enabled = params.get("batchEnabled", False)
        script_name = "SLURM_Run_Workflow_Batched.py" if batch_enabled else "SLURM_Run_Workflow.py"
        
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
        rename_pt = params.get("renamePattern")
        version = params.get("version")
        # EXPERIMENTAL: ZARR format support
        use_zarr = params.get("useZarrFormat", False)
        # Batch processing parameters
        batch_enabled = params.get("batchEnabled", False)
        batch_count = params.get("batchCount", 1)
        batch_size = params.get("batchSize", len(input_ids) if input_ids else 1)

        # Convert provided params to OMERO rtypes using wrap
        known_params = [
            transfer.DATA_TYPE,
            transfer.IDS,
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
            "useZarrFormat",  # EXPERIMENTAL: ZARR format support
            "batchEnabled",   # Frontend flag (not sent to script)
            "batchCount",     # Frontend calculated (not sent to script)
            "batchSize",      # Converted to Batch_Size for script
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
                transfer.IDS: wrap([rlong(i) for i in input_ids]),
                transfer.DATA_TYPE: wrap(data_type),
                workflow.EMAIL: rbool(out_email),
                "Use_ZARR_Format": rbool(use_zarr),  # EXPERIMENTAL
                workflow_batched.BATCH_SIZE: wrap(batch_size) if batch_enabled else None,  # Only for batched script
                workflow.SELECT_IMPORT: rbool(True),
                workflow.OUTPUT_PARENT: rbool(import_zp),
                workflow.OUTPUT_ATTACH: rbool(attach_og),
                workflow.OUTPUT_NEW_DATASET: (
                    wrap(output_ds[0]) if output_ds else wrap(workflow.NO)
                ),
                workflow.OUTPUT_DUPLICATES: rbool(False),
                workflow.OUTPUT_RENAME: (
                    wrap(rename_pt) if rename_pt else wrap(workflow.NO)
                ),
                workflow.OUTPUT_CSV_TABLE: rbool(uploadcsv),
            }
        )
        
        # Remove None values for non-batched workflows
        inputs = {k: v for k, v in inputs.items() if v is not None}
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
    Also includes the GitHub repository URL for the workflow.
    """
    # workflow_name = request.GET.get("workflow", None)
    workflow_name = kwargs.get("name")
    if not workflow_name:
        return JsonResponse({"error": "Workflow name is required"}, status=400)

    try:
        with SlurmClient.from_config(config_only=True) as sc:
            if workflow_name not in sc.slurm_model_images:
                return JsonResponse(
                    {"error": "Workflow not found"}, status=404
                )

            metadata = sc.pull_descriptor_from_github(workflow_name)
            github_url = sc.slurm_model_repos.get(workflow_name)
    # Keep description/inputs at top-level for backward compatibility
        enriched = {**metadata, "name": workflow_name, "githubUrl": github_url}
        return JsonResponse(enriched)
    except Exception as e:
        logger.error(
            f"Error fetching metadata for workflow {workflow_name}: {str(e)}"
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
    Apply BIOMERO's exact type conversion logic to ensure correct parameter
    types.
    This reuses the same logic that BIOMERO uses in convert_cytype_to_omtype.
    """
    try:
        # Get the workflow descriptor using SlurmClient
        with SlurmClient.from_config(config_only=True) as sc:
            if workflow_name not in sc.slurm_model_images:
                logger.warning(
                    f"Workflow {workflow_name} not found in BIOMERO config"
                )
                return params

            metadata = sc.pull_descriptor_from_github(workflow_name)
    except Exception as e:
        logger.warning(
            f"Could not fetch workflow metadata for {workflow_name}: {e}"
        )
        return params

    # Create a lookup for parameter types based on default values
    # This replicates the exact logic from convert_cytype_to_omtype
    param_type_map = {}
    for input_param in metadata.get("inputs", []):
        if input_param.get("type") == "Number":
            param_id = input_param["id"]
            default_val = input_param.get("default-value")

            # BIOMERO rule: isinstance(default, float) determines the type
            if isinstance(default_val, float):
                param_type_map[param_id] = "float"
            else:
                param_type_map[param_id] = "int"

    # Convert params to correct types
    converted_params = {}
    for key, value in params.items():
        if key in param_type_map:
            try:
                if param_type_map[key] == "float":
                    converted_params[key] = float(value)
                else:
                    converted_params[key] = int(
                        float(value)
                    )  # Handle string floats like "1.0" -> 1
                logger.info(
                    f"Converted {key}: {value} -> {converted_params[key]} "
                    f"({param_type_map[key]})"
                )
            except (ValueError, TypeError):
                logger.warning(
                    f"Could not convert {key}={value} to {param_type_map[key]}"
                )
                converted_params[key] = value
        else:
            converted_params[key] = value

    return converted_params


@login_required()
def get_slurm_status(request, conn=None, **kwargs):
    """
    Check SLURM cluster availability and get workflow version information.
    """
    # Use the main workflow script name - same approach as run_workflow_script
    script_name = "SLURM_Run_Workflow.py"  # Contains all workflow version info
    
    try:
        scriptService = conn.getScriptService()
        
        # Find the script by name (same approach as run_workflow_script)
        scripts = scriptService.getScripts()
        script = None
        for s in scripts:
            if unwrap(s.getName()) == script_name:
                script = s
                break

        if not script:
            return JsonResponse({
                "status": "offline",
                "message": f"SLURM script '{script_name}' not found on server",
                "last_checked": datetime.datetime.now().isoformat(),
                "icon": "error",
                "intent": "danger",
                "workflow_versions": {}
            })
        
        # Get the script ID and fetch params
        script_id = int(unwrap(script.id))
        params = scriptService.getParams(script_id)
        
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
            "workflow_versions": workflow_versions
        }
        
    except Exception as e:
        error_msg = str(e)
        if "Can't find params" in error_msg or "NoValidConnectionsError" in error_msg:
            status = {
                "status": "offline", 
                "message": "SLURM cluster is offline or unreachable",
                "last_checked": datetime.datetime.now().isoformat(),
                "icon": "error",
                "intent": "danger",
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
    
    return JsonResponse(status)
