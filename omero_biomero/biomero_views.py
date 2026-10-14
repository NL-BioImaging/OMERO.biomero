import jwt
import logging
import os
import time
from importlib.metadata import PackageNotFoundError, version

from django.http import JsonResponse
from django.urls import NoReverseMatch, reverse
from omeroweb.webclient.decorators import login_required, render_response

from .utils import (
    get_react_build_file,
    parse_bool_env,
)
from .settings import (
    BASE_DIR,
    UPLOADER_ALLOWED_FILE_EXTENSIONS,
)

logger = logging.getLogger(__name__)


def dashboard_token(conn, dashboard):
    """Issue a short-lived embed token locked to the authenticated OMERO user."""
    user = conn.getUser()
    if dashboard == "workflows":
        setting = "METABASE_WORKFLOWS_DB_PAGE_DASHBOARD_ID"
        params = {"user": [user.getId()]}
    elif dashboard == "imports":
        setting = "METABASE_IMPORTS_DB_PAGE_DASHBOARD_ID"
        params = {"user_name": [user.getName()]}
    else:
        raise ValueError("Unknown dashboard")
    expires = round(time.time()) + 1800
    token = jwt.encode(
        {
            "resource": {"dashboard": int(os.environ[setting])},
            "params": params,
            "exp": expires,
        },
        os.environ["METABASE_SECRET_KEY"],
        algorithm="HS256",
    )
    return token, expires


@login_required()
def refresh_dashboard(request, dashboard, conn=None, **kwargs):
    if request.method != "GET":
        response = JsonResponse({"error": "Use GET to refresh the monitor."}, status=405)
        response["Allow"] = "GET"
    elif dashboard not in {"workflows", "imports"}:
        response = JsonResponse({"error": "Unknown dashboard."}, status=404)
    else:
        try:
            token, expires = dashboard_token(conn, dashboard)
            site = os.environ["METABASE_SITE_URL"].rstrip("/")
            response = JsonResponse({
                "url": f"{site}/embed/dashboard/{token}",
                "expires": expires,
            })
        except (KeyError, ValueError):
            response = JsonResponse({"error": "The monitor is not configured. Contact your administrator."}, status=503)
    response["Cache-Control"] = "no-store"
    return response


# TODO remove this check when the app is ready
def check_base_directory():
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


check_base_directory()


def data_analysis_status(enabled):
    """Return the same-origin OMERO.Analysis host contract for the frontend."""
    if not enabled:
        return {"available": False, "url": "", "error": ""}

    try:
        version("omero-analysis")
    except PackageNotFoundError:
        return {
            "available": False,
            "url": "",
            "error": (
                "Data Analysis is enabled, but the omero-analysis package is "
                "not installed in this OMERO.web environment."
            ),
        }

    try:
        analysis_url = reverse("omero_analysis_index")
    except NoReverseMatch:
        return {
            "available": False,
            "url": "",
            "error": (
                "Data Analysis is enabled, but the OMERO.Analysis URL is not "
                "registered. Verify the OMERO.web app configuration."
            ),
        }

    return {"available": True, "url": analysis_url, "error": ""}


@login_required()
@render_response()
def biomero(request, conn=None, **kwargs):
    """
    Render the main Biomero page with Metabase integration and user context.
    """

    metabase_site_url = os.environ.get("METABASE_SITE_URL")

    importer_enabled = parse_bool_env(os.environ.get("IMPORTER_ENABLED"), default=True)
    analyzer_enabled = parse_bool_env(os.environ.get("ANALYZER_ENABLED"), default=True)
    data_analysis_enabled = parse_bool_env(
        os.environ.get("INTEGRATE_DATA_ANALYSIS"), default=False
    )
    analysis_status = data_analysis_status(data_analysis_enabled)
    shallow_zarr_enabled = parse_bool_env(
        os.environ.get("BIOMERO_SHALLOW_ZARR"), default=False
    )

    current_user = conn.getUser()
    username = current_user.getName()
    user_id = current_user.getId()
    is_admin = conn.isAdmin()

    token_monitor_workflows, _ = dashboard_token(conn, "workflows")
    token_imports, _ = dashboard_token(conn, "imports")

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
        "title": "BIOMERO",
        "app_name": "biomero",
        "importer_enabled": importer_enabled,
        "analyzer_enabled": analyzer_enabled,
        "data_analysis_enabled": data_analysis_enabled,
        "data_analysis_available": analysis_status["available"],
        "data_analysis_url": analysis_status["url"],
        "data_analysis_error": analysis_status["error"],
        "shallow_zarr_enabled": shallow_zarr_enabled,
        "uploader_allowed_file_extensions": UPLOADER_ALLOWED_FILE_EXTENSIONS,
    }
    return context
