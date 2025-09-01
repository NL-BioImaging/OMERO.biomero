import os
import sys
import json
import uuid as _uuid
import types
import shutil
from typing import Any
from unittest.mock import MagicMock
from django.test import TestCase, RequestFactory
from django.http import JsonResponse

_INGEST_LOG = []


def _ensure_stubs():
    if "omeroweb.webclient.decorators" not in sys.modules:
        sys.modules.setdefault("omeroweb", types.ModuleType("omeroweb"))
        sys.modules.setdefault(
            "omeroweb.webclient", types.ModuleType("omeroweb.webclient")
        )
        dec = types.ModuleType("omeroweb.webclient.decorators")

        def login_required(*a, **k):
            def wrap(fn):
                return fn

            return wrap

        def render_response(*a, **k):
            # In production this turns dict into template response; tests keep dict
            def wrap(fn):
                return fn

            return wrap

        dec.login_required = login_required  # type: ignore[attr-defined]
        dec.render_response = render_response  # type: ignore[attr-defined]
        sys.modules["omeroweb.webclient.decorators"] = dec

    if "omero_adi.utils.ingest_tracker" not in sys.modules:
        pkg = types.ModuleType("omero_adi")
        utils_pkg = types.ModuleType("omero_adi.utils")
        ing = types.ModuleType("omero_adi.utils.ingest_tracker")

        def initialize_ingest_tracker(cfg):
            return True

        def log_ingestion_step(order, stage):
            _INGEST_LOG.append((order, stage))

        ing.initialize_ingest_tracker = initialize_ingest_tracker  # type: ignore[attr-defined]
        ing.log_ingestion_step = log_ingestion_step  # type: ignore[attr-defined]
        ing.STAGE_NEW_ORDER = "NEW_ORDER"  # type: ignore[attr-defined]
        sys.modules["omero_adi"] = pkg
        sys.modules["omero_adi.utils"] = utils_pkg
        sys.modules["omero_adi.utils.ingest_tracker"] = ing


def _import_module():
    import importlib

    name = "omero_biomero.importer_views"
    if name in sys.modules:
        return importlib.reload(sys.modules[name])
    return importlib.import_module(name)


def _raw(fn):
    return fn


