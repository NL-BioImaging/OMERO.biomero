import os
import json
from .leica_file_browser.ci_leica_converters_helpers import read_leica_file

EXTENSION_TO_FILE_BROWSER = {
    ".lif": read_leica_file,
    ".xlef": read_leica_file,
}

# FILE_OR_EXTENSION_PATTERNS_EXCLUSIVE defines patterns that, when
# present in a directory, cause ONLY that matching file to be shown while
# every other sibling entry (files & folders) is hidden from the UI.
# Simple rules (generic & minimal):
#   * Entries starting with a dot are treated as file extensions (".xlef").
#     - If exactly one file with that extension exists -> show only it.
#     - If more than one -> error.
#   * Entries without a leading dot are treated as exact filenames
#     (case-insensitive) e.g. "experiment.db".
#     - If exactly one such file exists -> show only it.
#     - If more than one of the same name -> error.
#   * If two or more DIFFERENT special patterns (e.g. an exact filename AND
#     a special extension, or two different exact filenames) match in the
#     same folder -> error (ambiguous which to display exclusively).
#   * If none match -> normal directory listing.
# Add new patterns sparingly; each must tolerate full-folder hiding semantics.
FILE_OR_EXTENSION_PATTERNS_EXCLUSIVE = [
    "experiment.db",
    ".xlef",
]
# Map file extensions to preprocessing keys. Keys must exist in
# PREPROCESSING_CONFIG. This replaces the earlier generic list and makes
# behavior explicit and extensible. Extensions should be lowercase.
PREPROCESSING_EXTENSION_MAP = {
    ".lif": "dataset_leica_uuid",
    ".xlef": "dataset_leica_uuid",
    ".lof": "dataset_leica_uuid",
    ".db": "screen_db",  # OMERO screen (.db) container conversion
}
FOLDER_EXTENSIONS_NON_BROWSABLE = [
    ".zarr",
]
BASE_DIR = os.getenv("IMPORT_MOUNT_PATH", "/data")

CONFIG_FILE_PATH = os.path.expanduser(
    os.getenv("OMERO_BIOMERO_CONFIG_FILE", "~/.biomero/config.json")
)


def _load_overrides_simple():
    try:
        with open(CONFIG_FILE_PATH, "r", encoding="utf-8") as fh:
            data = json.load(fh)
            return data if isinstance(data, dict) else {}
    except Exception:
        return {}


# Generic preprocessing configuration for uploads (may be overridden).
# Keys correspond to preprocessing identifiers used in importer_views.
# Each entry can define:
#   container: OCI image (with tag) used for preprocessing
#   extra_params: dict of additional parameters.
#       Special placeholder {UUID}: if present in any value AND at least one
#       file has a subfile UUID, separate orders are created per UUID file.
#       For non-UUID files the placeholder is removed (key omitted) and they
#       are optionally batched in one additional order.
# NOTE: I/O paths (inputfile/outputfolder/alt_outputfolder) are fixed in
#       code for now, to keep configuration minimal.
PREPROCESSING_CONFIG = {
    "screen_db": {
        "container": "cellularimagingcf/cimagexpresstoometiff:v0.7",
        "extra_params": {"saveoption": "single"},
    },
    "dataset_leica_uuid": {
        "container": "cellularimagingcf/convertleica-docker:v1.2.0",
        "extra_params": {"image_uuid": "{UUID}"},
    },
    # Add new keys here referencing PREPROCESSING_EXTENSION_MAP as needed.
}

# Apply JSON overrides (if file present) AFTER defaults defined.
_ovr = _load_overrides_simple()
for _k, _typ in {
    "FILE_OR_EXTENSION_PATTERNS_EXCLUSIVE": list,
    "PREPROCESSING_EXTENSION_MAP": dict,
    "PREPROCESSING_CONFIG": dict,
}.items():
    if isinstance(_ovr.get(_k), _typ):
        globals()[_k] = _ovr[_k]

# This is a list of file extensions that are supported by Bio-Formats.
# Generated from:
# https://bio-formats.readthedocs.io/en/latest/_sources/supported-formats.rst.txt
SUPPORTED_FILE_EXTENSIONS = [
    ".1sc",
    ".2",
    ".2fl",
    ".3",
    ".4",
    ".acff",
    ".afi",
    ".afm",
    ".aim",
    ".al3d",
    ".ali",
    ".am",
    ".amiramesh",
    ".apl",
    ".arf",
    ".avi",
    ".bif",
    ".bin",
    ".bip",
    ".bmp",
    ".btf",
    ".c01",
    ".cfg",
    ".ch5",
    ".cif",
    ".com",
    ".cr2",
    ".crw",
    ".csv",
    ".cxd",
    ".czi",
    ".dat",
    ".db",
    ".dcimg",
    ".dcm",
    ".dib",
    ".dicom",
    ".dm2",
    ".dm3",
    ".dm4",
    ".dti",
    ".dv",
    ".eps",
    ".epsi",
    ".exp",
    ".fdf",
    ".fff",
    ".ffr",
    ".fits",
    ".flex",
    ".fli",
    ".frm",
    ".gel",
    ".gif",
    ".grey",
    ".gz",
    ".h5",
    ".hdf",
    ".hdr",
    ".hed",
    ".his",
    ".htd",
    ".html",
    ".hx",
    ".i2i",
    ".ics",
    ".ids",
    ".im3",
    ".img",
    ".ims",
    ".inr",
    ".ipl",
    ".ipm",
    ".ipw",
    ".j2k",
    ".jp2",
    ".jpf",
    ".jpg",
    ".jpk",
    ".jpx",
    ".klb",
    ".l2d",
    ".labels",
    ".lei",
    ".lif",
    ".liff",
    ".lim",
    ".lms",
    ".lof",
    ".lsm",
    ".map",
    ".mdb",
    ".mea",
    ".mnc",
    ".mng",
    ".mod",
    ".mov",
    ".mrc",
    ".mrcs",
    ".mrw",
    ".msr",
    ".mtb",
    ".mvd2",
    ".naf",
    ".nd",
    ".nd2",
    ".ndpi",
    ".ndpis",
    ".nef",
    ".nhdr",
    ".nii",
    ".nrrd",
    ".obf",
    ".obsep",
    ".oib",
    ".oif",
    ".oir",
    ".ome",
    ".omp2info",
    ".par",
    ".pbm",
    ".pcoraw",
    ".pcx",
    ".pds",
    ".pgm",
    ".pic",
    ".pict",
    ".png",
    ".pnl",
    ".ppm",
    ".pr3",
    ".ps",
    ".psd",
    ".qptiff",
    ".r3d",
    ".raw",
    ".rcpnl",
    ".rec",
    ".res",
    ".scn",
    ".sdt",
    ".seq",
    ".sif",
    ".sld",
    ".sldy",
    ".sm2",
    ".sm3",
    ".spc",
    ".spe",
    ".spi",
    ".st",
    ".stk",
    ".stp",
    ".svs",
    ".sxm",
    ".tf2",
    ".tf8",
    ".tfr",
    ".tga",
    ".tif",
    ".tiff",
    ".tnb",
    ".top",
    ".txt",
    ".v",
    ".vff",
    ".vms",
    ".vsi",
    ".vws",
    ".wat",
    ".wpi",
    ".xdce",
    ".xlef",
    ".xml",
    ".xqd",
    ".xqf",
    ".xv",
    ".xys",
    ".zeiss",
    ".zfp",
    ".zfr",
    ".zvi",
]
