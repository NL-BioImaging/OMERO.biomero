import json
import configparser
import sys
import types
import shutil
import tempfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import TestCase
from django.http import JsonResponse


def _ensure_stub_modules():  # Create stubs if external deps missing.
    # omeroweb decorator stub (no-op)
    if "omeroweb.webclient.decorators" not in sys.modules:
        sys.modules.setdefault("omeroweb", types.ModuleType("omeroweb"))
        sys.modules.setdefault(
            "omeroweb.webclient", types.ModuleType("omeroweb.webclient")
        )
        decorators = types.ModuleType("omeroweb.webclient.decorators")

        def login_required(*dargs, **dkwargs):  # pragma: no cover - trivial
            def deco(fn):
                return fn

            return deco

        setattr(decorators, "login_required", login_required)
        sys.modules["omeroweb.webclient.decorators"] = decorators

    # biomero.SlurmClient stub
    if "biomero" not in sys.modules:
        try:
            import biomero
        except ImportError:
            biomero_mod = types.ModuleType("biomero")

            class SlurmClient:  # pragma: no cover - simple stub
                _DEFAULT_CONFIG_PATH_1 = "~/.config/biomero1.ini"
                _DEFAULT_CONFIG_PATH_2 = "~/.config/biomero2.ini"
                _DEFAULT_CONFIG_PATH_3 = "~/.config/biomero3.ini"

            setattr(biomero_mod, "SlurmClient", SlurmClient)
            sys.modules["biomero"] = biomero_mod


def _raw_admin_config():
    """Return the undecorated view function for direct logic testing."""
    from omero_biomero import admin_views

    fn = admin_views.admin_config
    while hasattr(fn, "__wrapped__"):
        fn = fn.__wrapped__
    return fn


def _fake_conn(is_admin=True, user_id=1, username="admin"):
    user = MagicMock()
    user.getName.return_value = username
    user.getId.return_value = user_id
    conn = MagicMock()
    conn.getUser.return_value = user
    conn.isAdmin.return_value = is_admin
    return conn