class ImporterViewsTests(TestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        _ensure_stubs()

    def setUp(self):
        self.tmp = os.path.abspath(self._mk_tmp())
        _INGEST_LOG.clear()
        self.conn = self._fake_conn(["grp1", "grp2"], admin=True)
        self.factory = RequestFactory()
        self.mod = _import_module()
        # Patch constants dynamically
        setattr(self.mod, "BASE_DIR", self.tmp)  # type: ignore[attr-defined]
        setattr(self.mod, "FILE_OR_EXTENSION_PATTERNS_EXCLUSIVE", ["experiment.db", ".xlef"])  # type: ignore[attr-defined]
        setattr(self.mod, "PREPROCESSING_EXTENSION_MAP", {".lif": "leica_uuid", ".db": "screen_db"})  # type: ignore[attr-defined]
        setattr(
            self.mod,
            "PREPROCESSING_CONFIG",
            {
                "leica_uuid": {
                    "container": "leica:latest",
                    "extra_params": {"image_uuid": "{UUID}"},
                },
                "screen_db": {
                    "container": "screen:latest",
                    "extra_params": {"saveoption": "single"},
                },
            },
        )  # type: ignore[attr-defined]

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    # Helpers
    def _mk_tmp(self):
        p = os.path.join(os.getcwd(), f"tmp_importer_{_uuid.uuid4().hex}")
        os.makedirs(p, exist_ok=True)
        return p

    def _fake_conn(self, groups, admin=False, user_id=5, username="alice"):
        user = MagicMock()
        user.getName.return_value = username
        user.getId.return_value = user_id
        grp_objs = []
        for g in groups:
            go = MagicMock()
            go.getName.return_value = g
            grp_objs.append(go)
        conn = MagicMock()
        conn.getUser.return_value = user
        conn.getGroupsMemberOf.return_value = grp_objs
        conn.isAdmin.return_value = admin
        return conn

    def _call_get_folder(self, params=None, expect_ok=True):
        req = self.factory.get("/importer/get_folder_contents", data=params or {})
        res = _raw(self.mod.get_folder_contents)(req, conn=self.conn)
        if isinstance(res, dict):
            return res
        # Some environments may still yield JsonResponse; decode if so
        if isinstance(res, JsonResponse):
            try:
                data = json.loads(res.content.decode("utf-8"))
                return data
            except Exception:
                pass
        if expect_ok:
            self.fail(
                f"Expected dict/JsonResponse with JSON, got {type(res)} -> {getattr(res, 'status_code', 'no-status')} "
            )
        return res

    # get_folder_contents tests
    def test_get_folder_contents_normal_listing(self):
        os.makedirs(os.path.join(self.tmp, "subdir"))
        for name in ["b.txt", "a.txt", "sample.zarr"]:
            open(os.path.join(self.tmp, name), "w").close()
        ctx = self._call_get_folder()
        names = [c["name"] for c in ctx["contents"]]
        self.assertEqual(names, ["subdir", "a.txt", "b.txt", "sample.zarr"])
        self.assertTrue(ctx["contents"][0]["is_folder"])

    def test_get_folder_contents_special_exact(self):
        open(os.path.join(self.tmp, "experiment.db"), "w").close()
        open(os.path.join(self.tmp, "ignore.txt"), "w").close()
        ctx = self._call_get_folder()
        self.assertEqual([c["name"] for c in ctx["contents"]], ["experiment.db"])

    def test_get_folder_contents_duplicate_extension_error(self):
        open(os.path.join(self.tmp, "a.xlef"), "w").close()
        open(os.path.join(self.tmp, "b.xlef"), "w").close()
        resp: Any = self._call_get_folder(expect_ok=False)
        self.assertEqual(getattr(resp, "status_code", None), 400)

    def test_get_folder_contents_conflicting_patterns(self):
        open(os.path.join(self.tmp, "experiment.db"), "w").close()
        open(os.path.join(self.tmp, "c.xlef"), "w").close()
        resp: Any = self._call_get_folder(expect_ok=False)
        self.assertEqual(getattr(resp, "status_code", None), 400)

    def test_get_folder_contents_file_browser_extension(self):
        def stub_browser(
            path, folder_uuid=None, image_uuid=None
        ):  # pragma: no cover - simple stub
            return json.dumps(
                {
                    "children": [
                        {"name": "img1", "uuid": "u1", "type": "Image"},
                        {"name": "FolderA", "uuid": "f1", "type": "Folder"},
                    ]
                }
            )

        setattr(self.mod, "EXTENSION_TO_FILE_BROWSER", {".lif": stub_browser})  # type: ignore[attr-defined]
        open(os.path.join(self.tmp, "test.lif"), "w").close()
        ctx = self._call_get_folder({"item_id": "test.lif"})
        self.assertEqual({c["name"] for c in ctx["contents"]}, {"img1", "FolderA"})

    def test_get_folder_contents_file_browser_uuid_and_folder_flag(self):
        def stub_browser(path, folder_uuid=None, image_uuid=None):  # pragma: no cover
            uid = folder_uuid or image_uuid
            return json.dumps({"children": [{"name": "Only", "uuid": uid or "x", "type": "Image"}]})

        setattr(self.mod, "EXTENSION_TO_FILE_BROWSER", {".lif": stub_browser})  # type: ignore[attr-defined]
        open(os.path.join(self.tmp, "abc.lif"), "w").close()
        ctx = self._call_get_folder({"item_id": "abc.lif#ZZZ", "is_folder": 1})
        self.assertEqual(len(ctx["contents"]), 1)
        self.assertTrue(ctx["contents"][0]["id"].startswith("abc.lif#"))

    def test_get_folder_contents_supported_extension_path(self):
        open(os.path.join(self.tmp, "sample.tif"), "w").close()
        ctx = self._call_get_folder({"item_id": "sample.tif"})
        self.assertEqual(len(ctx["contents"]), 1)
        self.assertFalse(ctx["contents"][0]["is_folder"])

    def test_get_folder_contents_zarr_directory(self):
        os.makedirs(os.path.join(self.tmp, "thing.zarr"))
        ctx = self._call_get_folder({"item_id": "thing.zarr"})
        self.assertEqual(len(ctx["contents"]), 1)
        self.assertFalse(ctx["contents"][0]["is_folder"])

    def test_get_folder_contents_invalid_extension(self):
        open(os.path.join(self.tmp, "bad.ext"), "w").close()
        resp = self._call_get_folder({"item_id": "bad.ext"}, expect_ok=False)
        self.assertEqual(getattr(resp, "status_code", None), 400)

    def test_get_folder_contents_special_extension_only(self):
        def stub_browser(path, folder_uuid=None, image_uuid=None):  # pragma: no cover
            return json.dumps({"children": []})
        setattr(self.mod, "EXTENSION_TO_FILE_BROWSER", {".xlef": stub_browser})  # type: ignore[attr-defined]
        open(os.path.join(self.tmp, "one.xlef"), "w").close()
        open(os.path.join(self.tmp, "ignored.txt"), "w").close()
        ctx = self._call_get_folder()
        self.assertEqual([c["name"] for c in ctx["contents"]], ["one.xlef"])

    # import_selected tests
    def _post_import(self, payload, conn=None):
        req = self.factory.post(
            "/importer/import_selected",
            data=json.dumps(payload),
            content_type="application/json",
        )
        return _raw(self.mod.import_selected)(req, conn=conn or self.conn)

    def test_import_selected_missing_fields(self):
        self.assertEqual(self._post_import({"upload": {}}).status_code, 400)
        self.assertEqual(
            self._post_import({"upload": {"selectedLocal": ["a.txt"]}}).status_code, 400
        )
        self.assertEqual(
            self._post_import(
                {
                    "upload": {
                        "selectedLocal": ["a.txt"],
                        "selectedOmero": [("datasets", 5)],
                    }
                }
            ).status_code,
            400,
        )

    def test_import_selected_group_membership(self):
        payload = {
            "upload": {
                "selectedLocal": ["file1.txt"],
                "selectedOmero": [("datasets", 9)],
                "group": "grp1",
            }
        }
        self.assertEqual(self._post_import(payload).status_code, 200)
        payload["upload"]["group"] = "bad"
        self.assertEqual(self._post_import(payload).status_code, 403)

    def test_import_selected_creates_orders_no_preprocessing(self):
        setattr(self.mod, "PREPROCESSING_EXTENSION_MAP", {})  # type: ignore[attr-defined]
        created = []
        setattr(self.mod, "create_upload_order", lambda order: created.append(order))  # type: ignore[attr-defined]
        payload = {
            "upload": {
                "selectedLocal": ["alpha.txt", "beta.txt"],
                "selectedOmero": [("datasets", 2)],
                "group": "grp1",
            }
        }
        self.assertEqual(self._post_import(payload).status_code, 200)
        self.assertEqual(len(created), 1)
        self.assertEqual(len(created[0]["Files"]), 2)

    def test_import_selected_preprocessing_with_uuid_splitting(self):
        created = []
        setattr(self.mod, "create_upload_order", lambda order: created.append(order))  # type: ignore[attr-defined]
        items = [
            {"localPath": "f1.lif", "uuid": "u1"},
            {"localPath": "f2.lif", "uuid": None},
        ]
        for it in items:
            open(os.path.join(self.tmp, it["localPath"]), "w").close()
        payload = {
            "upload": {
                "selectedLocal": items,
                "selectedOmero": [("datasets", 5)],
                "group": "grp1",
            }
        }
        self.assertEqual(self._post_import(payload).status_code, 200)
        self.assertEqual(len(created), 2)
        uuid_orders = [o for o in created if any("f1.lif" in f for f in o["Files"])]
        self.assertEqual(len(uuid_orders), 1)
        self.assertIn("extra_params", uuid_orders[0])
        self.assertEqual(uuid_orders[0]["extra_params"]["image_uuid"], "u1")

    def test_import_selected_preprocessing_multiple_uuid_only(self):
        created = []
        setattr(self.mod, "create_upload_order", lambda order: created.append(order))  # type: ignore[attr-defined]
        items = [
            {"localPath": "a.lif", "uuid": "U1"},
            {"localPath": "b.lif", "uuid": "U2"},
        ]
        for it in items:
            open(os.path.join(self.tmp, it["localPath"]), "w").close()
        payload = {"upload": {"selectedLocal": items, "selectedOmero": [("datasets", 6)], "group": "grp1"}}
        self.assertEqual(self._post_import(payload).status_code, 200)
        self.assertEqual(len(created), 2)
        self.assertEqual({o["extra_params"]["image_uuid"] for o in created}, {"U1", "U2"})

    def test_import_selected_preprocessing_placeholder_no_uuid(self):
        created = []
        setattr(self.mod, "create_upload_order", lambda order: created.append(order))  # type: ignore[attr-defined]
        items = [
            {"localPath": "a.lif", "uuid": None},
            {"localPath": "b.lif", "uuid": None},
        ]
        for it in items:
            open(os.path.join(self.tmp, it["localPath"]), "w").close()
        payload = {"upload": {"selectedLocal": items, "selectedOmero": [("datasets", 7)], "group": "grp1"}}
        self.assertEqual(self._post_import(payload).status_code, 200)
        self.assertEqual(len(created), 1)
        self.assertNotIn("extra_params", created[0])

    def test_import_selected_preprocessing_without_uuid_placeholder(self):
        self.mod.PREPROCESSING_CONFIG["screen_db"]["extra_params"] = {"saveoption": "single"}  # type: ignore[index]
        created = []
        setattr(self.mod, "create_upload_order", lambda order: created.append(order))  # type: ignore[attr-defined]
        open(os.path.join(self.tmp, "exp.db"), "w").close()
        payload = {
            "upload": {
                "selectedLocal": [{"localPath": "exp.db", "uuid": "ignore"}],
                "selectedOmero": [("screens", 4)],
                "group": "grp2",
            }
        }
        self.assertEqual(self._post_import(payload).status_code, 200)
        self.assertEqual(len(created), 1)
        self.assertNotIn("image_uuid", json.dumps(created[0].get("extra_params", {})))

    def test_import_selected_unknown_destination_type(self):
        created = []
        setattr(self.mod, "create_upload_order", lambda order: created.append(order))  # type: ignore[attr-defined]
        payload = {
            "upload": {
                "selectedLocal": ["file.txt"],
                "selectedOmero": [("weird", 1)],
                "group": "grp1",
            }
        }
        self.assertEqual(self._post_import(payload).status_code, 500)
        self.assertEqual(created, [])

    def test_create_upload_order_and_initialize_adi(self):
        # Ensure logging ingestion step increments
        from omero_biomero import importer_views as iv
        # Replace log_ingestion_step used inside importer_views with capturing stub
        calls = []
        def capturing(order, stage):  # pragma: no cover simple
            calls.append((order, stage))
        # Monkeypatch the symbol imported into module namespace
        setattr(iv, 'log_ingestion_step', capturing)
        iv.create_upload_order({
            "UUID": "123",
            "Files": [],
            "Group": "g",
            "Username": "u",
            "DestinationID": 1,
            "DestinationType": "Dataset",
        })
        self.assertEqual(len(calls), 1)
        # initialize_adi with env
        os.environ["INGEST_TRACKING_DB_URL"] = "sqlite:///file.db"
        iv.initialize_adi()
        # remove env and call again to hit early-return branch
        del os.environ["INGEST_TRACKING_DB_URL"]
        iv.initialize_adi()

    # group_mappings
    def test_group_mappings_get_empty(self):
        cfg = os.path.join(self.tmp, "config.json")
        setattr(self.mod, "CONFIG_FILE_PATH", cfg)  # type: ignore[attr-defined]
        req = self.factory.get("/importer/group_mappings")
        resp = _raw(self.mod.group_mappings)(req, conn=self.conn)
        self.assertEqual(json.loads(resp.content)["mappings"], {})

    def test_group_mappings_post_and_get(self):
        cfg = os.path.join(self.tmp, "config.json")
        setattr(self.mod, "CONFIG_FILE_PATH", cfg)  # type: ignore[attr-defined]
        non_admin = self._fake_conn(["grp1"], admin=False)
        bad = self.factory.post(
            "/importer/group_mappings",
            data=json.dumps({"mappings": {"a": "b"}}),
            content_type="application/json",
        )
        self.assertEqual(
            _raw(self.mod.group_mappings)(bad, conn=non_admin).status_code, 403
        )
        good = self.factory.post(
            "/importer/group_mappings",
            data=json.dumps({"mappings": {"g1": "labA", "g2": "labB"}}),
            content_type="application/json",
        )
        self.assertEqual(
            _raw(self.mod.group_mappings)(good, conn=self.conn).status_code, 200
        )
        get_req = self.factory.get("/importer/group_mappings")
        got = _raw(self.mod.group_mappings)(get_req, conn=self.conn)
        self.assertEqual(
            json.loads(got.content)["mappings"], {"g1": "labA", "g2": "labB"}
        )

    def test_group_mappings_post_invalid_json(self):
        cfg = os.path.join(self.tmp, "config.json")
        setattr(self.mod, "CONFIG_FILE_PATH", cfg)  # type: ignore[attr-defined]
        bad = self.factory.generic(
            "POST",
            "/importer/group_mappings",
            data=b"{not json}",
            content_type="application/json",
        )
        resp = _raw(self.mod.group_mappings)(bad, conn=self.conn)
        self.assertEqual(resp.status_code, 400)
