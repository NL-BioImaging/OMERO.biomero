import json
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
                        "cellpose_repo": "https://example.org/cellpose",
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

    # Helper to create temporary files in the per-test directory
    def _create_tempfile(self, content: str) -> str:
        f = self._tmpdir / "temp.ini"
        f.write_text(content)
        return str(f)
