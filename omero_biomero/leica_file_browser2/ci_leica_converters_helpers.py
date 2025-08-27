import os
import json
import tempfile
import numpy as np
import xml.etree.ElementTree as ET
import urllib.request
from ReadLeicaLIF import read_leica_lif
from ReadLeicaLOF import read_leica_lof
from ReadLeicaXLEF import read_leica_xlef

def get_image_metadata_LOF(folder_metadata, image_uuid):
    folder_metadata_dict = json.loads(folder_metadata)
    image_metadata_dict = next((img for img in folder_metadata_dict["children"] if img["uuid"] == image_uuid), None)
    image_metadata = read_leica_file(image_metadata_dict['lof_file_path'])
    return image_metadata

def get_image_metadata(folder_metadata, image_uuid):
    folder_metadata_dict = json.loads(folder_metadata)
    image_metadata_dict = next((img for img in folder_metadata_dict["children"] if img["uuid"] == image_uuid), None)
    image_metadata = json.dumps(image_metadata_dict, indent=2)
    return image_metadata

def read_leica_file(file_path, include_xmlelement=False, image_uuid=None, folder_uuid=None):
    """
    Read Leica LIF, XLEF, or LOF file.

    Parameters:
    - file_path: path to the LIF, XLEF, or LOF file
    - include_xmlelement: whether to include the XML element in the lifinfo dictionary
    - image_uuid: optional UUID of an image
    - folder_uuid: optional UUID of a folder/collection

    Returns:
    - If image_uuid is provided:
        - Returns the lifinfo dictionary for the matching image, including detailed metadata.
    - Else if folder_uuid is provided:
        - Returns a single-level XML tree (as a string) of that folder (its immediate children only).
    - Else (no image_uuid or folder_uuid):
        - Returns a single-level XML tree (as a string) of the root/top-level folder(s) or items.
    """
    _, ext = os.path.splitext(file_path)
    ext = ext.lower()

    if ext == '.lif':
        return read_leica_lif(file_path, include_xmlelement, image_uuid, folder_uuid)
    elif ext == '.xlef':
        return read_leica_xlef(file_path, folder_uuid)
    elif ext == '.lof':
        return read_leica_lof(file_path, include_xmlelement)
    else:
        raise ValueError('Unsupported file type: {}'.format(ext))

# --------------------------------------------------------------------------
# Public helper - numpy dtype → pyvips format string
# --------------------------------------------------------------------------
dtype_to_format = {
    np.uint8: "uchar",
    np.int8: "char",
    np.uint16: "ushort",
    np.int16: "short",
    np.uint32: "uint",
    np.int32: "int",
    np.float32: "float",
    np.float64: "double",
    np.complex64: "complex",
    np.complex128: "dpcomplex",
}

# --------------------------------------------------------------------------
# Simple CLI-style progress bar to keep long conversions chatty
# --------------------------------------------------------------------------
def print_progress_bar(progress: float, *, total: float = 100.0, prefix: str = "Progress:",
                       suffix: str = "Complete", length: int = 50, fill: str = "█",
                       final_call: bool = False) -> None:
    """Draw an in-place ASCII progress bar."""
    global _max_suffix_len  # pylint: disable=global-statement

    if "_max_suffix_len" not in globals():
        _max_suffix_len = 0

    progress = min(progress, total)
    _max_suffix_len = max(_max_suffix_len, len(suffix))
    padded_suffix = suffix.ljust(_max_suffix_len)

    percent = progress / total
    filled = int(length * percent)
    bar = fill * filled + "-" * (length - filled)
    print(f"\r{prefix} |{bar}| {percent:.1%} {padded_suffix}", end="", flush=True)

    if final_call:
        print()
        _max_suffix_len = 0

# --------------------------------------------------------------------------
# Metadata helpers - reading Leica JSON produced by ReadLeica* helpers
# --------------------------------------------------------------------------

