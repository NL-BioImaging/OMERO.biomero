import json
import logging
import os
import datetime
from collections import defaultdict

from django.views.decorators.http import require_http_methods
from django.http import JsonResponse

from omeroweb.webclient.decorators import login_required
from biomero import SlurmClient
from configparser import ConfigParser
from configupdater import ConfigUpdater, Comment

logger = logging.getLogger(__name__)


@login_required()
@require_http_methods(["GET"])
def get_biomero_config(request, conn=None, **kwargs):
    """
    Read the BIOMERO config from SLURM client default files.
    """
    try:
        user = conn.getUser()
        if not conn.isAdmin():
            logger.error(
                f"Unauthorized request for user {user.getId()}:{user.getName()}"
            )
            return JsonResponse({"error": "Unauthorized request"}, status=403)

        cp = ConfigParser(allow_no_value=True)
        cp.read([
            os.path.expanduser(SlurmClient._DEFAULT_CONFIG_PATH_1),
            os.path.expanduser(SlurmClient._DEFAULT_CONFIG_PATH_2),
            os.path.expanduser(SlurmClient._DEFAULT_CONFIG_PATH_3),
        ])
        cfg = {section: dict(cp.items(section)) for section in cp.sections()}
        return JsonResponse({"config": cfg})
    except Exception as e:
        logger.error(f"Error retrieving BIOMERO config: {e}")
        return JsonResponse({"error": str(e)}, status=500)


@login_required()
@require_http_methods(["POST"])
def save_biomero_config(request, conn=None, **kwargs):
    """
    Save the BIOMERO config via ConfigUpdater with comments preserved.
    """
    try:
        data = json.loads(request.body)
        user = conn.getUser()
        if not conn.isAdmin():
            logger.error(
                f"Unauthorized request for user {user.getId()}:{user.getName()}"
            )
            return JsonResponse({"error": "Unauthorized request"}, status=403)

        config_path = os.path.expanduser(SlurmClient._DEFAULT_CONFIG_PATH_3)
        updater = ConfigUpdater()
        if os.path.exists(config_path):
            updater.read(config_path)

        cfg_data = data.get("config", {})

        def gen_comment(key):
            if key.endswith("_job"):
                return "# The jobscript in the 'slurm_script_repo'"
            if key.endswith("_repo"):
                return "# The (e.g. github) repo with the descriptor.json"
            return "# Overriding job value via web UI"

        for section, settingsd in cfg_data.items():
            if not isinstance(settingsd, dict):
                raise ValueError(f"Section '{section}' must be a dict.")
            if section not in updater:
                updater.add_section(section)

            if section == "MODELS":
                model_keys = defaultdict(list)
                for key, val in settingsd.items():
                    prefix = key.split("_")[0]
                    model_keys[prefix].append((key, val))

                for prefix in sorted(model_keys):
                    for key, val in model_keys[prefix]:
                        if key in updater[section]:
                            updater.set(section, key, val)
                        else:
                            comment = gen_comment(key)
                            updater[section].add_after.comment(comment).option(key, val)

                # remove removed keys
                for key in list(updater[section].keys()):
                    prefix = key.split("_")[0]
                    if prefix not in model_keys:
                        del updater[section][key]
            else:
                for key, val in settingsd.items():
                    updater.set(section, key, val)

        # add changelog
        ts = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        comment = f"Updated by {user.getName()} via web UI on {ts}"
        if "changelog" not in updater:
            updater.add_section("changelog")
        section = updater["changelog"]
        if isinstance(section.first_block, Comment):
            section.first_block.detach()
        section.add_after.comment(comment)

        with open(config_path, "w") as f:
            updater.write(f)

        logger.info(f"Saved BIOMERO config to {config_path}")
        return JsonResponse({"message": "Configuration saved", "path": config_path})
    except json.JSONDecodeError:
        return JsonResponse({"error": "Invalid JSON"}, status=400)
    except ValueError as e:
        return JsonResponse({"error": str(e)}, status=400)
    except Exception as e:
        logger.error(f"Failed to save BIOMERO config: {e}")
        return JsonResponse({"error": str(e)}, status=500)
