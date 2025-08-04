#!/usr/bin/env python
# -*- coding: utf-8 -*-
from django.urls import path
from . import views

urlpatterns = [
    # Importer URLs
    path(
        "api/importer/import_selected/",
        views.import_selected,
        name="import_selected",
    ),
    path(
        "api/importer/group_mappings/",
        views.group_mappings,
        name="group_mappings",
    ),
    path(
        "api/importer/get_folder_contents/",
        views.get_folder_contents,
        name="get_folder_contents",
    ),
    # Admin URLs
    path(
        "api/biomero/admin/config/",
        views.admin_config,
        name="admin_config",
    ),
    # Biomero/analyze URLs
    path("api/biomero/workflows/", views.list_workflows, name="list_workflows"),
    path(
        "api/biomero/workflows/<str:name>/metadata/",
        views.get_workflow_metadata,
        name="get_workflow_metadata",
    ),
    path(
        "api/biomero/workflows/<str:name>/github/",
        views.get_workflow_github,
        name="get_workflow_github",
    ),
    path(
        "api/biomero/workflows/run/",
        views.run_workflow_script,
        name="run_workflow_script",
    ),
    path("api/biomero/get_workflows/", views.get_workflows, name="get_workflows"),
    # Main Biomero URL
    path(
        "biomero/",
        views.biomero,
        name="biomero",
    ),
]
