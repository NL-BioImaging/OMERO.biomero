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
            # Load the configuration file
            configs = configparser.ConfigParser(allow_no_value=True)
            # Loads from default locations and given location, missing files are ok
            configs.read(
                [
                    os.path.expanduser(SlurmClient._DEFAULT_CONFIG_PATH_1),
                    os.path.expanduser(SlurmClient._DEFAULT_CONFIG_PATH_2),
                    os.path.expanduser(SlurmClient._DEFAULT_CONFIG_PATH_3),
                ]
            )
            # Convert configparser object to JSON-like dict
            config_dict = {
                section: dict(configs.items(section)) for section in configs.sections()
            }

            return JsonResponse({"config": config_dict})
        except Exception as e:
            logger.error(f"Error retrieving BIOMERO config: {str(e)}")
            return JsonResponse({"error": str(e)}, status=500)

    elif request.method == "POST":
        """
        Save the biomero config
        """
        try:
            # Parse the incoming JSON payload
            data = json.loads(request.body)
            current_user = conn.getUser()
            username = current_user.getName()
            user_id = current_user.getId()
            is_admin = conn.isAdmin()
            if not is_admin:
                logger.error(f"Unauthorized request for user {user_id}:{username}")
                return JsonResponse({"error": "Unauthorized request"}, status=403)

            # Define the file path for saving the configuration
            config_path = os.path.expanduser(SlurmClient._DEFAULT_CONFIG_PATH_3)

            # Create ConfigUpdater object
            config = ConfigUpdater()

            # Read the existing configuration if the file exists
            if os.path.exists(config_path):
                config.read(config_path)

            # Extract the 'config' section from the incoming data
            config_data = data.get("config", {})

            def generate_model_comment(key):
                if key.endswith("_job"):
                    c = "# The jobscript in the 'slurm_script_repo'"
                elif key.endswith("_repo"):
                    c = "# The (e.g. github) repository with the descriptor.json file"
                else:
                    c = "# Adding or overriding job value for this workflow"
                return c

            # Update the config with new values
            for section, settingsd in config_data.items():
                if not isinstance(settingsd, dict):
                    raise ValueError(
                        f"Section '{section}' must contain key-value pairs."
                    )

                # If the section doesn't exist, add it
                if section not in config:
                    config.add_section(section)

                if section == "MODELS":
                    # Group keys by prefix (cellpose, stardist, etc.)
                    model_keys = defaultdict(list)
                    for key, value in settingsd.items():
                        # Split the key on the known suffixes
                        model_prefix = key
                        for suffix in ["repo", "job"]:
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
                        for suffix in ["repo", "job"]:
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

            # Save the updated configuration while preserving comments
            with open(config_path, "w") as config_file:
                config.write(config_file)

            logger.info(f"Configuration saved successfully to {config_path}")
            return JsonResponse(
                {"message": "Configuration saved successfully", "path": config_path},
                status=200,
            )

        except json.JSONDecodeError:
            logger.error("Invalid JSON data in the request")
            return JsonResponse({"error": "Invalid JSON data"}, status=400)
        except ValueError as e:
            logger.error(f"Invalid configuration format: {str(e)}")
            return JsonResponse(
                {"error": f"Invalid configuration format: {str(e)}"}, status=400
            )
        except Exception as e:
            logger.error(f"Unexpected error: {str(e)}")
            return JsonResponse(
                {"error": f"Failed to save configuration: {str(e)}"}, status=500
            )
    else:
        logger.error("Unsupported HTTP method for 'config' endpoint")
        return HttpResponseBadRequest("Unsupported HTTP method. Use GET or POST.")
