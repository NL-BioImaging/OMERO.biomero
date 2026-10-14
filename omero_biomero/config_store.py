"""Private configuration snapshots and staged writes for the admin editor.

Two files cannot be replaced atomically as a unit. Stage both first, retain
their original bytes, and roll back completed replacements on a write failure.
The caller holds the shared file lock throughout read/validate/write.
"""

import datetime
import errno
import hashlib
import json
import os
from pathlib import Path
import stat
import tempfile
import uuid

from filelock import FileLock


class RevisionConflict(ValueError):
    pass


def config_lock(path):
    directory = history_directory(path)
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(directory, 0o700)
    return FileLock(directory / "config.lock", timeout=10, mode=0o600)


def read_bytes(path):
    try:
        return Path(path).read_bytes()
    except FileNotFoundError:
        return None


def revision(paths):
    digest = hashlib.sha256()
    for path in paths:
        content = read_bytes(path)
        digest.update(b"missing" if content is None else b"present" + str(len(content)).encode() + b":" + content)
    return digest.hexdigest()


def history_directory(path):
    return Path(os.environ.get("OMERO_BIOMERO_CONFIG_HISTORY_DIR") or (str(path) + ".history"))


def _replace(temporary, path, before_inplace=None):
    try:
        os.replace(temporary, path)
    except OSError as error:
        if error.errno != errno.EBUSY:
            raise
        # Docker file bind mounts cannot be renamed. Preserve their inode so
        # workers/importers observing the same mounted file see the update.
        if before_inplace:
            before_inplace()
        with open(temporary, "rb") as source, open(path, "wb") as target:
            target.write(source.read())
            target.flush()
            os.fsync(target.fileno())


def _stage(path, content):
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=".biomero-config-", dir=target.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        if target.exists():
            os.chmod(temporary, stat.S_IMODE(target.stat().st_mode))
        return temporary
    except BaseException:
        os.unlink(temporary)
        raise


def save_files(ini_path, json_path, updates, editor):
    originals = {str(path): read_bytes(path) for path in updates}
    staged = {}
    replaced = []
    try:
        for path, content in updates.items():
            staged[str(path)] = _stage(path, content) if content is not None else None

        # Save both files, including malformed originals, before replacing either.
        directory = history_directory(ini_path)
        directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        os.chmod(directory, 0o700)
        snapshot = {
            "id": uuid.uuid4().hex,
            "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "editor": editor,
            "ini": (read_bytes(ini_path) or b"").decode("utf-8"),
            "json": (read_bytes(json_path) or b"").decode("utf-8"),
            "ini_exists": Path(ini_path).exists(),
            "json_exists": Path(json_path).exists(),
        }
        snapshot_path = directory / (snapshot["id"] + ".json")
        temporary = _stage(snapshot_path, json.dumps(snapshot).encode("utf-8"))
        try:
            os.replace(temporary, snapshot_path)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)

        for path, temporary in staged.items():
            if temporary is None:
                Path(path).unlink(missing_ok=True)
            else:
                # Atomic rename failures leave the target untouched. In-place
                # mount writes need rollback even if they fail partway through.
                _replace(temporary, path, lambda: replaced.append(path))
            if path not in replaced:
                replaced.append(path)
    except BaseException:
        rollback_errors = []
        for path in reversed(replaced):
            try:
                original = originals[path]
                if original is None:
                    Path(path).unlink(missing_ok=True)
                else:
                    temporary = _stage(path, original)
                    try:
                        _replace(temporary, path)
                    finally:
                        if os.path.exists(temporary):
                            os.unlink(temporary)
            except OSError as error:
                rollback_errors.append(error)
        if rollback_errors:
            raise RuntimeError("Rollback failed; previous configuration is retained in history") from rollback_errors[0]
        raise
    finally:
        for temporary in staged.values():
            if temporary is not None and os.path.exists(temporary):
                os.unlink(temporary)
