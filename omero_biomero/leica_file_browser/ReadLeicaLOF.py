import os
import uuid
import json
import struct
import xml.etree.ElementTree as ET
from .ParseLeicaImageXML import parse_image_xml


def read_leica_lof(lof_file_path, include_xmlelement=False):
    """
    Reads a Leica LOF file and returns ONLY the dictionary from parse_image_xml.

    - If include_xmlelement=True, the raw XML text is stored in the dictionary
      under the key "xmlElement".
    - Otherwise, no extra data is added.

    :param lof_file_path: Path to the .lof file.
    :param include_xmlelement: If True, embed the raw XML in the returned dictionary.
    :return: A dictionary from parse_image_xml(...).
    """
    with open(lof_file_path, "rb") as f:
        # 1) Read the first SNextBlock (8 bytes)
        testvalue_bytes = f.read(4)
        if len(testvalue_bytes) < 4:
            raise ValueError(f"Error reading LOF file (first 4 bytes): {lof_file_path}")
        testvalue = struct.unpack("<i", testvalue_bytes)[0]
        if testvalue != 0x70:
            raise ValueError(
                f"Invalid LOF file format (expected 0x70): {lof_file_path}"
            )

        length_bytes = f.read(4)
        if len(length_bytes) < 4:
            raise ValueError(f"Error reading LOF file (length field): {lof_file_path}")
        length = struct.unpack("<i", length_bytes)[0]

        pHeader = f.read(length)
        if len(pHeader) < length:
            raise ValueError(
                f"Error reading LOF file (pHeader too short): {lof_file_path}"
            )

        # The first byte should be 0x2A
        test = struct.unpack("<B", pHeader[:1])[0]
        if test != 0x2A:
            raise ValueError(
                f"Invalid LOF file format (first block not 0x2A): {lof_file_path}"
            )

        # Skip the first XML chunk we don't usually need
        text_length = struct.unpack("<i", pHeader[1:5])[0]
        offset = 5 + text_length * 2
        if offset > len(pHeader):
            raise ValueError(
                f"Error reading LOF file (xml_bytes_header too short): {lof_file_path}"
            )

        # Skip major version info
        if offset + 5 > len(pHeader):
            raise ValueError("Invalid LOF file (truncated major version info).")
        offset += 5

        # Skip minor version info
        if offset + 5 > len(pHeader):
            raise ValueError("Invalid LOF file (truncated minor version info).")
        offset += 5

        # Skip memory_size info
        if offset + 9 > len(pHeader):
            raise ValueError("Invalid LOF file (truncated memory size info).")
        memory_size = struct.unpack("<Q", pHeader[offset + 1 : offset + 9])[0]
        offset += 9

        # Advance file pointer by memory_size
        f.seek(memory_size, os.SEEK_CUR)

        # 2) Read the second SNextBlock (real XML)
        testvalue_bytes = f.read(4)
        if len(testvalue_bytes) < 4:
            raise ValueError(
                f"Error reading LOF file (next SNextBlock): {lof_file_path}"
            )
        testvalue = struct.unpack("<i", testvalue_bytes)[0]
        if testvalue != 0x70:
            raise ValueError(
                f"Invalid LOF file format (expected 0x70 for second block): {lof_file_path}"
            )

        length_bytes = f.read(4)
        if len(length_bytes) < 4:
            raise ValueError(
                f"Error reading LOF file (length of second block): {lof_file_path}"
            )
        length = struct.unpack("<i", length_bytes)[0]

        pXMLMem = f.read(length)
        if len(pXMLMem) < length:
            raise ValueError(
                f"Error reading LOF file (pXMLMem too short): {lof_file_path}"
            )

        test = struct.unpack("<B", pXMLMem[:1])[0]
        if test != 0x2A:
            raise ValueError(
                f"Invalid LOF file format (second block not 0x2A): {lof_file_path}"
            )

        text_length = struct.unpack("<i", pXMLMem[1:5])[0]
        xml_bytes = pXMLMem[5 : 5 + text_length * 2]
        if len(xml_bytes) < text_length * 2:
            raise ValueError(
                f"Error reading LOF file (xml_bytes too short): {lof_file_path}"
            )

        xml_text = xml_bytes.decode("utf-16")

    # Parse the XML
    xml_root = ET.fromstring(xml_text)

    # Parse the image metadata (parse_image_xml returns a dict)
    metadata = parse_image_xml(xml_root)

    metadata["filetype"] = ".lof"
    metadata["LOFFilePath"] = lof_file_path
    lp = (
        len(lof_file_path)
        + text_length
        + memory_size
        + sum(ord(char) for char in lof_file_path)
    )
    metadata["UniqueID"] = str(uuid.UUID(int=lp))

    # Add the base file name to the metadata
    metadata["save_child_name"] = os.path.basename(lof_file_path)

    # Optionally include the raw XML text
    if include_xmlelement:
        metadata["xmlElement"] = xml_text

    return json.dumps(metadata, indent=2)
