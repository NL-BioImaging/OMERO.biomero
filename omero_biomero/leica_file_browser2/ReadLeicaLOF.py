import os
import uuid
import json
import struct
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from ParseLeicaImageXML import parse_image_xml

# Constants for Windows File Time conversion
EPOCH_AS_FILETIME = 116444736000000000  # January 1, 1970 as MS file time
HUNDREDS_OF_NANOSECONDS = 10000000

def filetime_to_datetime(filetime):
    """
    Converts a Windows filetime value to a UTC datetime object.

    Args:
        filetime (int): Windows filetime value (number of 100-nanosecond intervals since 1601-01-01 UTC).

    Returns:
        datetime.datetime or None: UTC datetime object, or None if conversion fails.
    """
    if filetime < 0:
        return None
    # Convert filetime (100-nanosecond intervals since 1601-01-01 UTC) to datetime
    try:
        # Calculate seconds and microseconds
        s, ns100 = divmod(filetime, HUNDREDS_OF_NANOSECONDS)
        us = ns100 // 10  # Convert 100-nanoseconds to microseconds
        dt = datetime(1601, 1, 1, tzinfo=timezone.utc) + timedelta(seconds=s, microseconds=us)
        return dt
    except OverflowError:
        # Handle potential overflow for very large filetime values if necessary
        # This might indicate an invalid timestamp
        return None
    except Exception:
        # Catch any other potential conversion errors
        return None

