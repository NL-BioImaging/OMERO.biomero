"""
Leica file browser package.

Compatibility shim: historically, modules here import siblings with absolute
names (e.g., `from ReadLeicaLIF import ...`). That works when running from a
plain folder on sys.path, but breaks when the app is installed as a package.

To preserve both behaviors without altering the reader modules, we alias the
absolute names to the packaged modules on import.
"""

from importlib import import_module
import sys as _sys

_PKG = __name__  # e.g., 'omero_biomero.leica_file_browser'
_ALIASES = (
    "ReadLeicaLIF",
    "ReadLeicaLOF",
    "ReadLeicaXLEF",
    "ParseLeicaImageXML",
    "ParseLeicaImageXMLLite",
    "CreatePreview",
)

for _name in _ALIASES:
    try:
        _mod = import_module(f"{_PKG}.{_name}")
        _sys.modules.setdefault(_name, _mod)
    except Exception:
        # Defer failures; not all modules are always required
        pass

del import_module, _sys, _PKG, _ALIASES, _name, _mod
