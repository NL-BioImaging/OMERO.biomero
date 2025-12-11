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
    # Analyzer API under /api/analyzer/
    path(
        "api/analyzer/workflows/",
        analyzer_views.list_workflows,  # GET
        name="analyzer_workflows_list",
    ),
    path(
        "api/analyzer/workflows/<str:name>/",
        analyzer_views.get_workflow_metadata,  # GET (include repo info in response)
        name="analyzer_workflow_detail",
    ),
    path(
        "api/analyzer/workflows/<str:name>/jobs/",
        analyzer_views.run_workflow_script,  # POST: create job for <name>
        name="analyzer_jobs_create",
    ),
    path(
        "api/analyzer/scripts/",
        analyzer_views.get_workflows,  # GET: legacy script info for menu
        name="analyzer_scripts_list",
    ),
    path(
        "api/analyzer/slurm/status/",
        analyzer_views.get_slurm_status,  # GET: SLURM cluster status
        name="analyzer_slurm_status",
    ),
    # Main Biomero URL
    path(
        "biomero/",
        biomero_views.biomero,
        name="biomero",
    ),
]