def read_leica_lof(lof_file_path, include_xmlelement=False):
    """
    Reads a Leica LOF file and returns ONLY the dictionary from parse_image_xml.

    Args:
        lof_file_path (str): Path to the .lof file.
        include_xmlelement (bool, optional): If True, embed the raw XML in the returned dictionary. Defaults to False.

    Returns:
        dict: Dictionary from parse_image_xml(...) serialized as JSON. Includes experiment datetime if available.
    """
    with open(lof_file_path, 'rb') as f:
        # 1) Read the first SNextBlock (8 bytes)
        testvalue_bytes = f.read(4)
        if len(testvalue_bytes) < 4:
            raise ValueError(f'Error reading LOF file (first 4 bytes): {lof_file_path}')
        testvalue = struct.unpack('<i', testvalue_bytes)[0]
        if testvalue != 0x70:
            raise ValueError(f'Invalid LOF file format (expected 0x70): {lof_file_path}')

        length_bytes = f.read(4)
        if len(length_bytes) < 4:
            raise ValueError(f'Error reading LOF file (length field): {lof_file_path}')
        length = struct.unpack('<i', length_bytes)[0]

        pHeader = f.read(length)
        if len(pHeader) < length:
            raise ValueError(f'Error reading LOF file (pHeader too short): {lof_file_path}')

        # The first byte should be 0x2A
        test = struct.unpack('<B', pHeader[:1])[0]
        if test != 0x2A:
            raise ValueError(f'Invalid LOF file format (first block not 0x2A): {lof_file_path}')

        # Skip the first XML chunk we don't usually need
        text_length_header = struct.unpack('<i', pHeader[1:5])[0] # Renamed to avoid conflict
        offset = 5 + text_length_header*2
        if offset > len(pHeader):
            raise ValueError(f'Error reading LOF file (xml_bytes_header too short): {lof_file_path}')

        # Skip major version info
        if offset + 5 > len(pHeader):
            raise ValueError('Invalid LOF file (truncated major version info).')
        offset += 5

        # Skip minor version info
        if offset + 5 > len(pHeader):
            raise ValueError('Invalid LOF file (truncated minor version info).')
        offset += 5

        # Skip memory_size info
        if offset + 9 > len(pHeader):
            raise ValueError('Invalid LOF file (truncated memory size info).')
        memory_size = struct.unpack('<Q', pHeader[offset+1:offset+9])[0]
        offset += 9

        # Advance file pointer to skip memory_size
        f.seek(memory_size, os.SEEK_CUR)

        # 2) Read the second SNextBlock (real XML)
        testvalue_bytes = f.read(4)
        if len(testvalue_bytes) < 4:
            raise ValueError(f'Error reading LOF file (next SNextBlock): {lof_file_path}')
        testvalue = struct.unpack('<i', testvalue_bytes)[0]
        if testvalue != 0x70:
            raise ValueError(f'Invalid LOF file format (expected 0x70 for second block): {lof_file_path}')

        length_bytes = f.read(4)
        if len(length_bytes) < 4:
            raise ValueError(f'Error reading LOF file (length of second block): {lof_file_path}')
        length = struct.unpack('<i', length_bytes)[0]

        pXMLMem = f.read(length)
        if len(pXMLMem) < length:
            raise ValueError(f'Error reading LOF file (pXMLMem too short): {lof_file_path}')

        test = struct.unpack('<B', pXMLMem[:1])[0]
        if test != 0x2A:
            raise ValueError(f'Invalid LOF file format (second block not 0x2A): {lof_file_path}')

        text_length = struct.unpack('<i', pXMLMem[1:5])[0] # This is the XML text length
        xml_bytes = pXMLMem[5:5 + text_length * 2]
        if len(xml_bytes) < text_length * 2:
            raise ValueError(f'Error reading LOF file (xml_bytes too short): {lof_file_path}')

        xml_text = xml_bytes.decode('utf-16')

    # Parse the XML
    xml_root = ET.fromstring(xml_text)

    # --- Extract Experiment Datetime ---
    experiment_datetime = None
    timestamp_list_element = xml_root.find('.//TimeStampList') # Find TimeStampList anywhere

    if timestamp_list_element is not None:
        # Check for "new" format (text content with hex values)
        if timestamp_list_element.text and timestamp_list_element.text.strip():
            try:
                first_timestamp_hex = timestamp_list_element.text.strip().split()[0]
                filetime = int(first_timestamp_hex, 16)
                experiment_datetime = filetime_to_datetime(filetime)
            except (ValueError, IndexError):
                experiment_datetime = None # Handle parsing errors

        # If not found or failed, check for "old" format (child TimeStamp elements)
        if experiment_datetime is None:
            first_timestamp_element = timestamp_list_element.find('./TimeStamp')
            if first_timestamp_element is not None:
                try:
                    high = int(first_timestamp_element.get('HighInteger', '0'))
                    low = int(first_timestamp_element.get('LowInteger', '0'))
                    filetime = (high << 32) + low
                    experiment_datetime = filetime_to_datetime(filetime)
                except (ValueError, TypeError):
                    experiment_datetime = None # Handle attribute errors

    # Fallback to file creation time if no valid timestamp found in XML
    if experiment_datetime is None:
        try:
            ctime_timestamp = os.path.getctime(lof_file_path)
            # Use UTC time for consistency
            experiment_datetime = datetime.fromtimestamp(ctime_timestamp, tz=timezone.utc)
        except OSError:
            experiment_datetime = None # Handle file system errors

    # Format the datetime string (ISO 8601 format)
    experiment_datetime_str = experiment_datetime.isoformat() if experiment_datetime else None
    # --- End Extract Experiment Datetime ---


    # Parse the image metadata (parse_image_xml returns a dict)
    metadata = parse_image_xml(xml_root)

    metadata['filetype'] = '.lof'
    metadata['LOFFilePath'] = lof_file_path
    # Ensure memory_size is defined before using it here
    lp=len(lof_file_path) + text_length + memory_size + sum(ord(char) for char in lof_file_path)
    metadata['UniqueID'] = str(uuid.UUID(int=lp))

    # Add the experiment datetime string
    metadata['experiment_datetime_str'] = experiment_datetime_str

    # Add the base file name to the metadata
    metadata['save_child_name'] = os.path.basename(lof_file_path)

    # Optionally include the raw XML text
    if include_xmlelement:
        metadata["xmlElement"] = xml_text

    return json.dumps(metadata, indent=2)