def _read_xlef_image(xlef_path: str, image_uuid: str) -> dict:
    """Return metadata dict for *one* image UUID inside an XLEF experiment."""
    raw_meta = json.loads(read_leica_xlef(xlef_path))

    def walk(node: dict) -> dict | None:
        if node.get("uuid") == image_uuid and node.get("type", "").lower() == "image":
            return node
        for child in node.get("children", []):
            found = walk(child)
            if found:
                return found
        return None

    # breadth-first search through linked folders
    queue: list[str] = [xlef_path]
    processed_paths = set()  # Avoid infinite loops with circular links
    while queue:
        current = queue.pop(0)
        if current in processed_paths:
            continue
        processed_paths.add(current)

        try:
            meta = json.loads(read_leica_xlef(current))
        except Exception as e:
            print(f"Warning: Could not read linked XLEF '{current}': {e}")
            continue  # Skip unreadable files

        maybe = walk(meta)
        if maybe:
            # Preserve original save_child_name if merging LOF
            original_save_child_name = maybe.get("save_child_name")
            if "lof_file_path" in maybe and maybe["lof_file_path"]:
                try:
                    # merge LOF metadata if present
                    lof_meta = json.loads(read_leica_lof(maybe["lof_file_path"], include_xmlelement=True))
                    maybe.update(lof_meta)
                    # Restore original name if it was overwritten by LOF merge
                    if original_save_child_name is not None:
                        maybe["save_child_name"] = original_save_child_name
                except Exception as e:
                    print(f"Warning: Could not read/merge LOF metadata from '{maybe['lof_file_path']}': {e}")
            # Ensure essential fields exist after potential merge
            maybe.setdefault("filetype", ".xlef")
            maybe.setdefault("LOFFilePath", maybe.get("lof_file_path", current))  # Best guess if LOF failed
            return maybe

        for child in meta.get("children", []):
            if child.get("type", "").lower() == "folder" and child.get("file_path"):
                # Ensure the path is absolute or relative to the current XLEF
                child_path = child["file_path"]
                if not os.path.isabs(child_path):
                    child_path = os.path.join(os.path.dirname(current), child_path)
                if os.path.exists(child_path):  # Check if linked file exists
                    queue.append(os.path.normpath(child_path))
                else:
                    print(f"Warning: Linked XLEF folder path not found: '{child_path}'")

    raise ValueError(f"Image UUID {image_uuid} not found in {xlef_path} or linked XLEFs")

def read_image_metadata(file_path: str, image_uuid: str) -> dict:
    """Front-end that works for .lif / .xlef / .lof."""
    if file_path.endswith(".lif"):
        meta_str = read_leica_lif(file_path, include_xmlelement=True, image_uuid=image_uuid)
        if not meta_str:
            raise ValueError(f"Image UUID {image_uuid} not found in LIF file {file_path}")
        meta = json.loads(meta_str)
        # Ensure essential fields exist
        meta.setdefault("filetype", ".lif")
        meta.setdefault("LIFFile", file_path)
        return meta
    if file_path.endswith(".lof"):
        meta_str = read_leica_lof(file_path, include_xmlelement=True)
        if not meta_str:
            raise ValueError(f"Could not read LOF file {file_path}")
        meta = json.loads(meta_str)
        meta.setdefault("filetype", ".lof")
        meta.setdefault("LOFFilePath", file_path)
        return meta
    if file_path.endswith(".xlef"):
        return _read_xlef_image(file_path, image_uuid)
    raise ValueError(f"Unsupported file type: {file_path}")

def decimal_to_rgb(value: int) -> tuple[int, int, int]:
    r = (value >> 16) & 0xFF   # top byte
    g = (value >> 8)  & 0xFF   # middle byte
    b =  value        & 0xFF   # bottom byte
    return (r, g, b)

