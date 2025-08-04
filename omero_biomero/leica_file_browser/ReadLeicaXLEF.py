import os
import json
import xml.etree.ElementTree as ET
from urllib.parse import unquote
from collections import deque
from .ParseLeicaImageXML import parse_image_xml


def read_leica_xlef(file_path, folder_uuid=None):
    """
    Reads a Leica XLEF/.xlcf/.xlif file and attempts to:
      - Return the entire top-level structure if no folder_uuid is specified, or
      - Locate the requested folder_uuid in this file (and its references)
        using a BFS approach.

    Returns a JSON string containing the resulting dictionary.
    """
    file_path = os.path.normpath(file_path)

    if folder_uuid is None:
        result_dict = parse_top_level(file_path)
    else:
        result_dict = bfs_find_uuid(file_path, folder_uuid)

    if result_dict is None:
        result_dict = {}

    return json.dumps(result_dict, indent=2)


def bfs_find_uuid(top_file, folder_uuid):
    if not os.path.exists(top_file):
        return None

    visited = set()
    queue = deque()

    top_ext = top_file.lower().split(".")[-1]
    top_element, top_refs = parse_file_minimal(top_file)
    if top_element is None:
        return None

    top_uuid = top_element.get("UniqueID") or ""
    if folder_uuid and top_uuid == folder_uuid:
        return build_tree_for_element(top_ext, top_element, top_file, top_file)

    visited.add(top_file)
    for ref_file, ref_uuid, ref_ext in top_refs:
        queue.append((ref_file, ref_uuid, ref_ext))

    while queue:
        current_file, current_ref_uuid, current_ext = queue.popleft()
        if not os.path.exists(current_file) or current_file in visited:
            continue
        visited.add(current_file)

        el, refs = parse_file_minimal(current_file)
        if el is None:
            continue

        actual_uuid = el.get("UniqueID")
        if actual_uuid == folder_uuid:
            return build_tree_for_element(current_ext, el, current_file, top_file)

        for rfile, ruuid, rext in refs:
            queue.append((rfile, ruuid, rext))

    return None


def parse_file_minimal(file_path):
    try:
        tree = ET.parse(file_path)
        root = tree.getroot()
    except Exception:
        return None, []

    main_el = root.find(".//Element")
    if main_el is None:
        return None, []

    refs = []
    for ref in root.findall(".//Reference"):
        ref_path = unquote(ref.get("File") or "")
        ref_path = os.path.normpath(os.path.join(os.path.dirname(file_path), ref_path))
        ref_uuid = ref.get("UUID") or ""
        ref_ext = ref_path.lower().split(".")[-1]
        refs.append((ref_path, ref_uuid, ref_ext))

    return main_el, refs


def build_tree_for_element(ext, element, file_path, top_file):
    if ext == "xlif":
        metadata = parse_image_xml(element)
        metadata["XLIFFile"] = file_path

        lof_rel = metadata.get("LOFFile")
        if lof_rel:
            lof_abs_path = os.path.join(os.path.dirname(file_path), unquote(lof_rel))
            metadata["LOFFilePath"] = os.path.normpath(lof_abs_path)

        return metadata
    else:
        return {
            "type": "Folder",
            "name": element.get("Name", ""),
            "uuid": element.get("UniqueID"),
            "children": _build_children_list(element, file_path, top_file),
        }


def parse_top_level(file_path):
    if not os.path.exists(file_path):
        return None

    extension = file_path.lower().split(".")[-1]
    try:
        tree = ET.parse(file_path)
        root = tree.getroot()
    except Exception:
        return None

    top_el = root.find(".//Element")
    if top_el is None:
        return None

    return {
        "type": "File" if extension in ["xlef", "xlcf"] else "Unknown",
        "name": top_el.get("Name", ""),
        "uuid": top_el.get("UniqueID"),
        "children": _build_children_list(top_el, file_path, file_path),
    }


def _build_children_list(element, base_file, top_file):
    children_list = []
    child_elem = element.find("Children")
    if child_elem is None:
        return children_list

    xlef_base_name = os.path.splitext(os.path.basename(top_file))[0]
    xlef_folder = os.path.dirname(top_file)

    for ref in child_elem.findall("Reference"):
        ref_file = unquote(ref.get("File") or "")
        ref_file = os.path.normpath(os.path.join(os.path.dirname(base_file), ref_file))
        ref_uuid = ref.get("UUID") or ""
        ext = ref_file.lower().split(".")[-1]

        ctype = (
            "Folder"
            if ext == "xlcf"
            else "Image" if ext == "xlif" else "File" if ext == "xlef" else "Unknown"
        )

        metadata = get_element_metadata(ref_file, ref_uuid)
        real_child_name = metadata["ElementName"]

        lof_rel = metadata.get("LOFFile")
        metadata["filetype"] = ".lof"
        save_child_name = real_child_name

        if lof_rel:
            lof_abs_path = os.path.join(os.path.dirname(ref_file), unquote(lof_rel))
            metadata["LOFFilePath"] = os.path.normpath(lof_abs_path)
            lof_relative_path = os.path.relpath(lof_abs_path, xlef_folder)
            lof_path_parts = lof_relative_path.split(os.sep)
            lof_path_parts = [
                part for part in lof_path_parts if part not in ("..", ".", "")
            ]
            save_child_name = xlef_base_name + "_" + "_".join(lof_path_parts)
            if save_child_name.lower().endswith(".lof"):
                save_child_name = save_child_name[:-4]

        if real_child_name and real_child_name.lower().startswith("iomanager"):
            continue

        children_list.append(
            {
                "type": ctype,
                "file_path": ref_file,
                "lof_file_path": metadata.get("LOFFilePath", ""),
                "uuid": ref_uuid,
                "name": real_child_name,
                "save_child_name": (
                    save_child_name if metadata["filetype"] == ".lof" else ""
                ),
                "xs": metadata["xs"],
                "ys": metadata["ys"],
                "zs": metadata["zs"],
                "ts": metadata["ts"],
                "tiles": metadata["tiles"],
                "channels": metadata["channels"],
                "isrgb": metadata["isrgb"],
            }
        )

    return children_list


