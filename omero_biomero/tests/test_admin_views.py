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
        cfg_path = self._tmpdir / "slurm.ini"

        class StubSlurm:
            @classmethod
            def get_config_write_path(cls):
                return str(cfg_path)

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

    def test_stale_revision_rejects_save_without_overwriting_other_admin(self):
        ini = Path(self._create_tempfile("[SLURM]\nkeep=other-admin\n"))
        response = self._post_config({"revision": "old-revision", "config": {
            "SLURM": {"keep": "my-edit"},
        }}, ini)
        self.assertEqual(response.status_code, 409)
        self.assertEqual(ini.read_text(), "[SLURM]\nkeep=other-admin\n")

    def test_snapshots_keep_original_files_and_editor_identity(self):
        from omero_biomero.config_store import history_directory
        ini = Path(self._create_tempfile("[SLURM]\nkeep=before\n"))
        json_config = self._tmpdir / "config.json"
        json_config.write_text('{"UPLOADER": {"enabled": false}}')
        original_ini = ini.read_bytes().decode("utf-8")
        original_json = json_config.read_bytes().decode("utf-8")
        response = self._post_config({"config": {"SLURM": {"keep": "after"}}}, ini, json_config)
        self.assertEqual(response.status_code, 200)
        snapshots = list(history_directory(ini).glob("*.json"))
        self.assertEqual(len(snapshots), 1)
        snapshot = json.loads(snapshots[0].read_text())
        self.assertEqual(snapshot["ini"], original_ini)
        self.assertEqual(snapshot["json"], original_json)
        self.assertEqual(snapshot["editor"], {"id": 1, "username": "admin"})

    def test_second_file_write_failure_rolls_back_both_files(self):
        from omero_biomero import config_store
        ini = Path(self._create_tempfile("[SLURM]\nkeep=before\n"))
        json_config = self._tmpdir / "config.json"
        json_config.write_text('{"UPLOADER": {"enabled": false}}')
        before = (ini.read_bytes(), json_config.read_bytes())
        replace = config_store.os.replace
        failed = False

        def fail_once(source, destination):
            nonlocal failed
            if str(destination) == str(json_config) and not failed:
                failed = True
                raise OSError("test write failure")
            return replace(source, destination)

        with patch("omero_biomero.config_store.os.replace", side_effect=fail_once):
            response = self._post_config({"config": {
                "SLURM": {"keep": "after"}, "UPLOADER": {"enabled": True},
            }}, ini, json_config)
        self.assertEqual(response.status_code, 500)
        self.assertEqual((ini.read_bytes(), json_config.read_bytes()), before)
        self.assertNotIn("test write failure", response.content.decode())

    def test_file_bind_mounts_remain_writable(self):
        import errno
        from omero_biomero import config_store
        ini = Path(self._create_tempfile("[SLURM]\nkeep=before\n"))
        replace = config_store.os.replace
        def mounted_file(source, destination):
            if str(destination) == str(ini):
                raise OSError(errno.EBUSY, "mount point")
            return replace(source, destination)
        with patch("omero_biomero.config_store.os.replace", side_effect=mounted_file):
            response = self._post_config({"config": {"SLURM": {"keep": "after"}}}, ini)
        self.assertEqual(response.status_code, 200)
        self.assertIn("keep = after", ini.read_text())

    def test_persistent_second_file_failure_still_rolls_back_first_file(self):
        from omero_biomero import config_store
        ini = Path(self._create_tempfile("[SLURM]\nkeep=before\n"))
        json_config = self._tmpdir / "config.json"
        json_config.write_text('{}')
        before = (ini.read_bytes(), json_config.read_bytes())
        replace = config_store.os.replace
        def denied_file(source, destination):
            if str(destination) == str(json_config):
                raise PermissionError("test permanent write failure")
            return replace(source, destination)
        with patch("omero_biomero.config_store.os.replace", side_effect=denied_file):
            response = self._post_config({"config": {
                "SLURM": {"keep": "after"}, "UPLOADER": {"enabled": True},
            }}, ini, json_config)
        self.assertEqual(response.status_code, 500)
        self.assertEqual((ini.read_bytes(), json_config.read_bytes()), before)

    def test_history_remains_available_with_unparseable_ini_and_can_restore(self):
        from omero_biomero import admin_views
        ini = Path(self._create_tempfile("[SLURM]\nkeep=before\n"))
        json_config = self._tmpdir / "config.json"
        self.assertEqual(self._post_config({"config": {"SLURM": {"keep": "after"}}}, ini, json_config).status_code, 200)
        ini.write_text("[broken ini")
        class StubSlurm:
            @classmethod
            def get_config_write_path(cls):
                return str(ini)
            @classmethod
            def from_config(cls, **kwargs):
                raise AssertionError("Recovery must not initialize workflows")
        with patch.object(admin_views, "SlurmClient", StubSlurm), patch.object(admin_views, "CONFIG_FILE_PATH", str(json_config)):
            view = admin_views.admin_config_history
            while hasattr(view, "__wrapped__"):
                view = view.__wrapped__
            response = view(SimpleNamespace(method="GET", GET={}), conn=_fake_conn())
            self.assertEqual(response.status_code, 200)
            history = json.loads(response.content)
            response = view(SimpleNamespace(method="POST", body=json.dumps({
                "snapshot": history["snapshots"][0]["id"], "revision": history["revision"],
            }).encode()), conn=_fake_conn())
        self.assertEqual(response.status_code, 200)
        self.assertEqual(ini.read_text(), "[SLURM]\nkeep=before\n")

    def test_history_is_admin_only(self):
        from omero_biomero import admin_views
        view = admin_views.admin_config_history
        while hasattr(view, "__wrapped__"):
            view = view.__wrapped__
        response = view(SimpleNamespace(method="GET", GET={}), conn=_fake_conn(is_admin=False))
        self.assertEqual(response.status_code, 403)

    def test_history_rejects_path_traversal_and_stale_restore(self):
        from omero_biomero import admin_views
        ini = Path(self._create_tempfile("[SLURM]\nkeep=before\n"))
        original = ini.read_bytes()
        view = admin_views.admin_config_history
        while hasattr(view, "__wrapped__"):
            view = view.__wrapped__
        with patch.object(admin_views, "_config_write_path", return_value=str(ini)), patch.object(
            admin_views, "CONFIG_FILE_PATH", str(self._tmpdir / "config.json")
        ):
            response = view(SimpleNamespace(method="GET", GET={"snapshot": "../../secret"}), conn=_fake_conn())
            self.assertEqual(response.status_code, 400)
            response = view(SimpleNamespace(method="POST", body=json.dumps({
                "snapshot": "a" * 32, "revision": "stale",
            }).encode()), conn=_fake_conn())
            self.assertEqual(response.status_code, 409)
            response = view(SimpleNamespace(method="GET", GET={"snapshot": "current"}), conn=_fake_conn())
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response["Cache-Control"], "no-store")
        self.assertEqual(ini.read_bytes(), original)

    def _create_tempfile(self, content: str) -> str:
        f = self._tmpdir / "temp.ini"
        f.write_text(content)
        return str(f)
