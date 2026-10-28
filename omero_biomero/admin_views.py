import configparser
import datetime
import json
import logging
import os

from biomero import SlurmClient
from collections import defaultdict
from configupdater import ConfigUpdater, Comment
from django.http import JsonResponse, HttpResponseBadRequest
from django.views.decorators.http import require_http_methods
from omeroweb.webclient.decorators import login_required
from .settings import CONFIG_FILE_PATH
from .config_validation import ConfigValidationError, validate_ini_sections

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
            # Use BIOMERO's public loader so reads and writes follow the same
            # layered or authoritative-file policy. Legacy [MODELS] remains a
            # lower-priority alias for [WORKFLOWS].
            if hasattr(SlurmClient, "load_config"):
                loaded_config = SlurmClient.load_config()
            else:  # Backward compatibility with older BIOMERO releases.
                loaded_config = configparser.ConfigParser(allow_no_value=True)
                loaded_config.read([
                    os.path.expanduser(SlurmClient._DEFAULT_CONFIG_PATH_1),
                    os.path.expanduser(SlurmClient._DEFAULT_CONFIG_PATH_2),
                    os.path.expanduser(SlurmClient._DEFAULT_CONFIG_PATH_3),
                ])

            config_dict = {}
            for section in loaded_config.sections():
                if section.upper() not in ("MODELS", "WORKFLOWS"):
                    config_dict[section] = dict(loaded_config.items(section))

            workflows = {}
            for section in ("MODELS", "WORKFLOWS"):
                if loaded_config.has_section(section):
                    workflows.update(dict(loaded_config.items(section)))
            if workflows:
                config_dict["WORKFLOWS"] = workflows

            # Load the JSON configuration file (biomero-config.json)
            json_config = {}
            if os.path.exists(CONFIG_FILE_PATH):
                try:
                    with open(CONFIG_FILE_PATH, "r") as f:
                        json_config = json.load(f)
                except Exception as e:
                    logger.error(f"Error reading JSON config: {str(e)}")

            # Merge JSON config into config_dict
            # Note: JSON config allows nested dicts, while INI is flat (section -> key/value)
            # We assume top-level keys in JSON correspond to sections or specific config groups
            for key, value in json_config.items():
                config_dict[key] = value

            authoritative = (
                SlurmClient.get_authoritative_config_path()
                if hasattr(SlurmClient, "get_authoritative_config_path")
                else None
            )
            return JsonResponse({
                "config": config_dict,
                "config_mode": "authoritative" if authoritative else "layered",
            })
        except Exception as e:
            logger.error(f"Error retrieving BIOMERO config: {str(e)}")
            return JsonResponse({"error": "Unable to read configuration. Check the server logs."}, status=500)

    elif request.method == "POST":
        """
        Save the biomero config
        """
        try:
            # Parse the incoming JSON payload
            data = json.loads(request.body)
            if not isinstance(data, dict) or not isinstance(data.get("config", {}), dict):
                raise ConfigValidationError({"config": "Expected an object of configuration sections."})
            current_user = conn.getUser()
            username = current_user.getName()
            user_id = current_user.getId()
            is_admin = conn.isAdmin()
            if not is_admin:
                logger.error(f"Unauthorized request for user {user_id}:{username}")
                return JsonResponse({"error": "Unauthorized request"}, status=403)

            # Use BIOMERO's authoritative write target when configured.
            if hasattr(SlurmClient, "get_config_write_path"):
                config_path = SlurmClient.get_config_write_path()
            else:
                config_path = os.path.expanduser(
                    SlurmClient._DEFAULT_CONFIG_PATH_3)

            # Create ConfigUpdater object
            config = ConfigUpdater()

            # Read the existing configuration if the file exists
            if os.path.exists(config_path):
                config.read(config_path)

            # Extract the 'config' section from the incoming data
            config_data = data.get("config", {})
            deleted = data.get("deleted", [])
            if not isinstance(deleted, list):
                raise ValueError("Invalid deletion list")
            for deletion in deleted:
                if (
                    not isinstance(deletion, dict)
                    or not isinstance(deletion.get("section"), str)
                    or not deletion["section"]
                    or not isinstance(deletion.get("option"), str)
                    or not deletion["option"]
                ):
                    raise ValueError("Invalid deletion entry")

            def generate_model_comment(key):
                if key.endswith("_job"):
                    c = "# The jobscript in the 'slurm_script_repo'"
                elif key.endswith("_repo"):
                    c = "# The (e.g. github) repository with the descriptor.json / config.yaml file"
                elif key.endswith("_use_gpu"):
                    c = "# Mark this workflow as GPU-enabled by default (uses global gpu_partition / gpu_gres / gpu_gpus)"
                else:
                    c = "# Adding or overriding job value for this workflow"
                return c

            # Separate settings for JSON config and INI config
            json_config_updates = {}
            ini_config_updates = {}

            # Define sections that belong in the JSON configuration
            JSON_SECTIONS = [
                "UPLOADER",
                "PREPROCESSING_CONFIG",
                "PREPROCESSING_EXTENSION_MAP",
                "FILE_OR_EXTENSION_PATTERNS_EXCLUSIVE",
                "UPLOADER_NESTED_FILE_EXTENSIONS",
                "group_mappings",
            ]

            for section, settingsd in config_data.items():
                if section in JSON_SECTIONS:
                    json_config_updates[section] = settingsd
                else:
                    ini_config_updates[section] = settingsd

            json_deletions = [
                item for item in deleted if item["section"] in JSON_SECTIONS
            ]
            ini_deletions = [
                item for item in deleted if item["section"] not in JSON_SECTIONS
            ]

            # Prepare both candidates in memory before touching either live file.
            validate_ini_sections(ini_config_updates)
            current_json_config = None
            if json_config_updates or json_deletions:
                current_json_config = {}
                if os.path.exists(CONFIG_FILE_PATH):
                    with open(CONFIG_FILE_PATH, "r", encoding="utf-8") as f:
                        current_json_config = json.load(f)
                if not isinstance(current_json_config, dict):
                    raise ConfigValidationError({"config": "The JSON configuration must be an object."})
                current_json_config.update(json_config_updates)
                for deletion in json_deletions:
                    section_data = current_json_config.get(deletion["section"])
                    if isinstance(section_data, dict):
                        section_data.pop(deletion["option"], None)

            # --- Save INI Config ---
            # The workflow definitions section may be named [WORKFLOWS]
            # (preferred) or [MODELS] (legacy). The web UI always sends it as
            # "WORKFLOWS", but we preserve whichever name the existing ini file
            # already uses so we never create a duplicate/conflicting section.
            if "WORKFLOWS" in config:
                workflow_section_name = "WORKFLOWS"
            elif "MODELS" in config:
                workflow_section_name = "MODELS"
            else:
                workflow_section_name = "WORKFLOWS"

            # Update the config with new values
            for section, settingsd in ini_config_updates.items():
                if not isinstance(settingsd, dict):
                    raise ValueError(
                        f"Section '{section}' must contain key-value pairs."
                    )

                # Normalize the workflow section name to whatever the existing
                # ini uses (MODELS or WORKFLOWS); they share identical handling.
                if section in ("MODELS", "WORKFLOWS"):
                    section = workflow_section_name

                # If the section doesn't exist, add it
                if section not in config:
                    config.add_section(section)

                if section in ("MODELS", "WORKFLOWS"):
                    # Group keys by prefix (cellpose, stardist, etc.)
                    model_keys = defaultdict(list)
                    for key, value in settingsd.items():
                        # Split the key on the known suffixes to derive the
                        # model prefix.  Order matters: check longer/more-
                        # specific suffixes before shorter ones so that
                        # e.g. "wf_job_mem" → prefix "wf" (not "wf_job").
                        model_prefix = key
                        for suffix in ["use_gpu", "job_", "repo", "job"]:
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
                        for suffix in ["use_gpu", "job_", "repo", "job"]:
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
                    # Remove sbatch_* keys that were deleted via the UI.
                    # The frontend omits removed entries from the payload, so any
                    # sbatch_* key still in the ini but absent from settingsd is stale.
                    if section == "SLURM":
                        for key in list(config[section].keys()):
                            if key.startswith("sbatch_") and key not in settingsd:
                                del config[section][key]

            # Apply explicit deletions last so every INI option can be removed,
            # independent of section-specific form behavior.
            for deletion in ini_deletions:
                section = deletion["section"]
                if section in ("MODELS", "WORKFLOWS"):
                    section = workflow_section_name
                if section in config and deletion["option"] in config[section]:
                    del config[section][deletion["option"]]

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

            # Validate serialization and workflow semantics before writing either file.
            candidate = str(config)
            parsed = configparser.ConfigParser(allow_no_value=True)
            parsed.read_string(candidate)
            validate_ini_sections({
                section: dict(parsed.items(section, raw=True))
                for section in parsed.sections() if section in ("MODELS", "WORKFLOWS", "UI")
            }, complete=True)
            # Serialize JSON before opening either file: invalid candidates must
            # never partially apply a save. File I/O failures remain separate.
            json_candidate = None
            if current_json_config is not None:
                json_candidate = json.dumps(current_json_config, indent=2, ensure_ascii=False)

            if json_candidate is not None:
                config_dir = os.path.dirname(CONFIG_FILE_PATH)
                if config_dir:
                    os.makedirs(config_dir, exist_ok=True)
                with open(CONFIG_FILE_PATH, "w", encoding="utf-8") as stream:
                    stream.write(json_candidate)
                logger.info(f"JSON configuration saved to {CONFIG_FILE_PATH}")
            with open(config_path, "w", encoding="utf-8") as stream:
                stream.write(candidate)
            logger.info(f"Configuration saved successfully to {config_path}")

            return JsonResponse(
                {"message": "Configuration saved successfully"}, status=200,
            )

        except ConfigValidationError as e:
            return JsonResponse({"error": "Invalid configuration format: " + str(e),
                                 "fields": e.fields}, status=400)
        except configparser.Error:
            logger.exception("Invalid serialized INI configuration")
            return JsonResponse({"error": "Invalid configuration format: correct the INI settings before saving."}, status=400)
        except json.JSONDecodeError:
            logger.error("Invalid JSON data in the request")
            return JsonResponse({"error": "Invalid JSON data"}, status=400)
        except ValueError as e:
            logger.error(f"Invalid configuration format: {str(e)}")
            error_prefix = (
                "Invalid deletion" if "deletion" in str(e).lower()
                else "Invalid configuration format"
            )
            return JsonResponse(
                {"error": f"{error_prefix}: {str(e)}"}, status=400
            )
        except Exception as e:
            logger.error(f"Unexpected error: {str(e)}")
            return JsonResponse(
                {"error": "Failed to save configuration. Check the server logs."}, status=500
            )
    else:
        logger.error("Unsupported HTTP method for 'config' endpoint")
        return HttpResponseBadRequest("Unsupported HTTP method. Use GET or POST.")