def _build_children_list_old(element, base_file, top_file):
    children_list = []
    child_elem = element.find("Children")
    if child_elem is None:
        return children_list

    for ref in child_elem.findall("Reference"):
        ref_file = unquote(ref.get("File") or "")
        ref_file = os.path.normpath(os.path.join(os.path.dirname(base_file), ref_file))
        ref_uuid = ref.get("UUID") or ""
        ext = ref_file.lower().split(".")[-1]

        ctype = (
            "Folder"
            if ext == "xlcf"
            else "Image" if ext == "xlif" else "File" if ext == "xlef" else "Unknown"
        )

        metadata = get_element_metadata(ref_file, ref_uuid)
        real_child_name = metadata["ElementName"]

        if ext == "xlif":
            xlif_metadata = get_element_metadata(ref_file)
            metadata.update(xlif_metadata)

        children_list.append(
            {
                "type": ctype,
                "file_path": ref_file,
                "uuid": ref_uuid,
                "name": real_child_name,
                "xs": metadata["xs"],
                "ys": metadata["ys"],
                "zs": metadata["zs"],
                "ts": metadata["ts"],
                "tiles": metadata["tiles"],
                "channels": metadata["channels"],
                "isrgb": metadata["isrgb"],
            }
        )

    return children_list


def get_element_metadata(file_path, target_uuid=None):
    if not os.path.exists(file_path):
        return {
            "ElementName": "Unnamed",
            "LOFFile": None,
            "xs": 1,
            "ys": 1,
            "zs": 1,
            "ts": 1,
            "tiles": 1,
            "channels": 1,
            "isrgb": False,
        }

    try:
        tree = ET.parse(file_path)
        root = tree.getroot()
    except Exception:
        return {
            "ElementName": "Unnamed",
            "LOFFile": None,
            "xs": 1,
            "ys": 1,
            "zs": 1,
            "ts": 1,
            "tiles": 1,
            "channels": 1,
            "isrgb": False,
        }

    metadata = {
        "ElementName": "Unnamed",
        "LOFFile": None,
        "xs": 1,
        "ys": 1,
        "zs": 1,
        "ts": 1,
        "tiles": 1,
        "channels": 1,
        "isrgb": False,
    }

    element = (
        root.find(f".//Element[@UniqueID='{target_uuid}']")
        if target_uuid
        else root.find(".//Element")
    )
    if element is not None:
        metadata["ElementName"] = element.get("Name", "Unnamed")

    memory_block = root.find(".//Memory/Block")
    if memory_block is not None:
        block_file = memory_block.attrib.get("File")
        if block_file and block_file.lower().endswith(".lof"):
            metadata["LOFFile"] = block_file

    image_description = root.find(".//ImageDescription")
    if image_description is not None:
        dimensions_element = image_description.find("Dimensions")
        if dimensions_element is not None:
            dim_descriptions = dimensions_element.findall("DimensionDescription")
            for dim_desc in dim_descriptions:
                dim_id = int(dim_desc.attrib.get("DimID", "0"))
                num_elements = int(dim_desc.attrib.get("NumberOfElements", "1"))
                if dim_id == 1:
                    metadata["xs"] = num_elements
                elif dim_id == 2:
                    metadata["ys"] = num_elements
                elif dim_id == 3:
                    metadata["zs"] = num_elements
                elif dim_id == 4:
                    metadata["ts"] = num_elements
                elif dim_id == 10:
                    metadata["tiles"] = num_elements

        channels_element = image_description.find("Channels")
        if channels_element is not None:
            channel_descriptions = channels_element.findall("ChannelDescription")
            metadata["channels"] = len(channel_descriptions)
            if metadata["channels"] > 1:
                channel_tag = channel_descriptions[0].attrib.get("ChannelTag")
                if channel_tag and int(channel_tag) != 0:
                    metadata["isrgb"] = True

    return metadata


def get_element_metadata_old(file_path, target_uuid=None):
    if not os.path.exists(file_path):
        return {"ElementName": "Unnamed", "LOFFile": None}

    try:
        tree = ET.parse(file_path)
        root = tree.getroot()
    except Exception:
        return {"ElementName": "Unnamed", "LOFFile": None}

    metadata = {"ElementName": "Unnamed", "LOFFile": None}

    element = (
        root.find(f".//Element[@UniqueID='{target_uuid}']")
        if target_uuid
        else root.find(".//Element")
    )
    if element is not None:
        metadata["ElementName"] = element.get("Name", "Unnamed")

    memory_block = root.find(".//Memory/Block")
    if memory_block is not None:
        block_file = memory_block.attrib.get("File")
        if block_file and block_file.lower().endswith(".lof"):
            metadata["LOFFile"] = block_file

    return metadata
