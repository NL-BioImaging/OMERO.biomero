import mimetypes
import os
import math
import numpy as np
import cv2
import glob
import json
import base64
import tempfile
import uuid as _uuid

def create_png_from_metadata(metadata, preview_height=256, use_memmap=True):
    """
    Create a preview image from the metadata and return the path to the PNG file.
    """

    # Ensure metadata is a dictionary
    if isinstance(metadata, str):  # If metadata is a JSON string, parse it
        metadata = json.loads(metadata)

    # Determine fileName and basePos
    filetype = metadata["filetype"]
    if filetype == ".lif":
        fileName = metadata.get("LIFFile") or metadata.get("LOFFilePath")
        basePos = metadata.get("Position")
        if basePos is None:
            basePos = 0
    elif filetype in [".xlef", ".lof"]:
        fileName = metadata["LOFFilePath"]
        basePos = 62
    else:
        raise ValueError("Unsupported filetype")

    # Get image dimensions and other info
    xs = metadata["xs"]
    ys = metadata["ys"]
    zs = metadata["zs"]
    channels = metadata.get("channels", 1)
    isrgb = metadata.get("isrgb", False)
    # channelResolution may be missing or scalar
    res = metadata.get("channelResolution", 8)
    if isinstance(res, list):
        channelResolution = res if res else [8] * channels
    else:
        channelResolution = [int(res)] * channels
    channelbytesinc = metadata.get("channelbytesinc", [0] * channels)  # Default empty list
    zbytesinc = metadata.get("zbytesinc") or 0
    tbytesinc = metadata.get("tbytesinc") or 0
    tilesbytesinc = metadata.get("tilesbytesinc") or 0
    ts = metadata.get("ts", 1)
    tiles = metadata.get("tiles", 1)

    # Center slice selection for t and s (tiles)
    if ts and ts > 1:
        t = ts // 2
        basePos += int(t) * int(tbytesinc)
    if tiles and tiles > 1:
        tile = tiles // 2
        basePos += int(tile) * int(tilesbytesinc)

    # Center slice selection for z
    z = zs // 2 if zs > 1 else 0

    # Determine preview image size
    tscale = preview_height / ys
    ysize = preview_height
    xsize = int(xs * tscale)
    skip_factor = int(math.ceil(ys / ysize))
    totalRows = int(math.ceil(ys / skip_factor))

    # Determine data type
    dtype, bytes_per_pixel, max_pixel_value = (np.uint8, 1, 255) if channelResolution[0] == 8 else (np.uint16, 2, 65535)

    # Initialize the preview image
    impreview = np.zeros((totalRows, xsize, 3), dtype=np.float32)

    if use_memmap:
        if isrgb:
            data_offset = basePos + z * zbytesinc
            slice_shape = (ys, xs, 3)
            mmap_array = np.memmap(fileName, dtype=dtype, mode="r", offset=data_offset, shape=slice_shape, order="C")
            selected_rows = mmap_array[::skip_factor, :, :]
            impreview_data = cv2.resize(selected_rows, (xsize, ysize), interpolation=cv2.INTER_AREA)
            impreview = impreview_data.astype(np.float32)
        else:
            temp_impreview = np.zeros((ysize, xsize, 3), dtype=np.float32)
            for cht in range(channels):
                data_offset = basePos + z * zbytesinc + channelbytesinc[cht]
                slice_shape = (ys, xs)
                mmap_array = np.memmap(fileName, dtype=dtype, mode="r", offset=data_offset, shape=slice_shape, order="C")
                selected_rows = mmap_array[::skip_factor, :]
                channel_data_resized = cv2.resize(selected_rows, (xsize, ysize), interpolation=cv2.INTER_AREA)
                # LUT name may be missing for lite listings; provide sane fallback
                try:
                    lut_list = metadata.get("lutname")
                    if isinstance(lut_list, list) and cht < len(lut_list):
                        lut_name = lut_list[cht]
                    else:
                        raise KeyError
                except Exception:
                    # derive a default sequence of colors
                    default_cycle = ["green", "magenta", "cyan", "yellow", "red", "blue", "white"]
                    lut_name = default_cycle[cht % len(default_cycle)]
                color = convert_color_name_to_rgb(lut_name)
                
                for c in range(3):
                    temp_impreview[:, :, c] += channel_data_resized * (color[c] / 255.0)
            temp_impreview = np.clip(temp_impreview, 0, max_pixel_value)
            impreview = temp_impreview
    else:
        with open(fileName, "rb") as f:
            if isrgb:
                for i in range(totalRows):
                    r_start = i * skip_factor
                    offset = basePos + z * zbytesinc + r_start * xs * bytes_per_pixel * 3
                    f.seek(offset, os.SEEK_SET)
                    row_size = xs * 3 * bytes_per_pixel
                    row_bytes = f.read(row_size)
                    if len(row_bytes) < row_size:
                        break
                    row_pixels = np.frombuffer(row_bytes, dtype=dtype).reshape((1, xs, 3))
                    row_pixels_resized = cv2.resize(row_pixels, (xsize, 1), interpolation=cv2.INTER_AREA)
                    impreview[i, :, :] = row_pixels_resized[0, :, :]
            else:
                for i in range(totalRows):
                    r_start = i * skip_factor
                    row_data = np.zeros((xsize, 3), dtype=np.float32)
                    for cht in range(channels):
                        p = channelbytesinc[cht] + r_start * xs * bytes_per_pixel
                        offset = basePos + z * zbytesinc + p
                        f.seek(offset, os.SEEK_SET)
                        row_size = xs * bytes_per_pixel
                        row_bytes = f.read(row_size)
                        if len(row_bytes) < row_size:
                            break
                        row_pixels = np.frombuffer(row_bytes, dtype=dtype).reshape((1, xs))
                        row_pixels_resized = cv2.resize(row_pixels, (xsize, 1), interpolation=cv2.INTER_AREA).flatten()
                        
                        # LUT name may be missing for lite listings; provide sane fallback
                        try:
                            lut_list = metadata.get("lutname")
                            if isinstance(lut_list, list) and cht < len(lut_list):
                                lut_name = lut_list[cht]
                            else:
                                raise KeyError
                        except Exception:
                            default_cycle = ["green", "magenta", "cyan", "yellow", "red", "blue", "white"]
                            lut_name = default_cycle[cht % len(default_cycle)]
                        color = convert_color_name_to_rgb(lut_name)

                        for c in range(3):
                            row_data[:, c] += row_pixels_resized * (color[c] / 255.0)
                    row_data = np.clip(row_data, 0, max_pixel_value)
                    impreview[i, :, :] = row_data

    impreview = impreview.astype(dtype)
    impreview = adjust_image_contrast(impreview, max_pixel_value)
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as temp_file:
        temp_image_path = temp_file.name
        cv2.imwrite(temp_image_path, impreview)
    return temp_image_path

