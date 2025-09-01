import os
import json
import struct
import xml.etree.ElementTree as ET
from datetime import timezone  # Import timezone
from ParseLeicaImageXML import parse_image_xml
from ParseLeicaImageXMLLite import parse_image_xml_lite
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
        ft_int = int(filetime)
        timestamp = (ft_int - EPOCH_AS_FILETIME) / HUNDREDS_OF_NANOSECONDS
        return datetime.datetime.fromtimestamp(timestamp, timezone.utc)
    except (ValueError, TypeError):
        return None

def build_single_level_image_node(lifinfo, lif_base_name, parent_path):
    """
    Build a simple node (dictionary) for an image, including metadata.

    Args:
        lifinfo (dict): Dictionary with image information and metadata.
        lif_base_name (str): Base name of the LIF file.
        parent_path (str): Path representing the parent folder hierarchy inside the LIF file.

    Returns:
        dict: Node dictionary representing the image and its metadata.
    """
    image_name = lifinfo.get('name', lifinfo.get('Name', ''))
    
    # Construct save_child_name
    save_child_name = lif_base_name
    if parent_path:
        save_child_name += "_" + parent_path
    save_child_name += "_" + image_name

    node = {
        'type': 'Image',
        'name': image_name,
        'uuid': lifinfo.get('uuid', ''),
        'children': [],
        'save_child_name': save_child_name
    }
    
    dims = lifinfo.get('dimensions')
    if dims:
        node['dimensions'] = dims
        node['isrgb'] = str(dims.get('isrgb', False))
    
    return node

def build_single_level_lif_folder_node(folder_element, folder_uuid, image_map, folder_map, parent_map, lif_base_name, parent_path=""):
    """
    Build a single-level dictionary node for a LIF folder (just immediate children).

    Args:
        folder_element (xml.etree.ElementTree.Element): XML element for the folder.
        folder_uuid (str): UUID of the folder.
        image_map (dict): Mapping of image UUIDs to image info.
        folder_map (dict): Mapping of folder UUIDs to folder info.
        parent_map (dict): Mapping of child UUIDs to parent UUIDs.
        lif_base_name (str): Base name of the LIF file.
        parent_path (str, optional): Path representing the parent folder hierarchy. Defaults to "".

    Returns:
        dict: Node dictionary representing the folder and its immediate children.
    """
    name = folder_element.attrib.get('Name', '')
    
    # Construct current path inside the LIF file
    current_path = parent_path + "_" + name if parent_path else name

    node = {
        'type': 'Folder',
        'name': name,
        'uuid': folder_uuid,
        'children': []
    }

    children = folder_element.find('Children')
    if children is not None:
        for child_el in children.findall('Element'):
            child_name = child_el.attrib.get('Name', '')
            child_uuid = child_el.attrib.get('UniqueID')

            mem = child_el.find('Memory')
            if mem is not None:
                c_block_id = mem.attrib.get('MemoryBlockID')
                c_size = int(mem.attrib.get('Size', '0'))
                if c_block_id and c_size > 0:
                    # It's an image
                    if child_uuid and child_uuid in image_map:
                        node['children'].append(build_single_level_image_node(image_map[child_uuid], lif_base_name, current_path))
                else:
                    # It's a folder
                    if child_uuid and child_uuid in folder_map:
                        node['children'].append(
                            build_single_level_lif_folder_node(folder_map[child_uuid], child_uuid, image_map, folder_map, parent_map, lif_base_name, current_path)
                        )
            else:
                # It's a folder
                if child_uuid and child_uuid in folder_map:
                    node['children'].append(
                        build_single_level_lif_folder_node(folder_map[child_uuid], child_uuid, image_map, folder_map, parent_map, lif_base_name, current_path)
                    )

    return node

