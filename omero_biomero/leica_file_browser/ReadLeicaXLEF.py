import os
import json
import xml.etree.ElementTree as ET
from urllib.parse import unquote
from collections import deque
from ParseLeicaImageXML import parse_image_xml
from datetime import timezone # Import timezone
import datetime

def filetime_to_datetime(filetime):
    """
    Converts a Windows FILETIME value (64-bit integer) to a Python datetime object (UTC).

    Args:
        filetime (int): Windows FILETIME value (number of 100-nanosecond intervals since January 1, 1601 UTC).

    Returns:
        datetime.datetime or None: Corresponding UTC datetime object, or None if conversion fails.
    """
    # FILETIME is the number of 100-nanosecond intervals since January 1, 1601 (UTC)
    EPOCH_AS_FILETIME = 116444736000000000  # January 1, 1970 as FILETIME
    HUNDREDS_OF_NANOSECONDS = 10000000

    try:
        # Combine high and low integers into a 64-bit integer
        ft_int = int(filetime)
        # Convert to seconds since the Unix epoch
        timestamp = (ft_int - EPOCH_AS_FILETIME) / HUNDREDS_OF_NANOSECONDS
        # Use timezone-aware datetime object
        return datetime.datetime.fromtimestamp(timestamp, timezone.utc)
    except (ValueError, TypeError):
        return None

def _extract_experiment_details(xml_root):
    """
    Extracts experiment name and datetime from the XML root element.

    Args:
        xml_root (xml.etree.ElementTree.Element): Root XML element of the Leica file.

    Returns:
        tuple: (experiment_name, experiment_datetime_str) if found, else (None, None).
    """
    experiment_name = None
    experiment_datetime_str = None
    try:
        element_node = xml_root.find('Element')
        if element_node is not None:
            data_node = element_node.find('Data')
            if data_node is not None:
                experiment_node = data_node.find('Experiment')
                if experiment_node is not None:
                    exp_path = experiment_node.attrib.get('Path')
                    if exp_path:
                        experiment_name = os.path.basename(exp_path) # Get filename part

                    timestamp_node = experiment_node.find('TimeStamp')
                    if timestamp_node is not None:
                        high_int = timestamp_node.attrib.get('HighInteger')
                        low_int = timestamp_node.attrib.get('LowInteger')
                        if high_int is not None and low_int is not None:
                            try:
                                filetime_val = (int(high_int) << 32) + int(low_int)
                                dt_obj = filetime_to_datetime(filetime_val)
                                if dt_obj:
                                    experiment_datetime_str = dt_obj.strftime('%Y-%m-%dT%H:%M:%S')
                            except (ValueError, TypeError):
                                pass # Ignore conversion errors
    except Exception:
         pass # Ignore errors during extraction
    return experiment_name, experiment_datetime_str


def read_leica_xlef(file_path, folder_uuid=None):
    """
    Reads a Leica XLEF/.xlcf/.xlif file and returns the top-level structure or locates a requested folder_uuid.

    Args:
        file_path (str): Path to the XLEF file.
        folder_uuid (str, optional): UUID of the folder to locate. If None, returns the top-level structure.

    Returns:
        str: JSON string containing the resulting dictionary with experiment details and structure.
    """
    file_path = os.path.normpath(file_path)

    # Extract root experiment details first
    root_experiment_name = None
    root_experiment_datetime = None
    if os.path.exists(file_path):
        try:
            tree = ET.parse(file_path)
            root = tree.getroot()
            root_experiment_name, root_experiment_datetime = _extract_experiment_details(root)
        except Exception:
            pass # Ignore if root file cannot be parsed

    if folder_uuid is None:
        result_dict = parse_top_level(file_path, root_experiment_name, root_experiment_datetime)
    else:
        result_dict = bfs_find_uuid(file_path, folder_uuid, root_experiment_name, root_experiment_datetime)

    if result_dict is None:
        result_dict = {}

    return json.dumps(result_dict, indent=2)


