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

        def pull_descriptor_from_github(self, name):
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

        params_in = {"IDs": [1, 2], "Data_Type": "Image", "receiveEmail": True}
        with patch("omero_biomero.analyzer_views.SlurmClient", StubSlurm), patch(
            "omero_biomero.analyzer_views.prepare_workflow_parameters",
            lambda *a, **k: params_in,
        ):
            view = _raw("run_workflow_script")
            payload = {"workflow_name": "wfA", "params": params_in}
            request = SimpleNamespace(method="POST", body=json.dumps(payload).encode())
            resp = view(request, conn=conn)
        self.assertEqual(resp.status_code, 200)
        data = json.loads(resp.content)
        self.assertEqual(data["status"], "success")
        svc.runScript.assert_called()  # ensure script executed

    def test_run_workflow_script_invalid_json(self):
        view = _raw("run_workflow_script")
        request = SimpleNamespace(method="POST", body=b"not-json")
        resp = view(request, conn=MagicMock())
        self.assertEqual(resp.status_code, 400)

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
        request = SimpleNamespace(method="GET")
        resp = view(request)
        self.assertEqual(resp.status_code, 400)

    def test_get_workflow_metadata_not_found(self):
        class StubSlurm(self._StubSlurmBase):
            slurm_model_images = {"other": "img"}

        with patch("omero_biomero.analyzer_views.SlurmClient", StubSlurm):
            view = _raw("get_workflow_metadata")
            request = SimpleNamespace(method="GET")
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
            request = SimpleNamespace(method="GET")
            resp = view(request, name="wfA")
        self.assertEqual(resp.status_code, 200)
        data = json.loads(resp.content)
        self.assertIn("inputs", data)

    # --- get_workflow_github ---
    def test_get_workflow_github_missing(self):
        view = _raw("get_workflow_github")
        request = SimpleNamespace(method="GET")
        resp = view(request)
        self.assertEqual(resp.status_code, 400)

    def test_get_workflow_github_not_found(self):
        class StubSlurm(self._StubSlurmBase):
            slurm_model_repos = {"other": "url"}

        with patch("omero_biomero.analyzer_views.SlurmClient", StubSlurm):
            view = _raw("get_workflow_github")
            request = SimpleNamespace(method="GET")
            resp = view(request, name="wfA")
        self.assertEqual(resp.status_code, 404)

    def test_get_workflow_github_success(self):
        class StubSlurm(self._StubSlurmBase):
            slurm_model_repos = {"wfA": "https://github.com/org/wfA"}

        with patch("omero_biomero.analyzer_views.SlurmClient", StubSlurm):
            view = _raw("get_workflow_github")
            request = SimpleNamespace(method="GET")
            resp = view(request, name="wfA")
        self.assertEqual(resp.status_code, 200)
        data = json.loads(resp.content)
        self.assertIn("url", data)

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
