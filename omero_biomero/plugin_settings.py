import os
from django.conf import settings

# Root folder for imports (L-Drive by default)
IMPORT_MOUNT_PATH = getattr(
    settings,
    "IMPORT_MOUNT_PATH",
    os.environ.get("IMPORT_MOUNT_PATH", "/L-Drive"),
)

# File for persisting group mappings
GROUP_MAPPINGS_FILE = getattr(
    settings,
    "GROUP_MAPPINGS_FILE",
    os.environ.get(
        "GROUP_MAPPINGS_FILE",
        os.path.join(os.path.dirname(__file__), "group_mappings.json"),
    ),
)

# Metabase configuration
METABASE_SITE_URL = getattr(
    settings,
    "METABASE_SITE_URL",
    os.environ.get("METABASE_SITE_URL"),
)
METABASE_SECRET_KEY = getattr(
    settings,
    "METABASE_SECRET_KEY",
    os.environ.get("METABASE_SECRET_KEY"),
)
METABASE_IMPORTS_DB_PAGE_DASHBOARD_ID = getattr(
    settings,
    "METABASE_IMPORTS_DB_PAGE_DASHBOARD_ID",
    os.environ.get("METABASE_IMPORTS_DB_PAGE_DASHBOARD_ID"),
)
METABASE_WORKFLOWS_DB_PAGE_DASHBOARD_ID = getattr(
    settings,
    "METABASE_WORKFLOWS_DB_PAGE_DASHBOARD_ID",
    os.environ.get("METABASE_WORKFLOWS_DB_PAGE_DASHBOARD_ID"),
)

# Ingest tracker DB URL
INGEST_TRACKING_DB_URL = getattr(
    settings,
    "INGEST_TRACKING_DB_URL",
    os.environ.get("INGEST_TRACKING_DB_URL"),
)