def bfs_find_uuid(top_file, folder_uuid, root_experiment_name, root_experiment_datetime):
    """
    Performs a breadth-first search to locate a folder UUID in the XLEF file structure.

    Args:
        top_file (str): Path to the top-level XLEF file.
        folder_uuid (str): UUID of the folder to find.
        root_experiment_name (str): Name of the root experiment.
        root_experiment_datetime (str): Datetime of the root experiment.

    Returns:
        dict or None: Dictionary representing the found folder node, or None if not found.
    """
    if not os.path.exists(top_file):
        return None

    visited = set()
    queue = deque()

    top_ext = top_file.lower().split('.')[-1]
    top_element, top_refs, top_root = parse_file_minimal(top_file) # Modified to return root
    if top_element is None:
        return None

    # Extract experiment details from the top file itself (might differ from root if it's not the root)
    # However, we prioritize the details passed from the initial call (root_experiment_name/datetime)
    # current_exp_name, current_exp_datetime = _extract_experiment_details(top_root) if top_root else (None, None)

    top_uuid = top_element.get("UniqueID") or ""
    if folder_uuid and top_uuid == folder_uuid:
        return build_tree_for_element(top_ext, top_element, top_file, top_file, root_experiment_name, root_experiment_datetime)

    visited.add(top_file)
    for ref_file, ref_uuid, ref_ext in top_refs:
        queue.append((ref_file, ref_uuid, ref_ext))

    while queue:
        current_file, current_ref_uuid, current_ext = queue.popleft()
        if not os.path.exists(current_file) or current_file in visited:
            continue
        visited.add(current_file)

        el, refs, current_root = parse_file_minimal(current_file) # Modified to return root
        if el is None:
            continue

        # Extract experiment details from the current file
        # Again, prioritize root details passed down
        # current_exp_name, current_exp_datetime = _extract_experiment_details(current_root) if current_root else (None, None)

        actual_uuid = el.get("UniqueID")
        if actual_uuid == folder_uuid:
            # Pass the root experiment details down
            return build_tree_for_element(current_ext, el, current_file, top_file, root_experiment_name, root_experiment_datetime)

        for rfile, ruuid, rext in refs:
            queue.append((rfile, ruuid, rext))

    return None


def parse_file_minimal(file_path):
    """
    Parses the given Leica file and retrieves the main element and references.

    Args:
        file_path (str): Path to the Leica file.

    Returns:
        tuple: (main_element, references_list, root_element) where:
            - main_element (xml.etree.ElementTree.Element): The main Element node.
            - references_list (list): List of tuples with (ref_path, ref_uuid, ref_ext) for each Reference.
            - root_element (xml.etree.ElementTree.Element): The root element of the parsed XML.
    """
    try:
        tree = ET.parse(file_path)
        root = tree.getroot()
    except Exception:
        return None, [], None # Return None for root as well

    main_el = root.find(".//Element")
    if main_el is None:
        return None, [], root # Return root even if element not found

    refs = []
    for ref in root.findall(".//Reference"):
        ref_path = unquote(ref.get("File") or "")
        ref_path = ref_path.replace("\\", "/")  # Normalize Windows slashes to POSIX
        ref_path = os.path.normpath(os.path.join(os.path.dirname(file_path), ref_path))
        ref_uuid = ref.get("UUID") or ""
        ref_ext = ref_path.lower().split('.')[-1]
        refs.append((ref_path, ref_uuid, ref_ext))

    return main_el, refs, root # Return the parsed root


def build_tree_for_element(ext, element, file_path, top_file, experiment_name, experiment_datetime):
    """
    Builds a metadata tree for the given element, including its children.

    Args:
        ext (str): File extension type (e.g., 'xlif', 'xlef', 'xlcf').
        element (xml.etree.ElementTree.Element): The Element node to build the tree for.
        file_path (str): Path to the Leica file.
        top_file (str): Path to the top-level Leica file.
        experiment_name (str): Name of the experiment.
        experiment_datetime (str): Datetime of the experiment.

    Returns:
        dict: Metadata dictionary for the element, including children metadata.
    """
    if ext == 'xlif':
        metadata = parse_image_xml(element)
        metadata['XLIFFile'] = file_path
        # Add root experiment details
        metadata['experiment_name'] = experiment_name
        metadata['experiment_datetime'] = experiment_datetime

        lof_rel = metadata.get('LOFFile')
        if lof_rel:
            lof_rel = unquote(lof_rel).replace("\\", "/")
            lof_abs_path = os.path.join(os.path.dirname(file_path), lof_rel)
            metadata['LOFFilePath'] = os.path.normpath(lof_abs_path)

        return metadata
    else: # Folder (XLEF or XLCF)
        return {
            'type': 'Folder',
            'name': element.get("Name", ""),
            'uuid': element.get("UniqueID"),
            'experiment_name': experiment_name, # Add experiment details
            'experiment_datetime': experiment_datetime, # Add experiment details
            'children': _build_children_list(element, file_path, top_file, experiment_name, experiment_datetime) # Pass details down
        }


