"""Offline validation for configuration edits; never initializes workflows."""

import re
import json
from urllib.parse import urlsplit


class ConfigValidationError(ValueError):
    def __init__(self, fields):
        super().__init__("Correct the highlighted configuration fields.")
        self.fields = fields


def workflow_prefix(key):
    return re.split(r"_(?:use_gpu|job_|repo$|job$)", key, maxsplit=1)[0]


def valid_repository(value):
    if not isinstance(value, str) or re.search(r"\s", value):
        return False
    parsed = urlsplit(value)
    parts = parsed.path.strip("/").split("/")
    return (
        parsed.scheme == "https" and parsed.netloc == "github.com"
        and not parsed.query and not parsed.fragment
        and len(parts) >= 2
        and all(re.fullmatch(r"[A-Za-z0-9_.-]+", part) for part in parts[:2])
        and (len(parts) == 2 or (
            len(parts) >= 4 and parts[2] == "tree" and all(parts[3:])
        ))
    )


def validate_ini_sections(sections):
    fields = {}
    for section, values in sections.items():
        if (not isinstance(section, str) or not section.strip()
                or section != section.strip() or re.search(r"[\[\]\r\n\x00]", section)):
            fields["config"] = "Section names must be nonempty, single-line names."
            continue
        if not isinstance(values, dict):
            fields[section] = "Section must contain key-value pairs."
            continue
        folded = set()
        for key, value in values.items():
            field = f"{section}.{key}"
            if (not isinstance(key, str) or not key.strip() or key != key.strip()
                    or re.search(r"[=:\r\n\x00\[\]]", key) or key.startswith(("#", ";"))):
                fields[field] = "Option names must be nonempty and contain no INI delimiters."
                continue
            if key.lower() in folded:
                fields[field] = "Option names must be unique (case insensitive)."
            folded.add(key.lower())
            if value is not None and not isinstance(value, (str, bool, int, float)):
                fields[field] = "Use a single-line value."
            elif isinstance(value, str) and re.search(r"[\r\n\x00]", value):
                fields[field] = "Use a single-line value; remove unexpected line breaks."

        if section == "UI" and "zarr_v3_workflows" in values:
            try:
                workflows = json.loads(values["zarr_v3_workflows"] or "[]")
            except (ValueError, TypeError):
                workflows = None
            if not isinstance(workflows, list) or any(
                    not isinstance(name, str) or not re.fullmatch(r"[a-z0-9][a-z0-9_-]*", name)
                    for name in workflows):
                fields["UI.zarr_v3_workflows"] = "Use a JSON list of workflow names, or [] for v2 defaults."

        if section not in ("WORKFLOWS", "MODELS"):
            continue
        prefixes = {workflow_prefix(key) for key in values}
        for name in prefixes:
            field = f"{section}.{name}"
            if not re.fullmatch(r"[a-z0-9][a-z0-9_-]*", name):
                fields[field] = "Workflow names must use lowercase letters, numbers, underscores or hyphens."
                continue
            if not isinstance(values.get(name), str) or not values[name].strip():
                fields[field] = "A workflow requires a nonempty container folder."
            if not valid_repository(values.get(name + "_repo")):
                fields[field + "_repo"] = "Enter a GitHub repository URL, optionally followed by /tree/<ref>."
            job = values.get(name + "_job")
            if not isinstance(job, str) or not job.strip() or re.search(r"[\r\n\x00]", job):
                fields[field + "_job"] = "Enter a nonempty, single-line job script path."
    if fields:
        raise ConfigValidationError(fields)
