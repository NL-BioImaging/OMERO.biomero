import os
import json
import sys
import types
import jwt
from importlib.metadata import PackageNotFoundError
from unittest.mock import MagicMock, patch
from django.test import TestCase, RequestFactory
from django.urls import NoReverseMatch


def _ensure_stubs():
    if "omeroweb.webclient.decorators" not in sys.modules:
        sys.modules.setdefault("omeroweb", types.ModuleType("omeroweb"))
        sys.modules.setdefault(
            "omeroweb.webclient", types.ModuleType("omeroweb.webclient")
        )
        decorators = types.ModuleType("omeroweb.webclient.decorators")

        def login_required(*d, **k):
            def deco(fn):
                return fn

            return deco

        def render_response(*d, **k):
            def deco(fn):
                def wrapper(*a, **kw):
                    return fn(*a, **kw)

                return wrapper

            return deco

        setattr(decorators, "login_required", login_required)
        setattr(decorators, "render_response", render_response)
        sys.modules["omeroweb.webclient.decorators"] = decorators


def _raw_biomero():
    from omero_biomero import biomero_views

    fn = biomero_views.biomero
    # Unwrap stacked decorators (login_required, render_response)
    while hasattr(fn, "__wrapped__"):
        fn = fn.__wrapped__
    return fn


