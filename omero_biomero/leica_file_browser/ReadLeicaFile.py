import os
from .ReadLeicaLIF import read_leica_lif
from .ReadLeicaXLEF import read_leica_xlef
from .ReadLeicaLOF import read_leica_lof


def read_leica_file(
    file_path, include_xmlelement=False, image_uuid=None, folder_uuid=None
):
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

    if ext == ".lif":
        return read_leica_lif(file_path, include_xmlelement, image_uuid, folder_uuid)
    elif ext == ".xlef":
        return read_leica_xlef(file_path, folder_uuid)
    elif ext == ".lof":
        return read_leica_lof(file_path, include_xmlelement)
    else:
        raise ValueError("Unsupported file type: {}".format(ext))
