from django.urls import path
from . import biomero_views, importer_views, admin_views, analyzer_views

urlpatterns = [
    # Importer URLs
    path(
        "api/importer/import_selected/",
        importer_views.import_selected,
        name="import_selected",
    ),
    path(
        "api/importer/group_mappings/",
        importer_views.group_mappings,
        name="group_mappings",
    ),
    path(
        "api/importer/get_folder_contents/",
        importer_views.get_folder_contents,
        name="get_folder_contents",
    ),
    # Admin URLs
    path(
        "api/biomero/admin/config/",
        admin_views.admin_config,
        name="admin_config",
    ),
    # Biomero/analyze URLs
    path(
        "api/biomero/workflows/", analyzer_views.list_workflows, name="list_workflows"
    ),
    path(
        "api/biomero/workflows/<str:name>/metadata/",
        analyzer_views.get_workflow_metadata,
        name="get_workflow_metadata",
    ),
    path(
        "api/biomero/workflows/<str:name>/github/",
        analyzer_views.get_workflow_github,
        name="get_workflow_github",
    ),
    path(
        "api/biomero/workflows/run/",
        analyzer_views.run_workflow_script,
        name="run_workflow_script",
    ),
    path(
        "api/biomero/get_workflows/", analyzer_views.get_workflows, name="get_workflows"
    ),
    # Main Biomero URL
    path(
        "biomero/",
        biomero_views.biomero,
        name="biomero",
    ),
]