class BiomeroViewTests(TestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        _ensure_stubs()

    def _fake_conn(self, user_id=5, username="alice", is_admin=True):
        user = MagicMock()
        user.getName.return_value = username
        user.getId.return_value = user_id
        conn = MagicMock()
        conn.getUser.return_value = user
        conn.isAdmin.return_value = is_admin
        return conn

    def test_dashboard_renewal_locks_user_and_keeps_short_expiry(self):
        from omero_biomero import biomero_views
        view = biomero_views.refresh_dashboard
        while hasattr(view, "__wrapped__"):
            view = view.__wrapped__
        env = {"METABASE_SITE_URL": "https://mb.example.org/",
               "METABASE_SECRET_KEY": "test-key",
               "METABASE_WORKFLOWS_DB_PAGE_DASHBOARD_ID": "11",
               "METABASE_IMPORTS_DB_PAGE_DASHBOARD_ID": "22"}
        for dashboard, expected in [("workflows", {"user": [0]}), ("imports", {"user_name": ["root"]})]:
            with self.subTest(dashboard=dashboard), patch.dict(os.environ, env), patch("omero_biomero.biomero_views.time.time", return_value=1000):
                response = view(RequestFactory().get("/", {"user": 999, "user_name": "other"}), dashboard,
                                conn=self._fake_conn(user_id=0, username="root"))
                data = json.loads(response.content)
                token = data["url"].rsplit("/", 1)[1]
                payload = jwt.decode(token, "test-key", algorithms=["HS256"], options={"verify_exp": False})
                self.assertEqual(payload["params"], expected)
                self.assertEqual(payload["exp"], 2800)
                self.assertEqual(data["expires"], 2800)
                self.assertEqual(response["Cache-Control"], "no-store")

    def test_dashboard_renewal_rejects_unknown_kind_and_missing_configuration(self):
        from omero_biomero import biomero_views
        view = biomero_views.refresh_dashboard
        while hasattr(view, "__wrapped__"):
            view = view.__wrapped__
        conn = self._fake_conn()
        self.assertEqual(view(RequestFactory().get("/"), "other", conn=conn).status_code, 404)
        self.assertEqual(view(RequestFactory().post("/"), "workflows", conn=conn).status_code, 405)
        with patch.dict(os.environ, {}, clear=True):
            response = view(RequestFactory().get("/"), "workflows", conn=conn)
        self.assertEqual(response.status_code, 503)
        self.assertNotIn("token", response.content.decode())

    def test_biomero_context_basic(self):
        env = {
            "METABASE_SITE_URL": "https://mb.example.org",
            "METABASE_SECRET_KEY": "secret",
            "METABASE_WORKFLOWS_DB_PAGE_DASHBOARD_ID": "11",
            "METABASE_IMPORTS_DB_PAGE_DASHBOARD_ID": "22",
            "IMPORTER_ENABLED": "true",
            "ANALYZER_ENABLED": "false",
            "INTEGRATE_DATA_ANALYSIS": "TRUE",
            "BIOMERO_SHALLOW_ZARR": "true",
        }
        with patch.dict(os.environ, env, clear=False), patch(
            "omero_biomero.biomero_views.get_react_build_file",
            side_effect=lambda n: f"hashed-{n}",
        ), patch(
            "omero_biomero.biomero_views.version", return_value="0.11.0"
        ), patch(
            "omero_biomero.biomero_views.reverse", return_value="/omero_analysis/"
        ):
            ctx = _raw_biomero()(None, conn=self._fake_conn())

        self.assertEqual(ctx["metabase_site_url"], env["METABASE_SITE_URL"])
        self.assertTrue(ctx["importer_enabled"])  # true parsed
        self.assertFalse(ctx["analyzer_enabled"])  # false parsed
        self.assertTrue(ctx["data_analysis_enabled"])
        self.assertTrue(ctx["data_analysis_available"])
        self.assertEqual(ctx["data_analysis_url"], "/omero_analysis/")
        self.assertTrue(ctx["shallow_zarr_enabled"])
        self.assertEqual(ctx["main_js"], "hashed-main.js")
        self.assertEqual(ctx["main_css"], "hashed-main.css")
        self.assertIn(".lif", ctx["uploader_allowed_file_extensions"])
        self.assertNotIn(".xlef", ctx["uploader_allowed_file_extensions"])
        self.assertIsInstance(ctx["metabase_token_monitor_workflows"], str)
        self.assertIsInstance(ctx["metabase_token_imports"], str)
        decoded = jwt.decode(
            ctx["metabase_token_monitor_workflows"],
            env["METABASE_SECRET_KEY"],
            algorithms=["HS256"],
            options={"verify_exp": False},
        )
        self.assertIn("resource", decoded)

    def test_biomero_missing_env_defaults(self):
        # Ensure missing optional env falls back gracefully (tokens will error if key missing)
        with patch.dict(
            os.environ,
            {
                "METABASE_SECRET_KEY": "k",
                "METABASE_WORKFLOWS_DB_PAGE_DASHBOARD_ID": "1",
                "METABASE_IMPORTS_DB_PAGE_DASHBOARD_ID": "2",
            },
            clear=True,
        ), patch(
            "omero_biomero.biomero_views.get_react_build_file",
            return_value="fallback.js",
        ):
            ctx = _raw_biomero()(None, conn=self._fake_conn())
        self.assertEqual(ctx["main_js"], "fallback.js")
        self.assertTrue(ctx["importer_enabled"])  # default True
        self.assertTrue(ctx["analyzer_enabled"])  # default True
        self.assertFalse(ctx["shallow_zarr_enabled"])  # opt-in default
        self.assertFalse(ctx["data_analysis_enabled"])
        self.assertFalse(ctx["data_analysis_available"])

    def test_biomero_reports_missing_analysis_package(self):
        env = {
            "METABASE_SECRET_KEY": "k",
            "METABASE_WORKFLOWS_DB_PAGE_DASHBOARD_ID": "1",
            "METABASE_IMPORTS_DB_PAGE_DASHBOARD_ID": "2",
            "INTEGRATE_DATA_ANALYSIS": "1",
        }
        with patch.dict(os.environ, env, clear=True), patch(
            "omero_biomero.biomero_views.get_react_build_file",
            return_value="fallback.js",
        ), patch(
            "omero_biomero.biomero_views.version",
            side_effect=PackageNotFoundError,
        ):
            ctx = _raw_biomero()(None, conn=self._fake_conn())

        self.assertTrue(ctx["data_analysis_enabled"])
        self.assertFalse(ctx["data_analysis_available"])
        self.assertEqual(ctx["data_analysis_url"], "")
        self.assertIn("not installed", ctx["data_analysis_error"])

    def test_biomero_reports_unregistered_analysis_url(self):
        env = {
            "METABASE_SECRET_KEY": "k",
            "METABASE_WORKFLOWS_DB_PAGE_DASHBOARD_ID": "1",
            "METABASE_IMPORTS_DB_PAGE_DASHBOARD_ID": "2",
            "INTEGRATE_DATA_ANALYSIS": "true",
        }
        with patch.dict(os.environ, env, clear=True), patch(
            "omero_biomero.biomero_views.get_react_build_file",
            return_value="fallback.js",
        ), patch(
            "omero_biomero.biomero_views.version", return_value="0.11.0"
        ), patch(
            "omero_biomero.biomero_views.reverse", side_effect=NoReverseMatch
        ):
            ctx = _raw_biomero()(None, conn=self._fake_conn())

        self.assertFalse(ctx["data_analysis_available"])
        self.assertIn("not registered", ctx["data_analysis_error"])

    def test_biomero_build_file_fallback(self):
        with patch.dict(
            os.environ,
            {
                "METABASE_SECRET_KEY": "k",
                "METABASE_WORKFLOWS_DB_PAGE_DASHBOARD_ID": "3",
                "METABASE_IMPORTS_DB_PAGE_DASHBOARD_ID": "4",
            },
            clear=True,
        ):
            # Use real util but manifest likely absent => returns logical name sans path modifications
            ctx = _raw_biomero()(None, conn=self._fake_conn())
        # If manifest present returns hashed path; otherwise logical name
        self.assertTrue(
            ctx["main_js"].startswith("omero_biomero/assets/main.")
            and ctx["main_js"].endswith(".js")
            or ctx["main_js"] == "main.js"
        )
