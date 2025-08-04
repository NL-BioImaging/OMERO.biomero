import json
import os
import logging

from django.http import JsonResponse, HttpResponseBadRequest
from django.views.decorators.http import require_http_methods

from omeroweb.webclient.decorators import login_required

from .plugin_settings import IMPORT_MOUNT_PATH
from .file_browser.ReadLeicaFile import read_leica_file

logger = logging.getLogger(__name__)


def _check_directory_access(path):
    if not os.path.exists(path):
        return False, f"Directory does not exist: {path}"
    if not os.access(path, os.R_OK):
        return False, f"Directory is not readable: {path}"
    if not os.access(path, os.X_OK):
        return False, f"Directory is not searchable: {path}"
    return True, None


@login_required()
@require_http_methods(["GET"])
def list_directory(request, conn=None, **kwargs):
    """
    List files and subdirectories under a given path within IMPORT_MOUNT_PATH.
    """
    path = request.GET.get("path", "")
    abs_path = os.path.abspath(os.path.join(IMPORT_MOUNT_PATH, path))
    if not abs_path.startswith(IMPORT_MOUNT_PATH):
        return JsonResponse({"error": "Access denied"}, status=403)

    ok, msg = _check_directory_access(abs_path)
    if not ok:
        return JsonResponse({"error": msg}, status=403)

    try:
        items = os.listdir(abs_path)
        dirs, files = [], []
        for name in items:
            full = os.path.join(abs_path, name)
            rel = os.path.relpath(full, IMPORT_MOUNT_PATH)
            if os.path.isdir(full):
                dirs.append({"name": name, "path": rel})
            else:
                files.append({"name": name, "path": rel})
        return JsonResponse({"dirs": dirs, "files": files})
    except OSError as e:
        logger.error(f"Failed to list {abs_path}: {e}")
        return JsonResponse({"error": str(e)}, status=500)


@login_required()
@require_http_methods(["GET"])
def get_folder_contents(request, conn=None, **kwargs):
    """
    Fetch specific folder or file items (incl. Leica metadata).
    """
    item_id = request.GET.get("item_id")
    folder_flag = request.GET.get("is_folder") == "true"
    path, uuid = (item_id or "").split("#") + [None]
    abs_path = os.path.join(IMPORT_MOUNT_PATH, path)

    if not os.path.exists(abs_path):
        return HttpResponseBadRequest("Invalid path.")

    contents, metadata = [], None
    if os.path.isfile(abs_path):
        ext = os.path.splitext(abs_path)[1]
        if ext.lower() in ['.lif', '.xlef', '.lof']:
            metadata = json.loads(read_leica_file(abs_path, folder_uuid=uuid if folder_flag else None))
            for child in metadata.get('children', []):
                contents.append({
                    'name': child['name'],
                    'is_folder': child['type']=='Folder',
                    'id': f"{path}#{child['uuid']}",
                    'metadata': child,
                })
        else:
            contents.append({'name': os.path.basename(abs_path), 'id': path})
    else:
        for name in os.listdir(abs_path):
            full = os.path.join(abs_path, name)
            is_dir = os.path.isdir(full)
            contents.append({'name': name, 'is_folder': is_dir, 'id': os.path.relpath(full, IMPORT_MOUNT_PATH)})

    contents.sort(key=lambda x: (not x.get('is_folder', False), x['name'].lower()))
    return JsonResponse({'contents': contents, 'metadata': metadata})
