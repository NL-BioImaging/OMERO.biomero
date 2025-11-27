"""
Tests for TUS upload views (tus_views.py).

These tests cover:
- Authentication requirements
- Upload creation (POST)
- Upload status (HEAD)
- Chunk uploads (PATCH)
- Upload cancellation (DELETE)
- Ownership verification
- Duplicate filename handling
- Per-user destination directories
"""

import json
import os
import shutil
import sys
import tempfile
import types
import uuid
from unittest.mock import MagicMock, patch

from django.test import TestCase, RequestFactory
from django.http import HttpResponse


def _ensure_stubs():
    """Set up stub modules for OMERO web dependencies."""
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
            def wrap(fn):
                return fn

            return wrap

        dec.login_required = login_required
        dec.render_response = render_response
        sys.modules["omeroweb.webclient.decorators"] = dec


def _import_module():
    """Import the tus_views module, reloading if already imported."""
    import importlib

    name = "omero_biomero.tus_views"
    if name in sys.modules:
        return importlib.reload(sys.modules[name])
    return importlib.import_module(name)


class TusViewsTestCase(TestCase):
    """Base test case for TUS views with common setup."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        _ensure_stubs()

    def setUp(self):
        """Set up test environment with temporary directories."""
        self.tmp_upload_dir = tempfile.mkdtemp(prefix="tus_test_upload_")
        self.tmp_dest_dir = tempfile.mkdtemp(prefix="tus_test_dest_")

        self.factory = RequestFactory()
        self.mod = _import_module()

        # Patch the directories
        self._orig_upload_dir = self.mod.TUS_UPLOAD_DIR
        self._orig_dest_dir = self.mod.TUS_DESTINATION_DIR
        self.mod.TUS_UPLOAD_DIR = self.tmp_upload_dir
        self.mod.TUS_DESTINATION_DIR = self.tmp_dest_dir

    def tearDown(self):
        """Clean up temporary directories."""
        shutil.rmtree(self.tmp_upload_dir, ignore_errors=True)
        shutil.rmtree(self.tmp_dest_dir, ignore_errors=True)

        # Restore original directories
        self.mod.TUS_UPLOAD_DIR = self._orig_upload_dir
        self.mod.TUS_DESTINATION_DIR = self._orig_dest_dir

    def _make_request(
        self,
        method,
        path="/upload/",
        data=None,
        headers=None,
        authenticated=True,
        user_id=123,
    ):
        """Create a request with optional authentication."""
        headers = headers or {}

        if method == "GET":
            request = self.factory.get(path, **headers)
        elif method == "POST":
            request = self.factory.post(
                path,
                data=data or b"",
                content_type="application/offset+octet-stream",
                **headers,
            )
        elif method == "PATCH":
            request = self.factory.patch(
                path,
                data=data or b"",
                content_type="application/offset+octet-stream",
                **headers,
            )
        elif method == "HEAD":
            request = self.factory.head(path, **headers)
        elif method == "DELETE":
            request = self.factory.delete(path, **headers)
        elif method == "OPTIONS":
            request = self.factory.options(path, **headers)
        else:
            raise ValueError(f"Unknown method: {method}")

        # Set up session
        request.session = {}
        if authenticated:
            request.session["connector"] = MagicMock()
            request.session["user_id"] = user_id

        # Add headers to request.headers (Django 3.2+)
        for key, value in headers.items():
            if key.startswith("HTTP_"):
                header_name = key[5:].replace("_", "-").title()
                if not hasattr(request, "_headers"):
                    request._headers = {}
                request._headers[header_name.lower()] = value

        return request

    def _create_upload(self, filename="test.tif", size=1000, user_id=123):
        """Helper to create an upload and return the resource ID."""
        import base64

        filename_b64 = base64.b64encode(filename.encode()).decode()

        request = self._make_request(
            "POST",
            "/upload/",
            headers={
                "HTTP_UPLOAD_LENGTH": str(size),
                "HTTP_UPLOAD_METADATA": f"filename {filename_b64}",
                "HTTP_TUS_RESUMABLE": "1.0.0",
            },
            user_id=user_id,
        )

        view = self.mod.TusUploadView.as_view()
        response = view(request)

        if response.status_code == 201:
            location = response.get("Location", "")
            resource_id = location.split("/")[-1]
            return resource_id
        return None


class TusAuthenticationTests(TusViewsTestCase):
    """Tests for authentication requirements."""

    def test_options_no_auth_required(self):
        """OPTIONS should work without authentication (CORS preflight)."""
        request = self._make_request("OPTIONS", authenticated=False)
        view = self.mod.TusUploadView.as_view()
        response = view(request)

        self.assertEqual(response.status_code, 204)
        self.assertEqual(response.get("Tus-Resumable"), "1.0.0")
        self.assertIn("POST", response.get("Access-Control-Allow-Methods", ""))

    def test_post_requires_auth(self):
        """POST should require authentication."""
        request = self._make_request(
            "POST",
            headers={
                "HTTP_UPLOAD_LENGTH": "1000",
                "HTTP_TUS_RESUMABLE": "1.0.0",
            },
            authenticated=False,
        )
        view = self.mod.TusUploadView.as_view()
        response = view(request)

        self.assertEqual(response.status_code, 401)
        self.assertIn(b"Authentication required", response.content)

    def test_head_requires_auth(self):
        """HEAD should require authentication."""
        resource_id = self._create_upload()
        self.assertIsNotNone(resource_id)

        request = self._make_request(
            "HEAD", f"/upload/{resource_id}", authenticated=False
        )
        view = self.mod.TusUploadView.as_view()
        response = view(request, resource_id=uuid.UUID(resource_id))

        self.assertEqual(response.status_code, 401)

    def test_patch_requires_auth(self):
        """PATCH should require authentication."""
        resource_id = self._create_upload()
        self.assertIsNotNone(resource_id)

        request = self._make_request(
            "PATCH",
            f"/upload/{resource_id}",
            data=b"chunk data",
            headers={
                "HTTP_UPLOAD_OFFSET": "0",
                "HTTP_TUS_RESUMABLE": "1.0.0",
            },
            authenticated=False,
        )
        view = self.mod.TusUploadView.as_view()
        response = view(request, resource_id=uuid.UUID(resource_id))

        self.assertEqual(response.status_code, 401)

    def test_delete_requires_auth(self):
        """DELETE should require authentication."""
        resource_id = self._create_upload()
        self.assertIsNotNone(resource_id)

        request = self._make_request(
            "DELETE", f"/upload/{resource_id}", authenticated=False
        )
        view = self.mod.TusUploadView.as_view()
        response = view(request, resource_id=uuid.UUID(resource_id))

        self.assertEqual(response.status_code, 401)


class TusOwnershipTests(TusViewsTestCase):
    """Tests for upload ownership verification."""

    def test_head_owner_can_access(self):
        """Owner should be able to check upload status."""
        resource_id = self._create_upload(user_id=100)
        self.assertIsNotNone(resource_id)

        request = self._make_request("HEAD", f"/upload/{resource_id}", user_id=100)
        view = self.mod.TusUploadView.as_view()
        response = view(request, resource_id=uuid.UUID(resource_id))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get("Upload-Offset"), "0")

    def test_head_non_owner_denied(self):
        """Non-owner should be denied access to upload status."""
        resource_id = self._create_upload(user_id=100)
        self.assertIsNotNone(resource_id)

        # Different user tries to access
        request = self._make_request("HEAD", f"/upload/{resource_id}", user_id=999)
        view = self.mod.TusUploadView.as_view()
        response = view(request, resource_id=uuid.UUID(resource_id))

        self.assertEqual(response.status_code, 403)

    def test_patch_owner_can_upload(self):
        """Owner should be able to upload chunks."""
        resource_id = self._create_upload(user_id=100, size=100)
        self.assertIsNotNone(resource_id)

        chunk = b"x" * 50
        request = self._make_request(
            "PATCH",
            f"/upload/{resource_id}",
            data=chunk,
            headers={
                "HTTP_UPLOAD_OFFSET": "0",
                "HTTP_TUS_RESUMABLE": "1.0.0",
            },
            user_id=100,
        )
        view = self.mod.TusUploadView.as_view()
        response = view(request, resource_id=uuid.UUID(resource_id))

        self.assertEqual(response.status_code, 204)
        self.assertEqual(response.get("Upload-Offset"), "50")

    def test_patch_non_owner_denied(self):
        """Non-owner should be denied from uploading chunks."""
        resource_id = self._create_upload(user_id=100, size=100)
        self.assertIsNotNone(resource_id)

        chunk = b"x" * 50
        request = self._make_request(
            "PATCH",
            f"/upload/{resource_id}",
            data=chunk,
            headers={
                "HTTP_UPLOAD_OFFSET": "0",
                "HTTP_TUS_RESUMABLE": "1.0.0",
            },
            user_id=999,
        )
        view = self.mod.TusUploadView.as_view()
        response = view(request, resource_id=uuid.UUID(resource_id))

        self.assertEqual(response.status_code, 403)

    def test_delete_owner_can_cancel(self):
        """Owner should be able to cancel upload."""
        resource_id = self._create_upload(user_id=100)
        self.assertIsNotNone(resource_id)

        request = self._make_request("DELETE", f"/upload/{resource_id}", user_id=100)
        view = self.mod.TusUploadView.as_view()
        response = view(request, resource_id=uuid.UUID(resource_id))

        self.assertEqual(response.status_code, 204)

        # Verify upload is gone
        meta = self.mod.load_metadata(resource_id)
        self.assertIsNone(meta)

    def test_delete_non_owner_denied(self):
        """Non-owner should be denied from cancelling upload."""
        resource_id = self._create_upload(user_id=100)
        self.assertIsNotNone(resource_id)

        request = self._make_request("DELETE", f"/upload/{resource_id}", user_id=999)
        view = self.mod.TusUploadView.as_view()
        response = view(request, resource_id=uuid.UUID(resource_id))

        self.assertEqual(response.status_code, 403)

        # Verify upload still exists
        meta = self.mod.load_metadata(resource_id)
        self.assertIsNotNone(meta)


class TusUploadCreationTests(TusViewsTestCase):
    """Tests for upload creation (POST)."""

    def test_create_upload_success(self):
        """Should create upload with valid parameters."""
        import base64

        filename = "myfile.tif"
        filename_b64 = base64.b64encode(filename.encode()).decode()

        request = self._make_request(
            "POST",
            headers={
                "HTTP_UPLOAD_LENGTH": "5000",
                "HTTP_UPLOAD_METADATA": f"filename {filename_b64}",
                "HTTP_TUS_RESUMABLE": "1.0.0",
            },
        )
        view = self.mod.TusUploadView.as_view()
        response = view(request)

        self.assertEqual(response.status_code, 201)
        self.assertIn("Location", response)
        self.assertEqual(response.get("Tus-Resumable"), "1.0.0")

        # Verify metadata was saved
        location = response.get("Location")
        resource_id = location.split("/")[-1]
        meta = self.mod.load_metadata(resource_id)

        self.assertIsNotNone(meta)
        self.assertEqual(meta["filename"], filename)
        self.assertEqual(meta["length"], 5000)
        self.assertEqual(meta["offset"], 0)
        self.assertEqual(meta["user_id"], 123)  # default user_id in _make_request

    def test_create_upload_missing_length(self):
        """Should reject upload without Upload-Length header."""
        request = self._make_request(
            "POST",
            headers={
                "HTTP_TUS_RESUMABLE": "1.0.0",
            },
        )
        view = self.mod.TusUploadView.as_view()
        response = view(request)

        self.assertEqual(response.status_code, 400)
        self.assertIn(b"Missing Upload-Length", response.content)

    def test_create_upload_invalid_length(self):
        """Should reject upload with invalid Upload-Length."""
        request = self._make_request(
            "POST",
            headers={
                "HTTP_UPLOAD_LENGTH": "not-a-number",
                "HTTP_TUS_RESUMABLE": "1.0.0",
            },
        )
        view = self.mod.TusUploadView.as_view()
        response = view(request)

        self.assertEqual(response.status_code, 400)
        self.assertIn(b"Invalid Upload-Length", response.content)

    def test_create_upload_stores_user_id(self):
        """Should store user ID with upload for ownership verification."""
        resource_id = self._create_upload(user_id=42)
        self.assertIsNotNone(resource_id)

        meta = self.mod.load_metadata(resource_id)
        self.assertEqual(meta["user_id"], 42)


class TusUploadChunkTests(TusViewsTestCase):
    """Tests for chunk upload (PATCH)."""

    def test_upload_single_chunk(self):
        """Should accept a single chunk upload."""
        resource_id = self._create_upload(size=100)
        self.assertIsNotNone(resource_id)

        chunk = b"A" * 100
        request = self._make_request(
            "PATCH",
            f"/upload/{resource_id}",
            data=chunk,
            headers={
                "HTTP_UPLOAD_OFFSET": "0",
                "HTTP_TUS_RESUMABLE": "1.0.0",
            },
        )
        view = self.mod.TusUploadView.as_view()
        response = view(request, resource_id=uuid.UUID(resource_id))

        self.assertEqual(response.status_code, 204)
        self.assertEqual(response.get("Upload-Offset"), "100")

    def test_upload_multiple_chunks(self):
        """Should accept multiple chunk uploads."""
        resource_id = self._create_upload(size=200)
        self.assertIsNotNone(resource_id)

        view = self.mod.TusUploadView.as_view()

        # First chunk
        chunk1 = b"A" * 100
        request1 = self._make_request(
            "PATCH",
            f"/upload/{resource_id}",
            data=chunk1,
            headers={
                "HTTP_UPLOAD_OFFSET": "0",
                "HTTP_TUS_RESUMABLE": "1.0.0",
            },
        )
        response1 = view(request1, resource_id=uuid.UUID(resource_id))
        self.assertEqual(response1.status_code, 204)
        self.assertEqual(response1.get("Upload-Offset"), "100")

        # Second chunk
        chunk2 = b"B" * 100
        request2 = self._make_request(
            "PATCH",
            f"/upload/{resource_id}",
            data=chunk2,
            headers={
                "HTTP_UPLOAD_OFFSET": "100",
                "HTTP_TUS_RESUMABLE": "1.0.0",
            },
        )
        response2 = view(request2, resource_id=uuid.UUID(resource_id))
        self.assertEqual(response2.status_code, 204)
        self.assertEqual(response2.get("Upload-Offset"), "200")

    def test_upload_offset_mismatch(self):
        """Should reject chunk with wrong offset."""
        resource_id = self._create_upload(size=200)
        self.assertIsNotNone(resource_id)

        chunk = b"A" * 100
        request = self._make_request(
            "PATCH",
            f"/upload/{resource_id}",
            data=chunk,
            headers={
                "HTTP_UPLOAD_OFFSET": "50",  # Wrong offset, should be 0
                "HTTP_TUS_RESUMABLE": "1.0.0",
            },
        )
        view = self.mod.TusUploadView.as_view()
        response = view(request, resource_id=uuid.UUID(resource_id))

        self.assertEqual(response.status_code, 409)
        self.assertIn(b"Offset mismatch", response.content)

    def test_upload_missing_offset(self):
        """Should reject chunk without offset header."""
        resource_id = self._create_upload(size=100)
        self.assertIsNotNone(resource_id)

        request = self._make_request(
            "PATCH",
            f"/upload/{resource_id}",
            data=b"chunk",
            headers={
                "HTTP_TUS_RESUMABLE": "1.0.0",
            },
        )
        view = self.mod.TusUploadView.as_view()
        response = view(request, resource_id=uuid.UUID(resource_id))

        self.assertEqual(response.status_code, 400)
        self.assertIn(b"Missing Upload-Offset", response.content)

    def test_upload_not_found(self):
        """Should return 404 for non-existent upload."""
        fake_id = str(uuid.uuid4())

        request = self._make_request(
            "PATCH",
            f"/upload/{fake_id}",
            data=b"chunk",
            headers={
                "HTTP_UPLOAD_OFFSET": "0",
                "HTTP_TUS_RESUMABLE": "1.0.0",
            },
        )
        view = self.mod.TusUploadView.as_view()
        response = view(request, resource_id=uuid.UUID(fake_id))

        self.assertEqual(response.status_code, 404)


class TusUploadFinalizationTests(TusViewsTestCase):
    """Tests for upload finalization and file handling."""

    def test_complete_upload_moves_to_user_directory(self):
        """Completed upload should be moved to user-specific directory."""
        filename = "complete_test.tif"
        file_size = 100
        user_id = 42
        resource_id = self._create_upload(
            filename=filename, size=file_size, user_id=user_id
        )
        self.assertIsNotNone(resource_id)

        # Complete the upload
        chunk = b"X" * file_size
        request = self._make_request(
            "PATCH",
            f"/upload/{resource_id}",
            data=chunk,
            headers={
                "HTTP_UPLOAD_OFFSET": "0",
                "HTTP_TUS_RESUMABLE": "1.0.0",
            },
            user_id=user_id,
        )
        view = self.mod.TusUploadView.as_view()
        response = view(request, resource_id=uuid.UUID(resource_id))

        self.assertEqual(response.status_code, 204)

        # Verify file exists in user-specific directory
        user_dest_dir = os.path.join(self.tmp_dest_dir, f"user_{user_id}")
        dest_path = os.path.join(user_dest_dir, filename)
        self.assertTrue(os.path.exists(dest_path))

        # Verify content
        with open(dest_path, "rb") as f:
            content = f.read()
        self.assertEqual(content, chunk)

        # Verify metadata was cleaned up
        meta = self.mod.load_metadata(resource_id)
        self.assertIsNone(meta)

    def test_different_users_same_filename(self):
        """Different users can upload files with the same name."""
        filename = "shared_name.tif"
        file_size = 50

        # User 1 uploads
        resource_id1 = self._create_upload(
            filename=filename, size=file_size, user_id=100
        )
        chunk1 = b"A" * file_size
        request1 = self._make_request(
            "PATCH",
            f"/upload/{resource_id1}",
            data=chunk1,
            headers={"HTTP_UPLOAD_OFFSET": "0", "HTTP_TUS_RESUMABLE": "1.0.0"},
            user_id=100,
        )
        view = self.mod.TusUploadView.as_view()
        view(request1, resource_id=uuid.UUID(resource_id1))

        # User 2 uploads same filename
        resource_id2 = self._create_upload(
            filename=filename, size=file_size, user_id=200
        )
        chunk2 = b"B" * file_size
        request2 = self._make_request(
            "PATCH",
            f"/upload/{resource_id2}",
            data=chunk2,
            headers={"HTTP_UPLOAD_OFFSET": "0", "HTTP_TUS_RESUMABLE": "1.0.0"},
            user_id=200,
        )
        view(request2, resource_id=uuid.UUID(resource_id2))

        # Verify both files exist in their respective directories
        user1_path = os.path.join(self.tmp_dest_dir, "user_100", filename)
        user2_path = os.path.join(self.tmp_dest_dir, "user_200", filename)

        self.assertTrue(os.path.exists(user1_path))
        self.assertTrue(os.path.exists(user2_path))

        # Verify content is different (no collision)
        with open(user1_path, "rb") as f:
            self.assertEqual(f.read(), chunk1)
        with open(user2_path, "rb") as f:
            self.assertEqual(f.read(), chunk2)

    def test_duplicate_filename_same_user(self):
        """Should handle duplicate filenames from same user by adding counter."""
        filename = "duplicate.tif"
        file_size = 50
        user_id = 42

        # Create first file
        resource_id1 = self._create_upload(
            filename=filename, size=file_size, user_id=user_id
        )
        chunk1 = b"A" * file_size
        request1 = self._make_request(
            "PATCH",
            f"/upload/{resource_id1}",
            data=chunk1,
            headers={"HTTP_UPLOAD_OFFSET": "0", "HTTP_TUS_RESUMABLE": "1.0.0"},
            user_id=user_id,
        )
        view = self.mod.TusUploadView.as_view()
        view(request1, resource_id=uuid.UUID(resource_id1))

        # Create second file with same name
        resource_id2 = self._create_upload(
            filename=filename, size=file_size, user_id=user_id
        )
        chunk2 = b"B" * file_size
        request2 = self._make_request(
            "PATCH",
            f"/upload/{resource_id2}",
            data=chunk2,
            headers={"HTTP_UPLOAD_OFFSET": "0", "HTTP_TUS_RESUMABLE": "1.0.0"},
            user_id=user_id,
        )
        view(request2, resource_id=uuid.UUID(resource_id2))

        # Verify both files exist with different names
        user_dir = os.path.join(self.tmp_dest_dir, f"user_{user_id}")
        self.assertTrue(os.path.exists(os.path.join(user_dir, "duplicate.tif")))
        self.assertTrue(os.path.exists(os.path.join(user_dir, "duplicate_1.tif")))

        # Verify content is different
        with open(os.path.join(user_dir, "duplicate.tif"), "rb") as f:
            self.assertEqual(f.read(), chunk1)
        with open(os.path.join(user_dir, "duplicate_1.tif"), "rb") as f:
            self.assertEqual(f.read(), chunk2)


class TusMetadataTests(TusViewsTestCase):
    """Tests for metadata parsing and storage."""

    def test_parse_metadata_with_base64(self):
        """Should correctly parse base64-encoded metadata."""
        import base64

        filename = "test file with spaces.tif"
        filetype = "image/tiff"

        filename_b64 = base64.b64encode(filename.encode()).decode()
        filetype_b64 = base64.b64encode(filetype.encode()).decode()

        request = self._make_request(
            "POST",
            headers={
                "HTTP_UPLOAD_LENGTH": "1000",
                "HTTP_UPLOAD_METADATA": f"filename {filename_b64},filetype {filetype_b64}",
                "HTTP_TUS_RESUMABLE": "1.0.0",
            },
        )
        view = self.mod.TusUploadView.as_view()
        response = view(request)

        self.assertEqual(response.status_code, 201)

        location = response.get("Location")
        resource_id = location.split("/")[-1]
        meta = self.mod.load_metadata(resource_id)

        self.assertEqual(meta["filename"], filename)
        self.assertEqual(meta["metadata"]["filetype"], filetype)

    def test_metadata_persistence(self):
        """Metadata should persist across requests."""
        resource_id = self._create_upload(filename="persist.tif", size=100)
        self.assertIsNotNone(resource_id)

        # Upload partial chunk
        chunk = b"X" * 50
        request = self._make_request(
            "PATCH",
            f"/upload/{resource_id}",
            data=chunk,
            headers={"HTTP_UPLOAD_OFFSET": "0", "HTTP_TUS_RESUMABLE": "1.0.0"},
        )
        view = self.mod.TusUploadView.as_view()
        view(request, resource_id=uuid.UUID(resource_id))

        # Verify metadata was updated
        meta = self.mod.load_metadata(resource_id)
        self.assertEqual(meta["offset"], 50)
        self.assertEqual(meta["filename"], "persist.tif")
        self.assertEqual(meta["length"], 100)

    def test_load_nonexistent_metadata(self):
        """Loading non-existent metadata should return None."""
        fake_id = str(uuid.uuid4())
        meta = self.mod.load_metadata(fake_id)
        self.assertIsNone(meta)


class TusDeleteTests(TusViewsTestCase):
    """Tests for upload cancellation (DELETE)."""

    def test_delete_removes_chunk_file(self):
        """DELETE should remove the chunk file."""
        resource_id = self._create_upload(size=100)
        self.assertIsNotNone(resource_id)

        # Upload some data
        chunk = b"X" * 50
        request1 = self._make_request(
            "PATCH",
            f"/upload/{resource_id}",
            data=chunk,
            headers={"HTTP_UPLOAD_OFFSET": "0", "HTTP_TUS_RESUMABLE": "1.0.0"},
        )
        view = self.mod.TusUploadView.as_view()
        view(request1, resource_id=uuid.UUID(resource_id))

        # Verify chunk file exists
        chunk_path = os.path.join(self.tmp_upload_dir, resource_id)
        self.assertTrue(os.path.exists(chunk_path))

        # Delete upload
        request2 = self._make_request("DELETE", f"/upload/{resource_id}")
        response = view(request2, resource_id=uuid.UUID(resource_id))

        self.assertEqual(response.status_code, 204)
        self.assertFalse(os.path.exists(chunk_path))

    def test_delete_removes_metadata(self):
        """DELETE should remove the metadata file."""
        resource_id = self._create_upload()
        self.assertIsNotNone(resource_id)

        # Verify metadata exists
        meta = self.mod.load_metadata(resource_id)
        self.assertIsNotNone(meta)

        # Delete upload
        request = self._make_request("DELETE", f"/upload/{resource_id}")
        view = self.mod.TusUploadView.as_view()
        view(request, resource_id=uuid.UUID(resource_id))

        # Verify metadata is gone
        meta = self.mod.load_metadata(resource_id)
        self.assertIsNone(meta)

    def test_delete_nonexistent_upload(self):
        """DELETE on non-existent upload should return 404."""
        fake_id = str(uuid.uuid4())

        request = self._make_request("DELETE", f"/upload/{fake_id}")
        view = self.mod.TusUploadView.as_view()
        response = view(request, resource_id=uuid.UUID(fake_id))

        self.assertEqual(response.status_code, 404)


class TusHeadTests(TusViewsTestCase):
    """Tests for upload status (HEAD)."""

    def test_head_returns_offset(self):
        """HEAD should return current upload offset."""
        resource_id = self._create_upload(size=200)
        self.assertIsNotNone(resource_id)

        # Upload partial data
        chunk = b"X" * 75
        request1 = self._make_request(
            "PATCH",
            f"/upload/{resource_id}",
            data=chunk,
            headers={"HTTP_UPLOAD_OFFSET": "0", "HTTP_TUS_RESUMABLE": "1.0.0"},
        )
        view = self.mod.TusUploadView.as_view()
        view(request1, resource_id=uuid.UUID(resource_id))

        # Check status
        request2 = self._make_request("HEAD", f"/upload/{resource_id}")
        response = view(request2, resource_id=uuid.UUID(resource_id))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get("Upload-Offset"), "75")
        self.assertEqual(response.get("Upload-Length"), "200")

    def test_head_nonexistent_upload(self):
        """HEAD on non-existent upload should return 404."""
        fake_id = str(uuid.uuid4())

        request = self._make_request("HEAD", f"/upload/{fake_id}")
        view = self.mod.TusUploadView.as_view()
        response = view(request, resource_id=uuid.UUID(fake_id))

        self.assertEqual(response.status_code, 404)