def parse_top_level(file_path, root_experiment_name, root_experiment_datetime):
    """
    Parses the top-level structure of the Leica file, extracting the main element and its children.

    Args:
        file_path (str): Path to the Leica file.
        root_experiment_name (str): Name of the root experiment.
        root_experiment_datetime (str): Datetime of the root experiment.

    Returns:
        dict or None: Dictionary representing the top-level file structure, or None if parsing fails.
    """
    if not os.path.exists(file_path):
        return None

    extension = file_path.lower().split('.')[-1]
    try: 
        tree = ET.parse(file_path)
        root = tree.getroot()
    except Exception:
        return None

    top_el = root.find(".//Element")
    if top_el is None:
        return None

    # Experiment details already extracted and passed in

    return {
        'type': 'File' if extension in ['xlef', 'xlcf'] else 'Unknown',
        'name': top_el.get("Name", ""),
        'uuid': top_el.get("UniqueID"),
        'experiment_name': root_experiment_name, # Add experiment details
        'experiment_datetime': root_experiment_datetime, # Add experiment details
        'children': _build_children_list(top_el, file_path, file_path, root_experiment_name, root_experiment_datetime) # Pass details down
    }


def _build_children_list(element, base_file, top_file, experiment_name, experiment_datetime):
    """
    Builds a list of children metadata for the given element.

    Args:
        element (xml.etree.ElementTree.Element): The Element node to build children metadata for.
        base_file (str): Base file path for resolving relative paths.
        top_file (str): Top-level file path.
        experiment_name (str): Name of the experiment.
        experiment_datetime (str): Datetime of the experiment.

    Returns:
        list: List of dictionaries with metadata for each child element.
    """
    children_list = []
    child_elem = element.find("Children")
    if child_elem is None:
        return children_list

    xlef_base_name = os.path.splitext(os.path.basename(top_file))[0]
    xlef_folder = os.path.dirname(top_file)

    for ref in child_elem.findall("Reference"):
        # ref_file = os.path.normpath(unquote(ref.get("File") or ""))
        # ref_file = os.path.normpath(os.path.join(os.path.dirname(base_file), ref_file))
        
        ref_file = unquote(ref.get("File") or "")
        ref_file = ref_file.replace("\\", "/")  # Normalize Windows slashes to POSIX
        ref_file = os.path.normpath(ref_file)
        ref_file = os.path.normpath(os.path.join(os.path.dirname(base_file), ref_file))

        ref_uuid = ref.get("UUID") or ""
        ext = ref_file.lower().split('.')[-1]

        ctype = 'Folder' if ext == 'xlcf' else 'Image' if ext == 'xlif' else 'File' if ext == 'xlef' else 'Unknown'

        metadata = get_element_metadata(ref_file, ref_uuid) # get_element_metadata doesn't need experiment details, they come from root
        real_child_name = metadata['ElementName']

        lof_rel = metadata.get('LOFFile')
        metadata['filetype'] = '.lof'
        save_child_name = real_child_name  

        if lof_rel:
            lof_rel = unquote(lof_rel).replace("\\", "/")
            lof_abs_path = os.path.join(os.path.dirname(ref_file), lof_rel)
            metadata['LOFFilePath'] = os.path.normpath(lof_abs_path)        
            lof_relative_path = os.path.relpath(lof_abs_path, xlef_folder)
            lof_path_parts = lof_relative_path.split(os.sep)
            lof_path_parts = [part for part in lof_path_parts if part not in ("..", ".", "")]
            save_child_name = xlef_base_name + "_" + "_".join(lof_path_parts)
            if save_child_name.lower().endswith(".lof"):
                save_child_name = save_child_name[:-4]

        if real_child_name and real_child_name.lower().startswith('iomanager'):
            continue        

        child_node = {
            'type': ctype,
            'file_path': ref_file,
            'lof_file_path': metadata.get('LOFFilePath', ''),
            'uuid': ref_uuid,
            'name': real_child_name,
            'save_child_name': save_child_name if metadata.get('filetype') == '.lof' else '', # Check if filetype exists
            'xs': metadata['xs'],
            'ys': metadata['ys'],
            'zs': metadata['zs'],
            'ts': metadata['ts'],
            'tiles': metadata['tiles'],
            'channels': metadata['channels'],
            'isrgb': metadata['isrgb'],
            # Add root experiment details to each child
            'experiment_name': experiment_name,
            'experiment_datetime': experiment_datetime,
        }
        # Add filetype if available from metadata
        if 'filetype' in metadata:
             child_node['filetype'] = metadata['filetype']

        children_list.append(child_node)

    return children_list

