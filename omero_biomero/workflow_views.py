import json
import datetime
import logging

from django.views.decorators.http import require_http_methods
from django.http import JsonResponse

from omeroweb.webclient.decorators import login_required
from omero.rtypes import wrap, rbool, rlong, unwrap
from biomero import SlurmClient
from .utils import prepare_workflow_parameters

logger = logging.getLogger(__name__)


@login_required()
@require_http_methods(["POST"])
def run_workflow_script(request, conn=None, script_name="SLURM_Run_Workflow.py", **kwargs):
    """
    Trigger a specific OMERO script to run based on provided script name and parameters.
    """
    try:
        data = json.loads(request.body)
        workflow_name = data.get("workflow_name")
        if not workflow_name:
            return JsonResponse({"error": "workflow_name is required"}, status=400)
        params = prepare_workflow_parameters(workflow_name, data.get("params", {}))

        svc = conn.getScriptService()
        script = next(
            (s for s in svc.getScripts() if unwrap(s.getName()) == script_name), None
        )
        if not script:
            return JsonResponse({"error": f"Script {script_name} not found"}, status=404)

        inputs = {k: wrap(v) for k, v in params.items()}
        inputs.update({
            workflow_name: rbool(True),
            "IDs": wrap([rlong(i) for i in params.get("IDs", [])]),
        })

        proc = svc.runScript(int(unwrap(script.id)), inputs, None)
        job_id = unwrap(proc.getJob()._id)
        msg = (
            f"Started {script_name} for {workflow_name} at "
            f"{datetime.datetime.now()} (Job ID {job_id})"
        )
        logger.info(msg)
        return JsonResponse({"status": "success", "message": msg})
    except json.JSONDecodeError:
        return JsonResponse({"error": "Invalid JSON data"}, status=400)
    except Exception as e:
        logger.error(f"Error executing script: {e}")
        return JsonResponse({"error": str(e)}, status=500)


@login_required()
@require_http_methods(["GET"])
def list_workflows(request, conn=None, **kwargs):
    """List available workflows via SlurmClient."""
    try:
        with SlurmClient.from_config(config_only=True) as sc:
            workflows = list(sc.slurm_model_images.keys())
        return JsonResponse({"workflows": workflows})
    except Exception as e:
        logger.error(f"Error listing workflows: {e}")
        return JsonResponse({"error": str(e)}, status=500)


@login_required()
@require_http_methods(["GET"])
def get_workflow_metadata(request, conn=None, **kwargs):
    """Get metadata for a specific workflow."""
    name = kwargs.get("name")
    if not name:
        return JsonResponse({"error": "Workflow name required"}, status=400)
    try:
        with SlurmClient.from_config(config_only=True) as sc:
            if name not in sc.slurm_model_images:
                return JsonResponse({"error": "Workflow not found"}, status=404)
            metadata = sc.pull_descriptor_from_github(name)
        return JsonResponse(metadata)
    except Exception as e:
        logger.error(f"Error fetching metadata for {name}: {e}")
        return JsonResponse({"error": str(e)}, status=500)


@login_required()
@require_http_methods(["GET"])
def get_workflow_github(request, conn=None, **kwargs):
    """Fetch GitHub URL for a specific workflow."""
    name = kwargs.get("name")
    if not name:
        return JsonResponse({"error": "Workflow name required"}, status=400)
    try:
        with SlurmClient.from_config(config_only=True) as sc:
            url = sc.slurm_model_repos.get(name)
        if not url:
            return JsonResponse({"error": "Workflow not found"}, status=404)
        return JsonResponse({"url": url})
    except Exception as e:
        logger.error(f"Error fetching GitHub URL for {name}: {e}")
        return JsonResponse({"error": str(e)}, status=500)