class AdminConfigTests(TestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        _ensure_stub_modules()

    def setUp(self):  # per-test temp directory
        self._tmpdir = Path(tempfile.mkdtemp(prefix="admin_cfg_test_"))

    def tearDown(self):  # cleanup
        shutil.rmtree(self._tmpdir, ignore_errors=True)

    def test_get_unauthorized(self):
        view = _raw_admin_config()
        request = SimpleNamespace(method="GET")
        resp = view(request, conn=_fake_conn(is_admin=False))
        self.assertIsInstance(resp, JsonResponse)
        self.assertEqual(resp.status_code, 403)
        data = json.loads(resp.content)
        self.assertEqual(data["error"], "Unauthorized request")

    def test_get_success(self):
        SlurmClient = sys.modules["biomero"].SlurmClient  # stub or real
        cfg_path = Path(self._create_tempfile("[SEC]\nkey=value\n"))

        class StubSlurm:
            _DEFAULT_CONFIG_PATH_1 = str(cfg_path)
            _DEFAULT_CONFIG_PATH_2 = str(cfg_path)
            _DEFAULT_CONFIG_PATH_3 = str(cfg_path)

        with patch("omero_biomero.admin_views.SlurmClient", StubSlurm):
            view = _raw_admin_config()
            request = SimpleNamespace(method="GET")
            resp = view(request, conn=_fake_conn())
        self.assertEqual(resp.status_code, 200)
        data = json.loads(resp.content)
        self.assertEqual(data["config"]["SEC"]["key"], "value")

    def test_get_uses_shared_loader_and_reports_config_mode(self):
        parser = configparser.ConfigParser(allow_no_value=True)
        parser.read_string("[SLURM]\ngpu_gres=file-value\n")

        class StubSlurm:
            @classmethod
            def load_config(cls):
                return parser

            @classmethod
            def get_authoritative_config_path(cls):
                return "/managed/slurm-config.ini"

        with patch("omero_biomero.admin_views.SlurmClient", StubSlurm):
            view = _raw_admin_config()
            request = SimpleNamespace(method="GET")
            resp = view(request, conn=_fake_conn())

        self.assertEqual(resp.status_code, 200)
        data = json.loads(resp.content)
        self.assertEqual(data["config"]["SLURM"]["gpu_gres"], "file-value")
        self.assertNotIn("sources", data)
        self.assertEqual(data["config_mode"], "authoritative")

    def test_post_invalid_json(self):
        view = _raw_admin_config()
        request = SimpleNamespace(method="POST", body=b"not-json")
        resp = view(request, conn=_fake_conn())
        self.assertEqual(resp.status_code, 400)
        self.assertIn("Invalid JSON", json.loads(resp.content)["error"])

    def test_post_unauthorized(self):
        payload = {"config": {"GENERAL": {"foo": "bar"}}}
        request = SimpleNamespace(method="POST", body=json.dumps(payload).encode())
        view = _raw_admin_config()
        resp = view(request, conn=_fake_conn(is_admin=False))
        self.assertEqual(resp.status_code, 403)

    def test_post_explicitly_deletes_any_ini_option(self):
        cfg_path = Path(
            self._create_tempfile(
                "[SLURM]\nkeep=value\nremove=value\n"
                "[ANALYTICS]\nremove_too=true\n"
            )
        )

        class StubSlurm:
            @classmethod
            def get_config_write_path(cls):
                return str(cfg_path)

        payload = {
            "config": {"SLURM": {"keep": "value"}},
            "deleted": [
                {"section": "SLURM", "option": "remove"},
                {"section": "ANALYTICS", "option": "remove_too"},
            ],
        }
        with patch("omero_biomero.admin_views.SlurmClient", StubSlurm):
            request = SimpleNamespace(
                method="POST", body=json.dumps(payload).encode()
            )
            resp = _raw_admin_config()(request, conn=_fake_conn())

        self.assertEqual(resp.status_code, 200)
        written = cfg_path.read_text()
        self.assertIn("keep = value", written)
        self.assertNotIn("remove = value", written)
        self.assertNotIn("remove_too", written)

    def test_post_rejects_invalid_explicit_deletion(self):
        cfg_path = Path(self._create_tempfile("[SLURM]\nkeep=value\n"))

        class StubSlurm:
            @classmethod
            def get_config_write_path(cls):
                return str(cfg_path)

        payload = {
            "config": {},
            "deleted": [{"section": "SLURM"}],
        }
        with patch("omero_biomero.admin_views.SlurmClient", StubSlurm):
            request = SimpleNamespace(
                method="POST", body=json.dumps(payload).encode()
            )
            resp = _raw_admin_config()(request, conn=_fake_conn())

        self.assertEqual(resp.status_code, 400)
        self.assertIn("Invalid deletion", json.loads(resp.content)["error"])

    def test_post_explicitly_deletes_json_option(self):
        cfg_path = Path(self._create_tempfile("[SLURM]\nkeep=value\n"))
        json_cfg = self._tmpdir / "biomero-config.json"
        json_cfg.write_text(json.dumps({
            "UPLOADER": {"keep": True, "remove": True},
        }))

        class StubSlurm:
            @classmethod
            def get_config_write_path(cls):
                return str(cfg_path)

        payload = {
            "config": {"UPLOADER": {"keep": True}},
            "deleted": [{"section": "UPLOADER", "option": "remove"}],
        }
        with patch(
            "omero_biomero.admin_views.SlurmClient", StubSlurm
        ), patch(
            "omero_biomero.admin_views.CONFIG_FILE_PATH", str(json_cfg)
        ):
            request = SimpleNamespace(
                method="POST", body=json.dumps(payload).encode()
            )
            resp = _raw_admin_config()(request, conn=_fake_conn())

        self.assertEqual(resp.status_code, 200)
        self.assertEqual(
            json.loads(json_cfg.read_text())["UPLOADER"], {"keep": True}
        )

    def test_post_models_section_add(self):
        SlurmClient = sys.modules["biomero"].SlurmClient
        cfg_path = Path(self._create_tempfile("[MODELS]\n"))

        class StubSlurm:
            _DEFAULT_CONFIG_PATH_1 = "unused"
            _DEFAULT_CONFIG_PATH_2 = "unused"
            _DEFAULT_CONFIG_PATH_3 = str(cfg_path)

        with patch("omero_biomero.admin_views.SlurmClient", StubSlurm):
            payload = {
                "config": {
                    "MODELS": {
                        "cellpose": "/path/cellpose.sif",
                        "cellpose_repo": "https://github.com/example/cellpose",
                        "cellpose_job": "cellpose_job.sh",
                    }
                }
            }
            request = SimpleNamespace(method="POST", body=json.dumps(payload).encode())
            view = _raw_admin_config()
            resp = view(request, conn=_fake_conn())
        self.assertEqual(resp.status_code, 200)
        written = cfg_path.read_text()
        self.assertIn("cellpose_job", written)
        self.assertIn("cellpose_repo", written)
        self.assertIn("(added via web UI)", written)

    def test_post_models_section_remove(self):
        SlurmClient = sys.modules["biomero"].SlurmClient
        existing = "[MODELS]\nold=/path/old.sif\nold_repo=repo\nold_job=job.sh\n"
        cfg_path = Path(self._create_tempfile(existing))

        class StubSlurm:
            _DEFAULT_CONFIG_PATH_1 = "unused"
            _DEFAULT_CONFIG_PATH_2 = "unused"
            _DEFAULT_CONFIG_PATH_3 = str(cfg_path)

        with patch("omero_biomero.admin_views.SlurmClient", StubSlurm):
            payload = {"config": {"MODELS": {}}}
            request = SimpleNamespace(method="POST", body=json.dumps(payload).encode())
            view = _raw_admin_config()
            resp = view(request, conn=_fake_conn())
        self.assertEqual(resp.status_code, 200)
        written = cfg_path.read_text()
        self.assertNotIn("old=", written)

    def test_get_models_section_exposed_as_workflows(self):
        """Legacy [MODELS] in the ini is surfaced to the UI as WORKFLOWS."""
        cfg_path = Path(
            self._create_tempfile("[MODELS]\ncellpose=/path/cellpose.sif\n")
        )

        class StubSlurm:
            _DEFAULT_CONFIG_PATH_1 = str(cfg_path)
            _DEFAULT_CONFIG_PATH_2 = str(cfg_path)
            _DEFAULT_CONFIG_PATH_3 = str(cfg_path)

        with patch("omero_biomero.admin_views.SlurmClient", StubSlurm):
            view = _raw_admin_config()
            request = SimpleNamespace(method="GET")
            resp = view(request, conn=_fake_conn())
        self.assertEqual(resp.status_code, 200)
        data = json.loads(resp.content)
        # UI consistently sees the section as WORKFLOWS, never MODELS.
        self.assertIn("WORKFLOWS", data["config"])
        self.assertNotIn("MODELS", data["config"])
        self.assertEqual(
            data["config"]["WORKFLOWS"]["cellpose"], "/path/cellpose.sif"
        )

    def test_post_workflows_payload_writes_to_existing_models_section(self):
        """A WORKFLOWS payload preserves a legacy [MODELS] section name."""
        SlurmClient = sys.modules["biomero"].SlurmClient
        cfg_path = Path(self._create_tempfile("[MODELS]\n"))

        class StubSlurm:
            _DEFAULT_CONFIG_PATH_1 = "unused"
            _DEFAULT_CONFIG_PATH_2 = "unused"
            _DEFAULT_CONFIG_PATH_3 = str(cfg_path)

        with patch("omero_biomero.admin_views.SlurmClient", StubSlurm):
            payload = {
                "config": {
                    "WORKFLOWS": {
                        "cellpose": "/path/cellpose.sif",
                        "cellpose_repo": "https://github.com/example/cellpose",
                        "cellpose_job": "cellpose_job.sh",
                    }
                }
            }
            request = SimpleNamespace(method="POST", body=json.dumps(payload).encode())
            view = _raw_admin_config()
            resp = view(request, conn=_fake_conn())
        self.assertEqual(resp.status_code, 200)
        written = cfg_path.read_text()
        self.assertIn("[MODELS]", written)
        self.assertNotIn("[WORKFLOWS]", written)
        self.assertIn("cellpose_repo", written)

    def test_post_workflows_payload_writes_to_workflows_section(self):
        """A WORKFLOWS payload writes to an existing [WORKFLOWS] section."""
        SlurmClient = sys.modules["biomero"].SlurmClient
        cfg_path = Path(self._create_tempfile("[WORKFLOWS]\n"))

        class StubSlurm:
            _DEFAULT_CONFIG_PATH_1 = "unused"
            _DEFAULT_CONFIG_PATH_2 = "unused"
            _DEFAULT_CONFIG_PATH_3 = str(cfg_path)

        with patch("omero_biomero.admin_views.SlurmClient", StubSlurm):
            payload = {
                "config": {
                    "WORKFLOWS": {
                        "cellpose": "/path/cellpose.sif",
                        "cellpose_repo": "https://github.com/example/cellpose",
                        "cellpose_job": "cellpose_job.sh",
                    }
                }
            }
            request = SimpleNamespace(method="POST", body=json.dumps(payload).encode())
            view = _raw_admin_config()
            resp = view(request, conn=_fake_conn())
        self.assertEqual(resp.status_code, 200)
        written = cfg_path.read_text()
        self.assertIn("[WORKFLOWS]", written)
        self.assertNotIn("[MODELS]", written)
        self.assertIn("cellpose_repo", written)

    def test_post_workflows_payload_creates_workflows_section_when_absent(self):
        """With no existing workflow section, a WORKFLOWS payload creates [WORKFLOWS]."""
        SlurmClient = sys.modules["biomero"].SlurmClient
        cfg_path = Path(self._create_tempfile("[GENERAL]\nfoo=bar\n"))

        class StubSlurm:
            _DEFAULT_CONFIG_PATH_1 = "unused"
            _DEFAULT_CONFIG_PATH_2 = "unused"
            _DEFAULT_CONFIG_PATH_3 = str(cfg_path)

        with patch("omero_biomero.admin_views.SlurmClient", StubSlurm):
            payload = {
                "config": {
                    "WORKFLOWS": {
                        "cellpose": "/path/cellpose.sif",
                        "cellpose_repo": "https://github.com/example/cellpose",
                        "cellpose_job": "cellpose_job.sh",
                    }
                }
            }
            request = SimpleNamespace(method="POST", body=json.dumps(payload).encode())
            view = _raw_admin_config()
            resp = view(request, conn=_fake_conn())
        self.assertEqual(resp.status_code, 200)
        written = cfg_path.read_text()
        self.assertIn("[WORKFLOWS]", written)
        self.assertNotIn("[MODELS]", written)
        self.assertIn("cellpose_repo", written)

    def test_post_converters_section(self):
        SlurmClient = sys.modules["biomero"].SlurmClient
        cfg_path = Path(self._create_tempfile("[CONVERTERS]\nold=1\n"))

        class StubSlurm:
            _DEFAULT_CONFIG_PATH_1 = "unused"
            _DEFAULT_CONFIG_PATH_2 = "unused"
            _DEFAULT_CONFIG_PATH_3 = str(cfg_path)

        with patch("omero_biomero.admin_views.SlurmClient", StubSlurm):
            payload = {"config": {"CONVERTERS": {"new": "2"}}}
            request = SimpleNamespace(method="POST", body=json.dumps(payload).encode())
            view = _raw_admin_config()
            resp = view(request, conn=_fake_conn())
        self.assertEqual(resp.status_code, 200)
        written = cfg_path.read_text()
        self.assertIn("new = 2", written)
        self.assertNotIn("old = 1", written)

    def test_post_invalid_section_type(self):
        SlurmClient = sys.modules["biomero"].SlurmClient
        cfg_path = Path(self._create_tempfile(""))

        class StubSlurm:
            _DEFAULT_CONFIG_PATH_1 = "unused"
            _DEFAULT_CONFIG_PATH_2 = "unused"
            _DEFAULT_CONFIG_PATH_3 = str(cfg_path)

        with patch("omero_biomero.admin_views.SlurmClient", StubSlurm):
            payload = {"config": {"MODELS": "string-should-error"}}
            request = SimpleNamespace(method="POST", body=json.dumps(payload).encode())
            view = _raw_admin_config()
            with patch("os.path.exists", return_value=False):
                resp = view(request, conn=_fake_conn())
        self.assertEqual(resp.status_code, 400)
        self.assertIn("Invalid configuration format", json.loads(resp.content)["error"])

    def test_post_uploader_settings_saved_to_json_config(self):
        SlurmClient = sys.modules["biomero"].SlurmClient
        cfg_path = Path(self._create_tempfile("[GENERAL]\nfoo=bar\n"))
        json_cfg = self._tmpdir / "biomero-config.json"

        class StubSlurm:
            _DEFAULT_CONFIG_PATH_1 = "unused"
            _DEFAULT_CONFIG_PATH_2 = "unused"
            _DEFAULT_CONFIG_PATH_3 = str(cfg_path)

        with patch("omero_biomero.admin_views.SlurmClient", StubSlurm), patch(
            "omero_biomero.admin_views.CONFIG_FILE_PATH", str(json_cfg)
        ):
            payload = {
                "config": {
                    "UPLOADER": {
                        "enabled": True,
                        "upload_to_group_folder": True,
                    }
                }
            }
            request = SimpleNamespace(method="POST", body=json.dumps(payload).encode())
            view = _raw_admin_config()
            resp = view(request, conn=_fake_conn())

            self.assertEqual(resp.status_code, 200)
            self.assertTrue(json_cfg.exists())
            saved = json.loads(json_cfg.read_text())
            self.assertEqual(
                saved["UPLOADER"],
                {
                    "enabled": True,
                    "upload_to_group_folder": True,
                },
            )

    # Helper to create temporary files in the per-test directory
    def _post_config(self, payload, ini, json_config=None):
        class StubSlurm:
            @classmethod
            def get_config_write_path(cls):
                return str(ini)

        with patch("omero_biomero.admin_views.SlurmClient", StubSlurm), patch(
            "omero_biomero.admin_views.CONFIG_FILE_PATH",
            str(json_config or self._tmpdir / "config.json"),
        ):
            return _raw_admin_config()(
                SimpleNamespace(method="POST", body=json.dumps(payload).encode()),
                conn=_fake_conn(),
            )

    def test_orphaned_v3_is_rejected_without_writing_either_config(self):
        ini = Path(self._create_tempfile('[UI]\nzarr_workflows=[]\n'))
        json_config = self._tmpdir / 'config.json'
        json_config.write_text('{"UPLOADER": {"enabled": false}}')
        before = (ini.read_bytes(), json_config.read_bytes())
        response = self._post_config({'config': {
            'UI': {'zarr_v3_workflows': '["seg"]'},
            'UPLOADER': {'enabled': True},
        }}, ini, json_config)
        self.assertEqual(response.status_code, 400)
        self.assertIn('UI.zarr_v3_workflows', json.loads(response.content)['fields'])
        self.assertEqual((ini.read_bytes(), json_config.read_bytes()), before)

    def test_partial_v3_update_uses_existing_zarr_or_plate_requirement(self):
        for key in ('zarr_workflows', 'plate_workflows'):
            with self.subTest(key=key):
                ini = Path(self._create_tempfile(f'[UI]\n{key}=["seg"]\n'))
                response = self._post_config({'config': {'UI': {'zarr_v3_workflows': '["seg"]'}}}, ini)
                self.assertEqual(response.status_code, 200)

    def test_removing_the_last_requirement_cannot_leave_a_v3_opt_in(self):
        for deletion in (False, True):
            with self.subTest(deletion=deletion):
                ini = Path(self._create_tempfile('[UI]\nzarr_workflows=["seg"]\nzarr_v3_workflows=["seg"]\n'))
                before = ini.read_bytes()
                payload = ({'config': {}, 'deleted': [{'section': 'UI', 'option': 'zarr_workflows'}]}
                           if deletion else {'config': {'UI': {'zarr_workflows': '[]'}}})
                response = self._post_config(payload, ini)
                self.assertEqual(response.status_code, 400)
                self.assertEqual(ini.read_bytes(), before)
                response = self._post_config({'config': {'UI': {
                    'zarr_workflows': '[]', 'zarr_v3_workflows': '[]',
                }}}, ini)
                self.assertEqual(response.status_code, 200)

    def test_empty_workflow_cannot_corrupt_previous_job_or_update_json(self):
        original = (
            "[WORKFLOWS]\ncidenoise=cidenoise\n"
            "cidenoise_repo=https://github.com/example/cidenoise\n"
            "cidenoise_job=jobs/cidenoise.sh\n"
        )
        ini = Path(self._create_tempfile(original))
        json_config = self._tmpdir / "config.json"
        json_config.write_text('{"UPLOADER": {"enabled": false}}')
        before = json_config.read_bytes()
        response = self._post_config({"config": {
            "UPLOADER": {"enabled": True},
            "WORKFLOWS": {"": "", "_repo": "", "_job": ""},
        }}, ini, json_config)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(ini.read_text(), original)
        self.assertEqual(json_config.read_bytes(), before)
        self.assertIn("fields", json.loads(response.content))

    def test_invalid_workflow_fields_are_rejected_without_writes(self):
        valid = {"wf": "wf", "wf_repo": "https://github.com/example/wf",
                 "wf_job": "jobs/wf.sh"}
        cases = [
            {"wf_repo": ""}, {"wf_repo": "https://example.org/wf"},
            {"wf_repo": "https://github.com/example/wf/tree/"},
            {"wf_job": "jobs/wf.sh\n="},
            {"wf_job": "jobs/wf.sh\r="}, {"wf": ""},
            {" bad": "bad"}, {"wf\n[SSH]": "wf"},
        ]
        for updates in cases:
            with self.subTest(updates=updates):
                ini = Path(self._create_tempfile("[WORKFLOWS]\n"))
                response = self._post_config(
                    {"config": {"WORKFLOWS": {**valid, **updates}}}, ini)
                self.assertEqual(response.status_code, 400)
                self.assertEqual(ini.read_text(), "[WORKFLOWS]\n")

    def test_corrected_workflow_repairs_previously_corrupted_job(self):
        ini = Path(self._create_tempfile(
            "[WORKFLOWS]\nwf=wf\nwf_repo=https://github.com/example/wf\n"
            "wf_job=jobs/wf.sh\n =\n_repo=\n_job=\n"))
        response = self._post_config({"config": {"WORKFLOWS": {
            "wf": "wf", "wf_repo": "https://github.com/example/wf",
            "wf_job": "jobs/wf.sh",
        }}}, ini)
        self.assertEqual(response.status_code, 200)
        parsed = configparser.ConfigParser()
        parsed.read(ini)
        self.assertEqual(parsed["WORKFLOWS"]["wf_job"], "jobs/wf.sh")
        self.assertNotIn("_repo", parsed["WORKFLOWS"])

    def test_invalid_ini_does_not_partially_save_json(self):
        ini = Path(self._create_tempfile("[SLURM]\nkeep=value\n"))
        json_config = self._tmpdir / "config.json"
        json_config.write_text('{"UPLOADER": {"enabled": false}}')
        before = json_config.read_bytes()
        response = self._post_config({"config": {
            "UPLOADER": {"enabled": True}, "SLURM": "invalid",
        }}, ini, json_config)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(json_config.read_bytes(), before)

    def test_invalid_serialized_candidate_does_not_write_either_file(self):
        ini = Path(self._create_tempfile("[SLURM]\nkeep=value\n"))
        json_config = self._tmpdir / "config.json"
        json_config.write_text('{"UPLOADER": {"enabled": false}}')
        before = (ini.read_bytes(), json_config.read_bytes())
        with patch("omero_biomero.admin_views.ConfigUpdater.__str__", return_value="[broken"):
            response = self._post_config({"config": {
                "UPLOADER": {"enabled": True}, "SLURM": {"keep": "changed"},
            }}, ini, json_config)
        self.assertEqual(response.status_code, 400)
        self.assertEqual((ini.read_bytes(), json_config.read_bytes()), before)

    def _create_tempfile(self, content: str) -> str:
        f = self._tmpdir / "temp.ini"
        f.write_text(content)
        return str(f)
