import json
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import TestCase


def _raw(func_name):  # fetch undecorated view
    from omero_biomero import analyzer_views as av

    fn = getattr(av, func_name)
    while hasattr(fn, "__wrapped__"):
        fn = fn.__wrapped__
    return fn


class AnalyzerViewsTests(TestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()

    # Helper: stub SlurmClient context manager
    class _StubSlurmBase:
        slurm_model_images = {"wfA": "img"}
        slurm_model_repos = {"wfA": "https://github.com/org/wfA"}
        _metadata = {"wfA": {"inputs": []}}

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def generic_descriptor_from_github(self, name):
            return self._metadata.get(name, {})

        @classmethod
        def from_config(cls, config_only=True):  # pragma: no cover trivial
            return cls()

    # --- run_workflow_script tests ---
    def test_run_workflow_missing_name(self):
        view = _raw("run_workflow_script")
        request = SimpleNamespace(method="POST", body=json.dumps({}).encode())
        resp = view(request, conn=MagicMock())
        self.assertEqual(resp.status_code, 400)
        self.assertIn("workflow_name is required", resp.content.decode())

    def test_run_workflow_script_not_found(self):
        class StubSlurm(self._StubSlurmBase):
            pass

        # Script service without target script
        svc = MagicMock()
        svc.getScripts.return_value = []
        conn = MagicMock()
        conn.getScriptService.return_value = svc

        with patch("omero_biomero.analyzer_views.SlurmClient", StubSlurm), patch(
            "omero_biomero.analyzer_views.prepare_workflow_parameters",
            lambda *a, **k: {},
        ):
            view = _raw("run_workflow_script")
            payload = {"workflow_name": "wfA", "params": {}}
            request = SimpleNamespace(method="POST", body=json.dumps(payload).encode())
            resp = view(request, conn=conn)
        self.assertEqual(resp.status_code, 404)
        self.assertIn("not found", resp.content.decode())

    def test_run_workflow_script_success(self):
        class StubSlurm(self._StubSlurmBase):
            pass

        # Stub script object
        class Script:
            id = 42

            def getName(self):
                return "SLURM_Run_Workflow.py"

        # Process/job stub
        class Proc:
            class Job:
                _id = 99

            def getJob(self):
                return self.Job()

        svc = MagicMock()
        svc.getScripts.return_value = [Script()]
        svc.runScript.return_value = Proc()
        conn = MagicMock()
        conn.getScriptService.return_value = svc

        params_in = {
            "IDs": [1, 2],
            "Data_Type": "Plate",
            "receiveEmail": True,
            "selectedScreens": ["Segmentation results"],
            "importPlateLabelPreview": True,
            "plateLabelPreviewName": "nuclei",
        }
        with patch.dict(
            "os.environ", {
                "BIOMERO_SHALLOW_ZARR": "true",
                "BIOMERO_DETACHED_WORKFLOWS": "true",
            }
        ), patch(
            "omero_biomero.analyzer_views.SlurmClient", StubSlurm
        ), patch(
            "omero_biomero.analyzer_views.prepare_workflow_parameters",
            lambda *a, **k: params_in,
        ):
            view = _raw("run_workflow_script")
            payload = {"workflow_name": "wfA", "params": params_in}
            # Use a dict subclass that also exposes .modified so the view can
            # write request.session.modified = True (as Django sessions do).
            class _Session(dict):
                modified = False

            request = SimpleNamespace(
                method="POST",
                body=json.dumps(payload).encode(),
                session=_Session(),
            )
            resp = view(request, conn=conn)
        self.assertEqual(resp.status_code, 200)
        data = json.loads(resp.content)
        self.assertEqual(data["status"], "success")
        self.assertEqual(data["executionMode"], "detached")
        self.assertIn("jobId", data)
        # Verify the Activities callback was registered in the session
        self.assertIn("callback", request.session)
        self.assertTrue(
            any(
                v.get("job_type") == "script"
                for v in request.session["callback"].values()
            )
        )
        svc.runScript.assert_called()  # ensure script executed
        import biomero.constants as constants
        sent_inputs = svc.runScript.call_args.args[1]
        from omero.rtypes import unwrap
        self.assertTrue(unwrap(
            sent_inputs[constants.results.IMPORT_PLATE_LABEL_PREVIEW]))
        self.assertEqual(
            unwrap(sent_inputs[constants.results.PLATE_LABEL_PREVIEW_NAME]),
            "nuclei",
        )

    def test_run_workflow_rejects_plate_preview_when_shallow_disabled(self):
        view = _raw("run_workflow_script")
        payload = {
            "workflow_name": "wfA",
            "params": {"importPlateLabelPreview": True},
        }
        request = SimpleNamespace(
            method="POST", body=json.dumps(payload).encode()
        )
        with patch.dict(
            "os.environ", {"BIOMERO_SHALLOW_ZARR": "false"}
        ):
            response = view(request, conn=MagicMock())

        self.assertEqual(response.status_code, 400)
        self.assertIn(
            "requires BIOMERO_SHALLOW_ZARR=true",
            response.content.decode(),
        )

    def test_run_workflow_missing_roi_script_downgrades_to_warning(self):
        from biomero.constants import workflow
        from omero.rtypes import unwrap

        class Script:
            id = 42

            def getName(self):
                return "SLURM_Run_Workflow.py"

        class Proc:
            class Job:
                _id = 99

            def getJob(self):
                return self.Job()

        svc = MagicMock()
        svc.getScripts.return_value = [Script()]
        svc.runScript.return_value = Proc()
        conn = MagicMock()
        conn.getScriptService.return_value = svc
        params = {
            "IDs": [1],
            "Data_Type": "Image",
            "selectedDatasets": ["Results"],
            "createRois": True,
            "roiLabelPattern": "*_cp_masks.tif",
        }

        class _Session(dict):
            modified = False

        request = SimpleNamespace(
            method="POST",
            body=json.dumps({"workflow_name": "wfA", "params": params}).encode(),
            session=_Session(),
        )
        with patch.dict(
            "os.environ", {"BIOMERO_DETACHED_WORKFLOWS": "false"}
        ), patch(
            "omero_biomero.analyzer_views.prepare_workflow_parameters",
            lambda *a, **k: params,
        ):
            resp = _raw("run_workflow_script")(request, conn=conn)

        self.assertEqual(resp.status_code, 200)
        data = json.loads(resp.content)
        self.assertEqual(data["executionMode"], "inline")
        self.assertEqual(data["warnings"][0]["code"], "roi_script_unavailable")
        self.assertFalse(data["effectiveOptions"]["createRois"])
        sent_inputs = svc.runScript.call_args.args[1]
        self.assertFalse(unwrap(sent_inputs[workflow.OUTPUT_CREATE_ROIS]))
        self.assertNotIn(
            workflow.ROI_DELETE_LABEL_IMAGES, sent_inputs)

    def test_run_workflow_plate_roi_request_is_disabled(self):
        from biomero.constants import workflow
        from omero.rtypes import unwrap

        class Script:
            id = 42

            def getName(self):
                return "SLURM_Run_Workflow.py"

        class Proc:
            class Job:
                _id = 99

            def getJob(self):
                return self.Job()

        svc = MagicMock()
        svc.getScripts.return_value = [Script()]
        svc.runScript.return_value = Proc()
        conn = MagicMock()
        conn.getScriptService.return_value = svc
        params = {
            "IDs": [301],
            "Data_Type": "Plate",
            "selectedScreens": ["screen_demo"],
            "selectedScreenId": 51,
            "createRois": True,
            "deleteLabelImagesAfterRois": True,
        }

        class _Session(dict):
            modified = False

        request = SimpleNamespace(
            method="POST",
            body=json.dumps({"workflow_name": "wfA", "params": params}).encode(),
            session=_Session(),
        )
        with patch(
            "omero_biomero.analyzer_views.prepare_workflow_parameters",
            lambda *a, **k: params,
        ):
            resp = _raw("run_workflow_script")(request, conn=conn)

        self.assertEqual(resp.status_code, 200)
        data = json.loads(resp.content)
        self.assertEqual(data["warnings"][0]["code"], "roi_plate_unsupported")
        self.assertFalse(data["effectiveOptions"]["createRois"])
        sent_inputs = svc.runScript.call_args.args[1]
        self.assertFalse(unwrap(sent_inputs[workflow.OUTPUT_CREATE_ROIS]))
        self.assertNotIn(workflow.ROI_DELETE_LABEL_IMAGES, sent_inputs)

    def test_file_output_destination_mode_is_forwarded_to_run_workflow(self):
        from biomero.constants import file_output_targets, workflow
        from omero.rtypes import unwrap

        class Script:
            id = 42

            def getName(self):
                return "SLURM_Run_Workflow.py"

        class Proc:
            class Job:
                _id = 99

            def getJob(self):
                return self.Job()

        svc = MagicMock()
        svc.getScripts.return_value = [Script()]
        svc.runScript.return_value = Proc()
        conn = MagicMock()
        conn.getScriptService.return_value = svc
        params = {
            "IDs": [301],
            "Data_Type": "Plate",
            "selectedScreens": ["screen_demo"],
            "selectedScreenId": 51,
            "attachFileOutputs": True,
            "fileOutputTarget": file_output_targets.INPUT_PARENT,
        }

        class _Session(dict):
            modified = False

        request = SimpleNamespace(
            method="POST",
            body=json.dumps({"workflow_name": "wfA", "params": params}).encode(),
            session=_Session(),
        )
        with patch(
            "omero_biomero.analyzer_views.prepare_workflow_parameters",
            lambda *a, **k: params,
        ):
            resp = _raw("run_workflow_script")(request, conn=conn)

        self.assertEqual(resp.status_code, 200)
        sent_inputs = svc.runScript.call_args.args[1]
        self.assertEqual(
            unwrap(sent_inputs[workflow.OUTPUT_ATTACH_FILE_OUTPUTS_TARGET]),
            file_output_targets.INPUT_PARENT,
        )

    def test_invalid_file_output_destination_is_rejected(self):
        class Script:
            id = 42

            def getName(self):
                return "SLURM_Run_Workflow.py"

        svc = MagicMock()
        svc.getScripts.return_value = [Script()]
        conn = MagicMock()
        conn.getScriptService.return_value = svc
        params = {
            "IDs": [301],
            "Data_Type": "Plate",
            "attachFileOutputs": True,
            "fileOutputTarget": "Screen:51",
        }

        class _Session(dict):
            modified = False

        request = SimpleNamespace(
            method="POST",
            body=json.dumps({"workflow_name": "wfA", "params": params}).encode(),
            session=_Session(),
        )
        with patch(
            "omero_biomero.analyzer_views.prepare_workflow_parameters",
            lambda *a, **k: params,
        ):
            resp = _raw("run_workflow_script")(request, conn=conn)

        self.assertEqual(resp.status_code, 400)

    def test_run_workflow_roi_requires_import_destination(self):
        class Script:
            def __init__(self, script_id, name):
                self.id = script_id
                self.name = name

            def getName(self):
                return self.name

            def getVersion(self):
                return "0.6"

        svc = MagicMock()
        svc.getScripts.return_value = [
            Script(42, "SLURM_Run_Workflow.py"),
            Script(43, "Labels2Rois.py"),
        ]
        conn = MagicMock()
        conn.getScriptService.return_value = svc
        params = {
            "IDs": [1],
            "Data_Type": "Image",
            "createRois": True,
            "roiLabelPattern": "*_cp_masks.tif",
        }
        request = SimpleNamespace(
            method="POST",
            body=json.dumps({"workflow_name": "wfA", "params": params}).encode(),
        )
        with patch(
            "omero_biomero.analyzer_views.prepare_workflow_parameters",
            lambda *a, **k: params,
        ):
            resp = _raw("run_workflow_script")(request, conn=conn)

        self.assertEqual(resp.status_code, 400)
        self.assertIn("Dataset or Screen", resp.content.decode())
        svc.getParams.assert_not_called()

    def test_run_workflow_roi_accepts_automatic_selector(self):
        from biomero.constants import workflow
        from omero.rtypes import unwrap

        class Script:
            def __init__(self, script_id, name):
                self.id = script_id
                self.name = name

            def getName(self):
                return self.name

        class Proc:
            class Job:
                _id = 99

            def getJob(self):
                return self.Job()

        svc = MagicMock()
        svc.getScripts.return_value = [
            Script(42, "SLURM_Run_Workflow.py"),
            Script(43, "Labels2Rois.py"),
        ]
        svc.runScript.return_value = Proc()
        conn = MagicMock()
        conn.getScriptService.return_value = svc
        params = {
            "IDs": [1],
            "Data_Type": "Image",
            "selectedDatasets": ["Results"],
            "createRois": True,
            "deleteLabelImagesAfterRois": True,
            "clearExistingRois": True,
            "clearRoiFilter": "cellpose",
            "roiLabelPattern": "",
            "roiColor": "#e15759",
        }

        class _Session(dict):
            modified = False

        request = SimpleNamespace(
            method="POST",
            body=json.dumps({"workflow_name": "wfA", "params": params}).encode(),
            session=_Session(),
        )
        with patch(
            "omero_biomero.analyzer_views.prepare_workflow_parameters",
            lambda *a, **k: params,
        ):
            resp = _raw("run_workflow_script")(request, conn=conn)

        self.assertEqual(resp.status_code, 200)
        sent_inputs = svc.runScript.call_args.args[1]
        self.assertEqual(
            unwrap(sent_inputs[workflow.ROI_LABEL_PATTERN]), "")
        self.assertTrue(
            unwrap(sent_inputs[workflow.ROI_DELETE_LABEL_IMAGES]))
        self.assertTrue(
            unwrap(sent_inputs[workflow.ROI_CLEAR_EXISTING]))
        self.assertEqual(
            unwrap(sent_inputs[workflow.ROI_CLEAR_FILTER]), "cellpose")
        self.assertEqual(
            unwrap(sent_inputs[workflow.ROI_COLOR]), "#E15759")

    def test_run_workflow_script_invalid_json(self):
        view = _raw("run_workflow_script")
        request = SimpleNamespace(method="POST", body=b"not-json")
        resp = view(request, conn=MagicMock())
        self.assertEqual(resp.status_code, 400)

    def test_run_workflow_rejects_invalid_roi_color(self):
        class Script:
            def __init__(self, script_id, name):
                self.id = script_id
                self.name = name

            def getName(self):
                return self.name

        svc = MagicMock()
        svc.getScripts.return_value = [
            Script(42, "SLURM_Run_Workflow.py"),
            Script(43, "Labels2Rois.py"),
        ]
        conn = MagicMock()
        conn.getScriptService.return_value = svc
        params = {
            "IDs": [1],
            "Data_Type": "Image",
            "selectedDatasets": ["Results"],
            "createRois": True,
            "roiColor": "red",
        }
        request = SimpleNamespace(
            method="POST",
            body=json.dumps({"workflow_name": "wfA", "params": params}).encode(),
        )
        with patch(
            "omero_biomero.analyzer_views.prepare_workflow_parameters",
            lambda *a, **k: params,
        ):
            resp = _raw("run_workflow_script")(request, conn=conn)

        self.assertEqual(resp.status_code, 400)
        self.assertIn("#RRGGBB", resp.content.decode())
        svc.runScript.assert_not_called()

    def test_run_workflow_script_run_exception(self):
        class StubSlurm(self._StubSlurmBase):
            pass

        class Script:
            id = 7

            def getName(self):
                return "SLURM_Run_Workflow.py"

        svc = MagicMock()
        svc.getScripts.return_value = [Script()]
        svc.runScript.side_effect = RuntimeError("boom")
        conn = MagicMock()
        conn.getScriptService.return_value = svc
        with patch("omero_biomero.analyzer_views.SlurmClient", StubSlurm), patch(
            "omero_biomero.analyzer_views.prepare_workflow_parameters",
            lambda *a, **k: {},
        ):
            view = _raw("run_workflow_script")
            payload = {"workflow_name": "wfA", "params": {}}
            request = SimpleNamespace(method="POST", body=json.dumps(payload).encode())
            resp = view(request, conn=conn)
        self.assertEqual(resp.status_code, 500)

    def test_slurm_status_reports_roi_script_capability(self):
        class Script:
            def __init__(self, script_id, name):
                self.id = script_id
                self.name = name

            def getName(self):
                return self.name

        svc = MagicMock()
        svc.getScripts.return_value = [
            Script(42, "SLURM_Run_Workflow.py"),
            Script(43, "Labels2Rois.py"),
        ]
        svc.getParams.return_value = SimpleNamespace(inputs={})
        conn = MagicMock()
        conn.getScriptService.return_value = svc

        response = _raw("get_slurm_status")(
            SimpleNamespace(method="GET"), conn=conn)

        self.assertEqual(response.status_code, 200)
        data = json.loads(response.content)
        self.assertTrue(data["capabilities"]["roi_postprocessing"]["available"])
        svc.getParams.assert_called_once_with(42)

    # --- list_workflows ---
    def test_list_workflows_success(self):
        class StubSlurm(self._StubSlurmBase):
            slurm_model_images = {"wfA": "img", "wfB": "img2"}

        with patch("omero_biomero.analyzer_views.SlurmClient", StubSlurm):
            view = _raw("list_workflows")
            request = SimpleNamespace(method="GET")
            resp = view(request)
        self.assertEqual(resp.status_code, 200)
        data = json.loads(resp.content)
        self.assertCountEqual(data["workflows"], ["wfA", "wfB"])

    def test_list_workflows_error(self):
        class StubSlurmError(self._StubSlurmBase):
            def __enter__(self):
                raise RuntimeError("fail")

        with patch("omero_biomero.analyzer_views.SlurmClient", StubSlurmError):
            view = _raw("list_workflows")
            request = SimpleNamespace(method="GET")
            resp = view(request)
        self.assertEqual(resp.status_code, 500)

    # --- get_workflow_metadata ---
    def test_get_workflow_metadata_missing(self):
        view = _raw("get_workflow_metadata")
        request = SimpleNamespace(method="GET", GET={}, headers={})
        resp = view(request)
        self.assertEqual(resp.status_code, 400)

    def test_get_workflow_metadata_not_found(self):
        class StubSlurm(self._StubSlurmBase):
            slurm_model_images = {"other": "img"}

        with patch("omero_biomero.analyzer_views.SlurmClient", StubSlurm):
            view = _raw("get_workflow_metadata")
            request = SimpleNamespace(method="GET", GET={}, headers={})
            resp = view(request, name="wfA")
        self.assertEqual(resp.status_code, 404)

    def test_get_workflow_metadata_success(self):
        class StubSlurm(self._StubSlurmBase):
            slurm_model_images = {"wfA": "img"}
            _metadata = {
                "wfA": {"inputs": [{"id": "p1", "type": "Number", "default-value": 1}]}
            }

        with patch("omero_biomero.analyzer_views.SlurmClient", StubSlurm):
            view = _raw("get_workflow_metadata")
            request = SimpleNamespace(method="GET", GET={}, headers={})
            resp = view(request, name="wfA")
        self.assertEqual(resp.status_code, 200)
        data = json.loads(resp.content)
        self.assertIn("inputs", data)
        self.assertIn("githubUrl", data)

    # GitHub URL is provided by get_workflow_metadata in field 'githubUrl'

    # --- get_workflows (script menu) ---
    def test_get_workflows_mixed(self):
        # Build a fake connection
        scriptService = MagicMock()
        # First valid, second missing (None), third raises on getParams
        params_obj = SimpleNamespace(
            name="Script_One",
            description="Desc",
            authors=["Alice", "Bob"],
            version="1.0",
        )

        def getParams_side(script_id):
            if script_id == 10:
                return params_obj
            if script_id == 30:
                raise RuntimeError("oops")
            return None

        scriptService.getParams.side_effect = getParams_side
        conn = MagicMock()
        conn.getScriptService.return_value = scriptService

        # getObject returns script-like object for id 10 & 30, None for 20
        class ScriptObj:
            def __init__(self, name):
                self.name = name

        def getObject_side(_typ, sid):
            if sid == 10:
                return ScriptObj("Script_One")
            if sid == 30:
                return ScriptObj("Script_Three")
            return None

        conn.getObject.side_effect = getObject_side
        view = _raw("get_workflows")
        request = SimpleNamespace(method="GET", GET={"script_ids": "10,20,30"})
        resp = view(request, conn=conn)
        self.assertEqual(resp.status_code, 200)
        data = json.loads(resp.content)
        self.assertEqual(len(data["script_menu"]), 2)  # two scripts resolved
        self.assertTrue(any(s["name"] == "Script One" for s in data["script_menu"]))
        self.assertGreaterEqual(len(data["error_logs"]), 1)  # at least one error

    # --- prepare_workflow_parameters ---
    def test_prepare_workflow_parameters_type_conversion(self):
        from omero_biomero.analyzer_views import prepare_workflow_parameters

        class StubSlurm(self._StubSlurmBase):
            slurm_model_images = {"wfA": "img"}
            _metadata = {
                "wfA": {
                    "inputs": [
                        {"id": "p_int", "type": "Number", "default-value": 1},
                        {"id": "p_float", "type": "Number", "default-value": 1.0},
                        {"id": "other", "type": "String", "default-value": "x"},
                    ]
                }
            }

        with patch("omero_biomero.analyzer_views.SlurmClient", StubSlurm):
            params = {"p_int": "5", "p_float": "2.5", "other": "val"}
            converted = prepare_workflow_parameters("wfA", params)
        self.assertIsInstance(converted["p_int"], int)
        self.assertIsInstance(converted["p_float"], float)
        self.assertEqual(converted["other"], "val")
