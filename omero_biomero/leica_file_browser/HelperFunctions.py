import json
import os

from ReadLeicaFile import read_leica_file


def get_image_metadata_LOF(folder_metadata, image_uuid):
    folder_metadata_dict = json.loads(folder_metadata)
    image_metadata_dict = next(
        (img for img in folder_metadata_dict["children"] if img["uuid"] == image_uuid),
        None,
    )
    image_metadata = read_leica_file(image_metadata_dict["lof_file_path"])
    return image_metadata


def get_image_metadata(folder_metadata, image_uuid):
    folder_metadata_dict = json.loads(folder_metadata)
    image_metadata_dict = next(
        (img for img in folder_metadata_dict["children"] if img["uuid"] == image_uuid),
        None,
    )
    image_metadata = json.dumps(image_metadata_dict, indent=2)
    return image_metadata
