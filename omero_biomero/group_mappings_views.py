import json
import logging
import os

from django.views.decorators.http import require_http_methods
from django.http import JsonResponse
from omeroweb.webclient.decorators import login_required

from .plugin_settings import GROUP_MAPPINGS_FILE

logger = logging.getLogger(__name__)


@login_required()
@require_http_methods(["GET", "POST"])
def group_mappings(request, conn=None, **kwargs):
    """Handle GET and POST for group mappings file."""
    try:
        if request.method == "GET":
            if os.path.exists(GROUP_MAPPINGS_FILE):
                with open(GROUP_MAPPINGS_FILE) as f:
                    mappings = json.load(f)
            else:
                mappings = {}
            return JsonResponse({"mappings": mappings})

        # POST: only admins
        user = conn.getUser()
        if not conn.isAdmin():
            return JsonResponse({"error": "Admins only"}, status=403)

        data = json.loads(request.body or '{}')
        mappings = data.get('mappings', {})
        with open(GROUP_MAPPINGS_FILE, 'w') as f:
            json.dump(mappings, f, indent=2)
        logger.info(f"Group mappings updated by {user.getName()} (ID {user.getId()})")
        return JsonResponse({"message": "Mappings saved"})
    except json.JSONDecodeError:
        return JsonResponse({"error": "Invalid JSON"}, status=400)
    except Exception as e:
        logger.error(f"Error in group_mappings: {e}")
        return JsonResponse({"error": str(e)}, status=500)