def read_leica_lif(file_path, include_xmlelement=False, image_uuid=None, folder_uuid=None):
    """
    Read Leica LIF file, extracting folder and image structures.
    Ensures:
      - When no folder_uuid is provided: return the root and its first-level children.
      - When a folder_uuid is provided: return only that folder and its first-level children.
      - Correctly builds 'save_child_name' using the LIF base name and full folder path.
      - Extracts Experiment name and datetime from the root XML and adds them to image metadata.

    Args:
        file_path (str): Path to the LIF file to be read.
        include_xmlelement (bool, optional): Flag to include XML element data in the output. Defaults to False.
        image_uuid (str, optional): UUID of a specific image to be extracted. If provided, only this image is returned. Defaults to None.
        folder_uuid (str, optional): UUID of a specific folder to be extracted. If provided, only this folder and its children are returned. Defaults to None.

    Returns:
        str: JSON string representing the folder and image structure, or a specific image or folder if UUIDs are provided.
    """
    lif_base_name = os.path.splitext(os.path.basename(file_path))[0]  # Extract the LIF file base name

    with open(file_path, 'rb') as f:
        # Basic LIF validation
        testvalue = struct.unpack('i', f.read(4))[0]
        if testvalue != 112:
            raise ValueError(f'Error Opening LIF-File: {file_path}')
        _ = struct.unpack('i', f.read(4))[0]  # XMLContentLength
        testvalue = struct.unpack('B', f.read(1))[0]
        if testvalue != 42:
            raise ValueError(f'Error Opening LIF-File: {file_path}')
        testvalue = struct.unpack('i', f.read(4))[0]
        XMLObjDescriptionUTF16 = f.read(testvalue * 2)
        XMLObjDescription = XMLObjDescriptionUTF16.decode('utf-16')

    xml_root = ET.fromstring(XMLObjDescription)

    # Extract Experiment Name and DateTime
    experiment_name = None
    experiment_datetime_str = None
    try:
        # Navigate through the expected structure
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
                                # Combine high and low parts for the 64-bit FILETIME
                                filetime_val = (int(high_int) << 32) + int(low_int)
                                dt_obj = filetime_to_datetime(filetime_val)
                                if dt_obj:
                                    # Format to YYYY-MM-DDTHH:MM:SS
                                    experiment_datetime_str = dt_obj.strftime('%Y-%m-%dT%H:%M:%S')
                            except (ValueError, TypeError):
                                pass # Ignore conversion errors
    except Exception:
         # Ignore errors during extraction, proceed without this info
         pass

    # Do not scan memory blocks unless an image is requested
    blockid_to_lifinfo = {}

    # Lightweight helpers to avoid deep traversal work unless requested
    def child_elements(el: ET.Element):
        ch = el.find('Children')
        return [] if ch is None else ch.findall('Element')

    def is_image_element(el: ET.Element) -> bool:
        mem = el.find('Memory')
        if mem is None:
            return False
        try:
            size_ok = int(mem.attrib.get('Size', '0')) > 0
        except ValueError:
            size_ok = False
        has_id = bool(mem.attrib.get('MemoryBlockID'))
        return has_id and size_ok

    def make_image_meta(el: ET.Element, current_path: str, include_metadata: bool = False) -> dict:
        name = el.attrib.get('Name', '')
        unique_id = el.attrib.get('UniqueID')
        mem = el.find('Memory')
        mem_id = mem.attrib.get('MemoryBlockID') if mem is not None else None
        lif_block = blockid_to_lifinfo.get(mem_id, {
            'BlockID': mem_id,
            'MemorySize': int(mem.attrib.get('Size', '0')) if mem is not None else 0,
            'Position': None,
            'LIFFile': file_path
        })

        lif_block = dict(lif_block)  # copy
        lif_block['name'] = name
        lif_block['uuid'] = unique_id
        lif_block['filetype'] = '.lif'
        lif_block['datatype'] = 'Image'
        lif_block['experiment_name'] = experiment_name
        lif_block['experiment_datetime'] = experiment_datetime_str
        lif_block['save_child_name'] = f"{lif_base_name}_{current_path}"
        if include_xmlelement:
            lif_block['xmlElement'] = ET.tostring(el, encoding='utf-8').decode('utf-8')
        try:
            if include_metadata:
                # Full, slower parser for detailed image requests
                metadata = parse_image_xml(el)
            else:
                # Fast, lightweight parser for listings
                metadata = parse_image_xml_lite(el)
            lif_block.update(metadata)
        except Exception:
            pass
        return lif_block

    def find_element_and_path(el: ET.Element, target_uuid: str, parent_path: str = "", skip_self: bool = False):
        if skip_self:
            for ch in child_elements(el):
                found = find_element_and_path(ch, target_uuid, parent_path="", skip_self=False)
                if found:
                    return found
            return None
        name = el.attrib.get('Name', '')
        current_path = f"{parent_path}_{name}" if parent_path else name
        if el.attrib.get('UniqueID') == target_uuid:
            return el, current_path
        for ch in child_elements(el):
            found = find_element_and_path(ch, target_uuid, current_path, skip_self=False)
            if found:
                return found
        return None

    # Image request: return only that image's metadata
    if image_uuid is not None:
        # Lazily scan memory blocks only for image requests
        try:
            with open(file_path, 'rb') as f:
                # Skip header and XML payload
                _ = struct.unpack('i', f.read(4))[0]
                _ = struct.unpack('i', f.read(4))[0]  # XMLContentLength
                _ = struct.unpack('B', f.read(1))[0]
                xml_len = struct.unpack('i', f.read(4))[0]
                f.seek(xml_len * 2, os.SEEK_CUR)

                scanned_map = {}
                while True:
                    data = f.read(4)
                    if not data:
                        break
                    marker = struct.unpack('i', data)[0]
                    if marker != 112:
                        raise ValueError('Error Opening LIF-File: {}'.format(file_path))
                    _ = struct.unpack('i', f.read(4))[0]  # BinContentLength
                    star = struct.unpack('B', f.read(1))[0]
                    if star != 42:
                        raise ValueError('Error Opening LIF-File: {}'.format(file_path))
                    MemorySize = struct.unpack('q', f.read(8))[0]
                    star = struct.unpack('B', f.read(1))[0]
                    if star != 42:
                        raise ValueError('Error Opening LIF-File: {}'.format(file_path))
                    BlockIDLength = struct.unpack('i', f.read(4))[0]
                    BlockIDData = f.read(BlockIDLength * 2)
                    BlockID = BlockIDData.decode('utf-16')
                    position = f.tell()
                    scanned_map[BlockID] = {
                        'BlockID': BlockID,
                        'MemorySize': MemorySize,
                        'Position': position,
                        'LIFFile': file_path
                    }
                    if MemorySize > 0:
                        f.seek(MemorySize, os.SEEK_CUR)
            # Rebind the lookup so make_image_meta can use it
            blockid_to_lifinfo = scanned_map
        except Exception:
            blockid_to_lifinfo = {}
        root_el = xml_root.find('Element')
        if root_el is None:
            raise ValueError('Invalid LIF XML: missing root Element')
        found = find_element_and_path(root_el, image_uuid, skip_self=True)
        if not found:
            raise ValueError(f'Image with UUID {image_uuid} not found')
        el, current_path = found
        if not is_image_element(el):
            raise ValueError(f'UUID {image_uuid} is not an image element')
        return json.dumps(make_image_meta(el, current_path, include_metadata=True), indent=2)

    # Folder request: return folder with direct children only
    if folder_uuid is not None:
        root_el = xml_root.find('Element')
        if root_el is None:
            raise ValueError('Invalid LIF XML: missing root Element')
        found = find_element_and_path(root_el, folder_uuid, skip_self=True)
        if not found:
            raise ValueError(f'Folder with UUID {folder_uuid} not found')
        folder_el, folder_path = found
        node = {
            'type': 'Folder',
            'name': folder_el.attrib.get('Name', ''),
            'uuid': folder_uuid,
            'children': []
        }
        for ch in child_elements(folder_el):
            ch_name = ch.attrib.get('Name', '')
            ch_uuid = ch.attrib.get('UniqueID')
            ch_path = f"{folder_path}_{ch_name}" if folder_path else ch_name
            if is_image_element(ch):
                node['children'].append(make_image_meta(ch, ch_path, include_metadata=False))
            else:
                node['children'].append({
                    'type': 'Folder',
                    'name': ch_name,
                    'uuid': ch_uuid,
                    'children': []
                })
        return json.dumps(node, indent=2)

    # Default: return top-level (first-level) children only
    root_el = xml_root.find('Element')
    node = {
        'type': 'File',
        'name': os.path.basename(file_path),
        'experiment_name': experiment_name,
        'experiment_datetime': experiment_datetime_str,
        'children': []
    }
    if root_el is not None:
        for ch in child_elements(root_el):
            ch_name = ch.attrib.get('Name', '')
            ch_uuid = ch.attrib.get('UniqueID')
            if is_image_element(ch):
                node['children'].append(make_image_meta(ch, ch_name, include_metadata=False))
            else:
                node['children'].append({
                    'type': 'Folder',
                    'name': ch_name,
                    'uuid': ch_uuid,
                    'children': []
                })
    return json.dumps(node, indent=2)