def create_preview_image(metadata, cache_folder, preview_height=256, use_memmap=True, max_cache_size=100):
    """
    Create a preview image from the metadata and save it as a PNG file in the cache folder.
    If a cached image exists, it returns the path to the cached image.
    """
    # Ensure metadata is a dictionary
    if isinstance(metadata, str):  # If metadata is a JSON string, parse it
        metadata = json.loads(metadata)

    # Ensure cache_folder exists
    if not os.path.exists(cache_folder):
        os.makedirs(cache_folder)

    # Generate a unique cache filename using uuid and preview_height
    uid = metadata.get("UniqueID") or metadata.get("uuid") or metadata.get("ImageUUID")
    if not uid:
        # Fallback to a derived stable-ish key using file and dims; final fallback random
        base = f"{metadata.get('LOFFilePath') or metadata.get('LIFFile')}_{metadata.get('xs')}x{metadata.get('ys')}"
        uid = metadata.get("hash") or base or str(_uuid.uuid4())

    uuid = str(uid)
    cache_filename = f"{uuid}_h{preview_height}.png"
    cache_image_path = os.path.join(cache_folder, cache_filename)

    # Check if the cached image exists
    if os.path.exists(cache_image_path):
        return cache_image_path

    temp_image_path = create_png_from_metadata(metadata, preview_height, use_memmap)
    cv2.imwrite(cache_image_path, cv2.imread(temp_image_path))
    os.remove(temp_image_path)
    manage_cache(cache_folder, max_cache_size)

    return cache_image_path

def create_preview_base64_image(metadata, preview_height=256, use_memmap=True):
    """
    Create a preview image from the metadata and return it as a base64 encoded PNG image.
    """
    temp_image_path = create_png_from_metadata(metadata, preview_height, use_memmap)

    mime_type, _ = mimetypes.guess_type(temp_image_path)
    if mime_type is None:
        raise ValueError("Could not determine MIME type of the image.")

    with open(temp_image_path, "rb") as image_file:
        encoded_string = base64.b64encode(image_file.read()).decode("utf-8")

    os.remove(temp_image_path)
    return f"data:{mime_type};base64,{encoded_string}"

def manage_cache(cache_folder, max_cache_size):
    cached_files = glob.glob(os.path.join(cache_folder, "*.png"))
    if len(cached_files) > max_cache_size:
        files_with_mtime = sorted(cached_files, key=os.path.getmtime)
        for file in files_with_mtime[:len(cached_files) - max_cache_size]:
            os.remove(file)

def convert_color_name_to_rgb(color_name):
    color_map = {
        "blue": (0, 0, 255), "red": (255, 0, 0), "yellow": (255, 255, 0),
        "green": (0, 255, 0), "cyan": (0, 255, 255), "magenta": (255, 0, 255),
        "white": (255, 255, 255), "grey": (128, 128, 128), "gray": (128, 128, 128), "black": (0, 0, 0)
    }
    return color_map.get(color_name.strip().lower(), (255, 255, 255))

def adjust_image_contrast(impreview, max_pixel_value):
    im_float = impreview.astype(np.float32)
    min_val, max_val = np.percentile(im_float, [0.01, 99.9])
    max_val = max_val if max_val - min_val > 0 else min_val + 1
    im_adj = np.clip((im_float - min_val) / (max_val - min_val), 0, 1) * max_pixel_value
    return im_adj.astype(impreview.dtype)