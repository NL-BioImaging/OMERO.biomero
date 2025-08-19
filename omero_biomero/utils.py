import json
import os
import logging

logger = logging.getLogger(__name__)


def parse_bool_env(env_var, default=True):
    """
    Parse environment variable as boolean with graceful handling of multiple formats.

    Accepts: 'true', 'True', 'TRUE', '1', 'yes', 'on', 'enabled'
    Rejects: 'false', 'False', 'FALSE', '0', 'no', 'off', 'disabled', None, ''
    """
    if env_var is None:
        return default

    if isinstance(env_var, bool):
        return env_var

    # Convert to string and normalize
    str_val = str(env_var).lower().strip()

    # Truthy values
    truthy = {"true", "1", "yes", "on", "enabled", "enable"}
    # Falsy values
    falsy = {"false", "0", "no", "off", "disabled", "disable", ""}

    if str_val in truthy:
        return True
    elif str_val in falsy:
        return False
    else:
        # Log warning for unrecognized values
        logger.warning(
            f"Unrecognized boolean value '{env_var}' for environment variable, defaulting to {default}"
        )
        return default


def get_react_build_file(logical_name):
    """
    Returns the hashed filename for a React build file.
    """
    current_dir = os.path.dirname(__file__)
    manifest_path = os.path.join(
        current_dir, "static/omero_biomero/assets/asset-manifest.json"
    )
    manifest_path = os.path.normpath(manifest_path)

    try:
        with open(manifest_path, "r") as manifest_file:
            manifest = json.load(manifest_file)
        path = manifest.get(
            logical_name, logical_name
        )  # Fallback to logical_name if not found
        # Remove first slash
        return path[1:]
    except FileNotFoundError:
        return logical_name


def check_directory_permissions(path):
    """Check if a directory exists and is accessible."""
    try:
        exists = os.path.exists(path)
        readable = os.access(path, os.R_OK) if exists else False
        executable = os.access(path, os.X_OK) if exists else False

        if not exists:
            return False, f"Directory does not exist: {path}"
        if not readable:
            return False, f"Directory is not readable: {path}"
        if not executable:
            return False, f"Directory is not executable (searchable): {path}"

        return True, "Directory is accessible"
    except Exception as e:
        return False, f"Error checking directory access: {str(e)}"


def build_extra_params(template_extra, uuid_value):
    """
    Materialize extra preprocessing parameters from a template dict.

    Behavior:
        - For each key/value in template_extra:
                * If value is a string containing the {UUID} placeholder and
                    a uuid_value is provided, substitute it.
                * If value contains {UUID} but no uuid_value is provided,
                    skip that key.
                * Otherwise copy the value as-is.
    - Returns a new dict or None if no parameters remain after filtering.
    """
    if not template_extra:
        return None

    realized = {}
    for key, value in template_extra.items():
        if isinstance(value, str) and "{UUID}" in value:
            if uuid_value:
                realized[key] = value.replace("{UUID}", uuid_value)
            else:
                # Skip param requiring UUID when none available
                continue
        else:
            realized[key] = value

    return realized or None