def color_name_to_decimal(name: str) -> int:
    css_colors = {
        "aqua": (0, 255, 255),
        "azure": (240, 255, 255),
        "beige": (245, 245, 220),
        "black": (0, 0, 0),
        "blue": (0, 0, 255),
        "blueviolet": (138, 43, 226),
        "brown": (165, 42, 42),
        "cyan": (0, 255, 255),
        "darkblue": (0, 0, 139),
        "darkcyan": (0, 139, 139),
        "darkgray": (169, 169, 169),  "darkgrey": (169, 169, 169),
        "darkgreen": (0, 100, 0),
        "darkmagenta": (139, 0, 139),
        "darkorange": (255, 140, 0),
        "darkred": (139, 0, 0),
        "dimgray": (105, 105, 105),   "dimgrey": (105, 105, 105),
        "gray": (128, 128, 128),       "grey": (128, 128, 128),
        "greenyellow": (173, 255, 47),
        "green": (0, 128, 0),
        "indigo": (75, 0, 130),
        "lightblue": (173, 216, 230),
        "lightcyan": (224, 255, 255),
        "lightgray": (211, 211, 211),  "lightgrey": (211, 211, 211),
        "lightgreen": (144, 238, 144),
        "lightyellow": (255, 255, 224),
        "lime": (0, 255, 0),
        "limegreen": (50, 205, 50),
        "magenta": (255, 0, 255),
        "mediumblue": (0, 0, 205),
        "mediumpurple": (147, 112, 219),
        "orange": (255, 165, 0),
        "orangered": (255, 69, 0),
        "pink": (255, 192, 203),
        "purple": (128, 0, 128),
        "red": (255, 0, 0),
        "silver": (192, 192, 192),
        "tomato": (255, 99, 71),
        "turquoise": (64, 224, 208),
        "violet": (238, 130, 238),
        "white": (255, 255, 255),
        "yellow": (255, 255, 0),
        "yellowgreen": (154, 205, 50)
    }
    r, g, b = css_colors[name.lower()]       # KeyError if unknown
    return (r << 16) | (g << 8) | b

def decimal_to_ome_color(rgb_int: int, alpha: int = 255) -> int:
    r = (rgb_int >> 16) & 0xFF
    g = (rgb_int >> 8)  & 0xFF
    b =  rgb_int        & 0xFF
    unsigned_rgba = (r << 24) | (g << 16) | (b << 8) | (alpha & 0xFF)
    if unsigned_rgba >= 0x80000000:
        signed_rgba = unsigned_rgba - 0x100000000  # Subtract 2**32
    else:
        signed_rgba = unsigned_rgba
    return signed_rgba

XS_NS = {"xs": "http://www.w3.org/2001/XMLSchema"}

def _download(url: str) -> str:
    tmp = tempfile.NamedTemporaryFile(delete=False)
    urllib.request.urlretrieve(url, tmp.name)
    return tmp.name

def _load_schema_tree(url: str, seen: set[str]) -> list[ET.ElementTree]:
    if url in seen:
        return []
    seen.add(url)
    filename = _download(url)
    tree = ET.parse(filename)
    trees = [tree]
    for include in tree.findall(".//xs:include|.//xs:import", XS_NS):
        loc = include.get("schemaLocation")
        if not loc:
            continue
        full_url = urllib.parse.urljoin(url, loc)
        trees.extend(_load_schema_tree(full_url, seen))
    return trees

def parse_ome_xsd(xsd_url: str) -> dict[str, dict]:
    trees = _load_schema_tree(xsd_url, seen=set())
    simple_type_enums: dict[str, list[str]] = {}
    metadata: dict[str, dict] = {}
    for tree in trees:
        for s_type in tree.findall(".//xs:simpleType[@name]", XS_NS):
            name = s_type.get("name")
            enum_vals = [
                e.get("value")
                for e in s_type.findall(".//xs:enumeration", XS_NS)
            ]
            if enum_vals:
                simple_type_enums[name] = enum_vals
    for tree in trees:
        for attr in tree.findall(".//xs:attribute", XS_NS):
            attr_name = attr.get("name")
            if not attr_name:
                continue
            typeref = attr.get("type")
            if typeref in simple_type_enums:
                metadata[attr_name] = {
                    "type": "string",
                    "values": simple_type_enums[typeref],
                }
                continue
            inline_enum = [
                e.get("value")
                for e in attr.findall(".//xs:enumeration", XS_NS)
            ]
            if inline_enum:
                metadata[attr_name] = {
                    "type": "string",
                    "values": inline_enum,
                }
        for c_type in tree.findall(".//xs:complexType[@name]", XS_NS):
            name = c_type.get("name")
            attrs = {
                a.get("name"): a.get("type", "string")
                for a in c_type.findall(".//xs:attribute", XS_NS)
                if a.get("name")
            }
            if attrs:
                metadata[name] = {"type": "complex", "attributes": attrs}
    return metadata

def validate_metadata(value: str, field: str, schema: dict) -> str:
    spec = schema.get(field)
    if not spec or "values" not in spec:
        return "Other"
    cleaned = value.strip().lower()
    for canonical in spec["values"]:
        if cleaned == canonical.lower():
            return canonical
    return "Other"

xsd_url = "http://www.openmicroscopy.org/Schemas/OME/2016-06/ome.xsd"
metadata_schema = parse_ome_xsd(xsd_url)
