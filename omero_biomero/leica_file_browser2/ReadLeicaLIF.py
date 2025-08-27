import os
import json
import struct
import xml.etree.ElementTree as ET
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

        # Read memory blocks
        lifinfo_blocks = []
        while True:
            data = f.read(4)
            if not data:
                break
            testvalue = struct.unpack('i', data)[0]
            if testvalue != 112:
                raise ValueError('Error Opening LIF-File: {}'.format(file_path))
            _ = struct.unpack('i', f.read(4))[0]  # BinContentLength
            testvalue = struct.unpack('B', f.read(1))[0]
            if testvalue != 42:
                raise ValueError('Error Opening LIF-File: {}'.format(file_path))
            MemorySize = struct.unpack('q', f.read(8))[0]
            testvalue = struct.unpack('B', f.read(1))[0]
            if testvalue != 42:
                raise ValueError('Error Opening LIF-File: {}'.format(file_path))
            testvalue = struct.unpack('i', f.read(4))[0]
            BlockIDLength = testvalue
            BlockIDData = f.read(BlockIDLength * 2)
            BlockID = BlockIDData.decode('utf-16')
            position = f.tell()
            lifinfo_blocks.append({
                'BlockID': BlockID,
                'MemorySize': MemorySize,
                'Position': position,
                'LIFFile': file_path
            })
            if MemorySize > 0:
                f.seek(MemorySize, os.SEEK_CUR)  

    # Create a lookup for blocks by their BlockID
    blockid_to_lifinfo = {block['BlockID']: block for block in lifinfo_blocks}

    # Initialize storage for images, folders, and parent relationships
    image_map = {}
    folder_map = {}
    parent_map = {}

    def dfs_collect(element, parent_folder_uuid=None, parent_path="", skip_first_level=False):
        """
        Recursively collect folder and image data.
        The 'parent_path' keeps track of the full folder structure inside the LIF file.
        The first XML `<Element>` should be ignored, and its children treated as the root level.
        """
        name = element.attrib.get('Name', '')
        unique_id = element.attrib.get('UniqueID')
        Memory = element.find('Memory')

        # If this is the first element, ignore it and process its children instead
        if skip_first_level:
            children = element.find('Children')
            if children is not None:
                for child_el in children.findall('Element'):
                    dfs_collect(child_el, parent_folder_uuid=None, parent_path="", skip_first_level=False)
            return  # Do NOT process this element itself

        # Correctly build the full folder path within the LIF file (ensuring first folder is included)
        current_path = f"{parent_path}_{name}" if parent_path else name  # Ensures first folder level is captured

        if Memory is not None:
            MemoryBlockID = Memory.attrib.get('MemoryBlockID')
            MemorySize = int(Memory.attrib.get('Size', '0'))
            if MemoryBlockID and MemorySize > 0 and MemoryBlockID in blockid_to_lifinfo:
                # It's an image
                lif_block = blockid_to_lifinfo[MemoryBlockID]
                lif_block['name']= name
                lif_block['uuid']= unique_id
                lif_block['filetype'] = '.lif'
                lif_block['datatype'] = 'Image'
                # Add experiment info to image metadata
                lif_block['experiment_name'] = experiment_name
                lif_block['experiment_datetime'] = experiment_datetime_str

                if include_xmlelement:
                    lif_block['xmlElement'] = ET.tostring(element, encoding='utf-8').decode('utf-8')

                metadata = parse_image_xml(element)
                lif_block.update(metadata)

                # Construct `save_child_name` correctly
                save_child_name = f"{lif_base_name}_{current_path}"

                lif_block['save_child_name'] = save_child_name
                image_map[unique_id] = lif_block
                parent_map[unique_id] = parent_folder_uuid
            else:
                # Folder without valid memory reference
                folder_map[unique_id] = element
                parent_map[unique_id] = parent_folder_uuid
        else:
            # It's a folder
            folder_map[unique_id] = element
            parent_map[unique_id] = parent_folder_uuid

        # Recurse only if this is a folder
        children = element.find('Children')
        if children is not None and unique_id in folder_map:
            for child_el in children.findall('Element'):
                dfs_collect(child_el, unique_id, current_path, skip_first_level=False)  # Pass the full internal path

    # Start recursive traversal from the root XML element, but skip the first-level wrapper `<Element>`
    root_element = xml_root.find('Element')
    if root_element is not None:
        dfs_collect(root_element, skip_first_level=True)

    # --------------------------------------------------------------------------
    # If user requested an image by UUID
    # --------------------------------------------------------------------------
    if image_uuid is not None:
        if image_uuid in image_map:
            return json.dumps(image_map[image_uuid], indent=2)
        else:
            raise ValueError(f'Image with UUID {image_uuid} not found')

    # --------------------------------------------------------------------------
    # If user requested a folder by UUID
    # --------------------------------------------------------------------------
    if folder_uuid is not None:
        if folder_uuid not in folder_map:
            raise ValueError(f'Folder with UUID {folder_uuid} not found')

        folder_el = folder_map[folder_uuid]
        node = {
            'type': 'Folder',
            'name': folder_el.attrib.get('Name', ''),
            'uuid': folder_uuid,
            'children': []
        }

        # Add only first-level children (folders and images)
        children = folder_el.find('Children')
        if children is not None:
            for child_el in children.findall('Element'):
                child_name = child_el.attrib.get('Name', '')
                child_uuid = child_el.attrib.get('UniqueID')

                if child_uuid in image_map:
                    # Return the full image metadata which now includes experiment info
                    node['children'].append(image_map[child_uuid])
                elif child_uuid in folder_map:
                    node['children'].append({
                        'type': 'Folder',
                        'name': child_name,
                        'uuid': child_uuid,
                        'children': []
                    })

        return json.dumps(node, indent=2)

    # --------------------------------------------------------------------------
    # Otherwise return root-level structure (only first-level children)
    # --------------------------------------------------------------------------
    node = {
        'type': 'File',
        'name': os.path.basename(file_path),
        'experiment_name': experiment_name,
        'experiment_datetime': experiment_datetime_str,
        'children': []
    }

    # Find only top-level folders and images (first level only)
    top_folders = [fid for fid in folder_map if parent_map[fid] is None]
    top_images = [iid for iid in image_map if parent_map[iid] is None]

    for f_id in top_folders:
        f_el = folder_map[f_id]
        node['children'].append({
            'type': 'Folder',
            'name': f_el.attrib.get('Name', ''),
            'uuid': f_id,
            'children': []
        })

    for i_id in top_images:
        # Return the full image metadata which now includes experiment info
        node['children'].append(image_map[i_id])

    return json.dumps(node, indent=2)
