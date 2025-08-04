import time
import json
import logging

import jwt
from django.views.decorators.http import require_http_methods
from django.http import JsonResponse
from omeroweb.webclient.decorators import login_required

from .plugin_settings import (
    METABASE_SITE_URL,
    METABASE_SECRET_KEY,
    METABASE_WORKFLOWS_DB_PAGE_DASHBOARD_ID,
    METABASE_IMPORTS_DB_PAGE_DASHBOARD_ID,
)

logger = logging.getLogger(__name__)


@login_required()
@require_http_methods(["GET"])
def omero_biomero_dashboard(request, conn=None, **kwargs):
    """
    Render Metabase dashboards for workflows and imports.
    """
    user = conn.getUser()
    payload_wf = {
        "resource": {"dashboard": int(METABASE_WORKFLOWS_DB_PAGE_DASHBOARD_ID)},
        "params": {"user": [user.getId()]},
        "exp": round(time.time()) + 1800,
    }
    payload_imp = {
        "resource": {"dashboard": int(METABASE_IMPORTS_DB_PAGE_DASHBOARD_ID)},
        "params": {"user_name": [user.getName()]},
        "exp": round(time.time()) + 1800,
    }
    token_wf = jwt.encode(payload_wf, METABASE_SECRET_KEY, algorithm="HS256")
    token_imp = jwt.encode(payload_imp, METABASE_SECRET_KEY, algorithm="HS256")

    return JsonResponse({
        "site_url": METABASE_SITE_URL,
        "token_workflows": token_wf,
        "token_imports": token_imp,
    })