def get_element_metadata(file_path, target_uuid=None):
    """
    Retrieves metadata for the specified element in the Leica file.

    Args:
        file_path (str): Path to the Leica file.
        target_uuid (str, optional): UUID of the target element. If None, retrieves metadata for the first element.

    Returns:
        dict: Metadata dictionary for the element, including dimensions, channels, and file paths.
    """
    if not os.path.exists(file_path):
        return {
            "ElementName": "Unnamed", "LOFFile": None, "filetype": None, # Added filetype
            "xs": 1, "ys": 1, "zs": 1, "ts": 1, "tiles": 1,
            "channels": 1, "isrgb": False
        }
    
    try:
        tree = ET.parse(file_path)
        root = tree.getroot()
    except Exception:
        return {
            "ElementName": "Unnamed", "LOFFile": None, "filetype": None, # Added filetype
            "xs": 1, "ys": 1, "zs": 1, "ts": 1, "tiles": 1,
            "channels": 1, "isrgb": False
        }
    
    # Initialize metadata with default values including filetype
    metadata = {
        "ElementName": "Unnamed", "LOFFile": None, "filetype": None, # Added filetype
        "xs": 1, "ys": 1, "zs": 1, "ts": 1, "tiles": 1,
        "channels": 1, "isrgb": False
    }
    
    # Determine filetype from extension
    ext = file_path.lower().split('.')[-1]
    if ext in ['xlef', 'xlcf', 'xlif', 'lof']:
        metadata['filetype'] = '.' + ext

    if not os.path.exists(file_path):
        return metadata # Return initialized metadata

    try:
        tree = ET.parse(file_path)
        root = tree.getroot()
    except Exception:
        return metadata # Return initialized metadata

    element = root.find(f".//Element[@UniqueID='{target_uuid}']") if target_uuid else root.find(".//Element")
    if element is not None:
        metadata["ElementName"] = element.get("Name", "Unnamed")
    
    memory_block = root.find('.//Memory/Block')
    if memory_block is not None:
        block_file = memory_block.attrib.get('File')
        if block_file and block_file.lower().endswith('.lof'):
            block_file = unquote(block_file).replace("\\", "/")
            metadata["LOFFile"] = block_file
    
    image_description = root.find('.//ImageDescription')
    if image_description is not None:
        dimensions_element = image_description.find('Dimensions')
        if dimensions_element is not None:
            dim_descriptions = dimensions_element.findall('DimensionDescription')
            for dim_desc in dim_descriptions:
                dim_id = int(dim_desc.attrib.get('DimID', '0'))
                num_elements = int(dim_desc.attrib.get('NumberOfElements', '1'))
                if dim_id == 1:
                    metadata['xs'] = num_elements
                elif dim_id == 2:
                    metadata['ys'] = num_elements
                elif dim_id == 3:
                    metadata['zs'] = num_elements
                elif dim_id == 4:
                    metadata['ts'] = num_elements
                elif dim_id == 10:
                    metadata['tiles'] = num_elements
        
        channels_element = image_description.find('Channels')
        if channels_element is not None:
            channel_descriptions = channels_element.findall('ChannelDescription')
            metadata['channels'] = len(channel_descriptions)
            if metadata['channels'] > 1:
                channel_tag = channel_descriptions[0].attrib.get('ChannelTag')
                if channel_tag and int(channel_tag) != 0:
                    metadata['isrgb'] = True
    
    return metadata


def get_element_metadata_old(file_path, target_uuid=None):
    """
    Retrieves metadata for the specified element in the Leica file (old version).

    Args:
        file_path (str): Path to the Leica file.
        target_uuid (str, optional): UUID of the target element. If None, retrieves metadata for the first element.

    Returns:
        dict: Metadata dictionary for the element, including dimensions and file paths.
    """
    if not os.path.exists(file_path):
        return {"ElementName": "Unnamed", "LOFFile": None}

    try:
        tree = ET.parse(file_path)
        root = tree.getroot()
    except Exception:
        return {"ElementName": "Unnamed", "LOFFile": None}

    metadata = {"ElementName": "Unnamed", "LOFFile": None}

    element = root.find(f".//Element[@UniqueID='{target_uuid}']") if target_uuid else root.find(".//Element")
    if element is not None:
        metadata["ElementName"] = element.get("Name", "Unnamed")

    memory_block = root.find('.//Memory/Block')
    if memory_block is not None:
        block_file = memory_block.attrib.get('File')
        if block_file and block_file.lower().endswith('.lof'):
            metadata["LOFFile"] = block_file

    return metadata
