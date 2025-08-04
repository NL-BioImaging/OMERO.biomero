import json
import os
import uuid
import logging

from collections import defaultdict
from django.views.decorators.http import require_http_methods
from django.http import JsonResponse
from omeroweb.webclient.decorators import login_required

from .plugin_settings import IMPORT_MOUNT_PATH
from .utils import create_upload_order

logger = logging.getLogger(__name__)


@login_required()
@require_http_methods(["POST"])
def import_selected(request, conn=None, **kwargs):
    """
    Queue selected items for import with preprocessing.
    """
    data = json.loads(request.body or '{}')
    upload = data.get("upload", {})
    items = upload.get("selectedLocal", [])
    dests = upload.get("selectedOmero", [])
    group = upload.get("group")

    if not items:
        return JsonResponse({"error": "No items selected"}, status=400)
    if not dests:
        return JsonResponse({"error": "No destinations selected"}, status=400)
    if not group:
        return JsonResponse({"error": "No group specified"}, status=400)

    user = conn.getUser()
    if group not in [g.getName() for g in conn.getGroupsMemberOf()]:
        return JsonResponse({"error": f"Not in group {group}"}, status=403)

    files_by_key = defaultdict(list)
    for itm in items:
        if isinstance(itm, dict):
            lp = itm.get("localPath")
            uid = itm.get("uuid")
        else:
            lp, uid = itm, None
        path = os.path.abspath(os.path.join(IMPORT_MOUNT_PATH, lp))
        for tp, pid in dests:
            if tp.lower().startswith('screen'):
                key = 'screen_db' if path.endswith('.db') else 'screen_no_preprocessing'
            else:
                ext = os.path.splitext(path)[1].lower()
                key = 'dataset_leica_uuid' if uid and ext in ['.lif', '.xlef', '.lof'] else 'dataset_no_preprocessing'
            files_by_key[(tp, pid, key)].append((path, uid))

    for (tp, pid, key), finfos in files_by_key.items():
        info = {
            'Group': group,
            'Username': user.getName(),
            'DestinationType': tp.capitalize(),
            'DestinationID': pid,
            'UUID': str(uuid.uuid4()),
            'Files': [p for p, _ in finfos],
        }
        if key == 'dataset_leica_uuid':
            info.update({
                'preprocessing_container': 'cellularimagingcf/convertleica-docker:v1.2.0',
                'preprocessing_inputfile': '{Files}',
                'preprocessing_outputfolder': '/data',
                'preprocessing_altoutputfolder': '/out',
            })
            for p, u in finfos:
                if u:
                    si = info.copy()
                    si['Files'] = [p]
                    si['UUID'] = str(uuid.uuid4())
                    si['extra_params'] = {'image_uuid': u}
                    create_upload_order(si)
            nonu = [p for p, u in finfos if not u]
            if nonu:
                info['Files'] = nonu
                create_upload_order(info)
        else:
            create_upload_order(info)

    return JsonResponse({'status': 'success', 'queued': sum(len(v) for v in files_by_key.values())})
