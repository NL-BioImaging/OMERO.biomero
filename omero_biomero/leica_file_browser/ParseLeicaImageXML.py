import xml.etree.ElementTree as ET

###############################################################################
# Shared metadata parser for images
###############################################################################
def parse_image_xml(xml_element):
    """
    Parses the XML element to extract image metadata like pixel sizes,
    dimensions, color LUTs, channel names, etc.

    Returns:
        A dictionary with the extracted metadata.
    """
    metadata = {}
    metadata['UniqueID'] = None  # Initialize UniqueID
    metadata['ElementName'] = None

    # Initialize metadata with default values
    metadata['xs'] = 1  # x size
    metadata['ys'] = 1  # y size
    metadata['zs'] = 1  # z size (slices)
    metadata['ts'] = 1  # time
    metadata['tiles'] = 1  # tiles
    metadata['channels'] = 1
    metadata['isrgb'] = False
    metadata['xres'] = 0
    metadata['yres'] = 0
    metadata['zres'] = 0
    metadata['resunit'] = ''
    metadata['xres2'] = 0
    metadata['yres2'] = 0
    metadata['zres2'] = 0
    metadata['lutname'] = []
    metadata['channelResolution'] = []
    metadata['channelbytesinc'] = []
    metadata['blackvalue'] = []
    metadata['whitevalue'] = []
    metadata['flipx'] = 0
    metadata['flipy'] = 0
    metadata['swapxy'] = 0
    metadata['tile_positions'] = []
    metadata['objective'] = ''
    metadata['na'] = None
    metadata['refractiveindex'] = None
    metadata['mic_type'] = ''
    metadata['mic_type2'] = ''
    metadata['filterblock'] = []
    metadata['excitation'] = []
    metadata['emission'] = []
    metadata['contrastmethod'] = []

    if xml_element.tag == 'Element':
        metadata['UniqueID'] = xml_element.attrib.get('UniqueID')
        metadata['ElementName'] = xml_element.attrib.get('Name', '')
    else:
        metadata['UniqueID'] = 'none (LOF)'
        metadata['ElementName'] = 'none (LOF)'

    memory_block = xml_element.find('.//Memory/Block')
    if memory_block is not None:
        block_file = memory_block.attrib.get('File')
        if block_file and block_file.lower().endswith('.lof'):
            metadata['LOFFile'] = block_file

    # Extract ImageDescription
    image_description = xml_element.find('.//ImageDescription')
    if image_description is not None:
        # Extract Channels
        channels_element = image_description.find('Channels')
        if channels_element is not None:
            channel_descriptions = channels_element.findall('ChannelDescription')
            metadata['channels'] = len(channel_descriptions)
            if metadata['channels'] > 1:
                channel_tag = channel_descriptions[0].attrib.get('ChannelTag')
                if channel_tag and int(channel_tag) != 0:
                    metadata['isrgb'] = True
            for channel_desc in channel_descriptions:
                bytes_inc = channel_desc.attrib.get('BytesInc')
                resolution = channel_desc.attrib.get('Resolution')
                lut_name = channel_desc.attrib.get('LUTName')
                metadata['channelbytesinc'].append(int(bytes_inc) if bytes_inc else None)
                metadata['channelResolution'].append(int(resolution) if resolution else None)
                metadata['lutname'].append(lut_name.lower() if lut_name else '')
        else:
            # Single channel, handle separately
            channel_desc = image_description.find('.//ChannelDescription')
            if channel_desc is not None:
                bytes_inc = channel_desc.attrib.get('BytesInc')
                resolution = channel_desc.attrib.get('Resolution')
                lut_name = channel_desc.attrib.get('LUTName')
                metadata['channelbytesinc'].append(int(bytes_inc) if bytes_inc else None)
                metadata['channelResolution'].append(int(resolution) if resolution else None)
                metadata['lutname'].append(lut_name.lower() if lut_name else '')
                metadata['channels'] = 1

        # Extract Dimensions
        dimensions_element = image_description.find('Dimensions')
        if dimensions_element is not None:
            dim_descriptions = dimensions_element.findall('DimensionDescription')
            for dim_desc in dim_descriptions:
                dim_id = int(dim_desc.attrib.get('DimID', '0'))
                num_elements = int(dim_desc.attrib.get('NumberOfElements', '0'))
                length = float(dim_desc.attrib.get('Length', '0'))
                bytes_inc = int(dim_desc.attrib.get('BytesInc', '0'))
                unit = dim_desc.attrib.get('Unit', '')
                if unit:
                    metadata['resunit'] = unit

                # Compute resolution
                if num_elements > 1:
                    res = length / (num_elements - 1)
                else:
                    res = 0

                if dim_id == 1:
                    metadata['xs'] = num_elements
                    metadata['xres'] = res
                    metadata['xbytesinc'] = bytes_inc
                elif dim_id == 2:
                    metadata['ys'] = num_elements
                    metadata['yres'] = res
                    metadata['ybytesinc'] = bytes_inc
                elif dim_id == 3:
                    metadata['zs'] = num_elements
                    metadata['zres'] = res
                    metadata['zbytesinc'] = bytes_inc
                elif dim_id == 4:
                    metadata['ts'] = num_elements
                    metadata['tres'] = res
                    metadata['tbytesinc'] = bytes_inc
                elif dim_id == 10:
                    metadata['tiles'] = num_elements
                    metadata['tilesbytesinc'] = bytes_inc

        # Extract ViewerScaling (black and white values)
        attachments = xml_element.findall('.//Attachment')
        viewer_scaling = None
        for attachment in attachments:
            if attachment.attrib.get('Name') == 'ViewerScaling':
                viewer_scaling = attachment
                break
        if viewer_scaling is not None:
            channel_scaling_infos = viewer_scaling.findall('ChannelScalingInfo')
            if channel_scaling_infos:
                for csi in channel_scaling_infos:
                    black_value = float(csi.attrib.get('BlackValue', '0'))
                    white_value = float(csi.attrib.get('WhiteValue', '1'))
                    metadata['blackvalue'].append(black_value)
                    metadata['whitevalue'].append(white_value)
            else:
                csi = viewer_scaling.find('ChannelScalingInfo')
                if csi is not None:
                    black_value = float(csi.attrib.get('BlackValue', '0'))
                    white_value = float(csi.attrib.get('WhiteValue', '1'))
                    metadata['blackvalue'].append(black_value)
                    metadata['whitevalue'].append(white_value)
        else:
            # Default black/white
            for _ in range(metadata['channels']):
                metadata['blackvalue'].append(0)
                metadata['whitevalue'].append(1)

        # Extract TileScanInfo
        tile_scan_info = None
        for attachment in attachments:
            if attachment.attrib.get('Name') == 'TileScanInfo':
                tile_scan_info = attachment
                break
        if tile_scan_info is not None:
            metadata['flipx'] = int(tile_scan_info.attrib.get('FlipX', '0'))
            metadata['flipy'] = int(tile_scan_info.attrib.get('FlipY', '0'))
            metadata['swapxy'] = int(tile_scan_info.attrib.get('SwapXY', '0'))
            tiles = tile_scan_info.findall('Tile')
            for i, tile in enumerate(tiles):
                tile_info = {
                    'num': i + 1,
                    'FieldX': int(tile.attrib.get('FieldX', '0')),
                    'FieldY': int(tile.attrib.get('FieldY', '0')),
                    'PosX': float(tile.attrib.get('PosX', '0')),
                    'PosY': float(tile.attrib.get('PosY', '0')),
                }
                metadata['tile_positions'].append(tile_info)

        # Extract HardwareSetting
        hardware_setting = None
        for attachment in attachments:
            if attachment.attrib.get('Name') == 'HardwareSetting':
                hardware_setting = attachment
                break
        if hardware_setting is not None:
            data_source_type_name = hardware_setting.attrib.get('DataSourceTypeName', '')
            metadata['mic_type2'] = data_source_type_name.lower()
            if data_source_type_name == 'Confocal':
                metadata['mic_type'] = 'IncohConfMicr'
                # Confocal settings
                confocal_setting = hardware_setting.find('ATLConfocalSettingDefinition')
                if confocal_setting is not None:
                    attributes = confocal_setting.attrib
                    metadata['objective'] = attributes.get('ObjectiveName', '')
                    metadata['na'] = float(attributes.get('NumericalAperture', '0'))
                    metadata['refractiveindex'] = float(attributes.get('RefractionIndex', '0'))
                    spectro = confocal_setting.find('Spectro')
                    if spectro is not None:
                        multiband = spectro.findall('MultiBand')
                        for mb in multiband:
                            left_world = float(mb.attrib.get('LeftWorld', '0'))
                            right_world = float(mb.attrib.get('RightWorld', '0'))
                            emission = left_world + (right_world - left_world) / 2
                            metadata['emission'].append(emission)
                            metadata['excitation'].append(emission - 10)
            elif data_source_type_name == 'Camera':
                metadata['mic_type'] = 'IncohWFMicr'
                # Camera settings
                camera_setting = hardware_setting.find('ATLCameraSettingDefinition')
                if camera_setting is not None:
                    attributes = camera_setting.attrib
                    metadata['objective'] = attributes.get('ObjectiveName', '')
                    metadata['na'] = float(attributes.get('NumericalAperture', '0'))
                    metadata['refractiveindex'] = float(attributes.get('RefractionIndex', '0'))
                    wf_channel_config = camera_setting.find('WideFieldChannelConfigurator')
                    if wf_channel_config is not None:
                        wf_channel_infos = wf_channel_config.findall('WideFieldChannelInfo')
                        for wfci in wf_channel_infos:
                            fluo_cube_name = wfci.attrib.get('FluoCubeName', '')
                            contrast_method_name = wfci.attrib.get('ContrastingMethodName', '')
                            metadata['contrastmethod'].append(contrast_method_name)
                            ex_name = fluo_cube_name
                            if fluo_cube_name == 'QUAD-S':
                                ex_name = wfci.attrib.get('FFW_Excitation1FilterName', '')
                            elif fluo_cube_name == 'DA/FI/TX':
                                ex_name = wfci.attrib.get('LUT', '')
                            metadata['filterblock'].append(f"{fluo_cube_name}: {ex_name}")

                            ex_em_wavelengths = {
                                'DAPI': (355, 460),
                                'DAP': (355, 460),
                                'A': (355, 460),
                                'Blue': (355, 460),
                                'L5': (480, 527),
                                'I5': (480, 527),
                                'Green': (480, 527),
                                'FITC': (480, 527),
                                'N3': (545, 605),
                                'N2.1': (545, 605),
                                'TRITC': (545, 605),
                                '488': (488, 525),
                                '532': (532, 550),
                                '642': (642, 670),
                                'Red': (545, 605),
                                'Y3': (545, 605),
                                'I3': (545, 605),
                                'Y5': (590, 700),
                            }
                            ex_em = ex_em_wavelengths.get(ex_name, (0, 0))
                            metadata['excitation'].append(ex_em[0])
                            metadata['emission'].append(ex_em[1])
            else:
                metadata['mic_type'] = 'unknown'
                metadata['mic_type2'] = 'generic'
        else:
            metadata['mic_type'] = 'unknown'
            metadata['mic_type2'] = 'generic'

        # Handle STELLARIS or AF 6000LX (Thunder)
        if hardware_setting is not None:
            system_type_name = hardware_setting.attrib.get('SystemTypeName', '')

            # --- Existing STELLARIS logic ---
            if 'STELLARIS' in system_type_name:
                channels_element = image_description.find('Channels')
                if channels_element is not None:
                    channel_descriptions = channels_element.findall('ChannelDescription')
                    for ch_desc in channel_descriptions:
                        channel_properties = ch_desc.findall('ChannelProperty')
                        for prop in channel_properties:
                            key = prop.find('Key')
                            value = prop.find('Value')
                            if key is not None and key.text.strip() == 'DyeName' and value is not None:
                                metadata['filterblock'].append(value.text.strip())
                                break
            elif 'AF 6000LX' in system_type_name:
                if data_source_type_name == 'Camera':
                    # Grab ALL WideFieldChannelConfigurator blocks
                    wf_channel_config_list = hardware_setting.findall('.//WideFieldChannelConfigurator')
                    for wf_channel_config in wf_channel_config_list:
                        # Skip if it's the HS autofocus instance
                        if wf_channel_config.attrib.get('ThisIsHSAutofocusInstance', '0') == '1':
                            continue

                        # Now parse the actual WideFieldChannelInfo blocks
                        wf_channel_infos = wf_channel_config.findall('WideFieldChannelInfo')
                        for wfci in wf_channel_infos:
                            fluo_cube_name = wfci.attrib.get('FluoCubeName', '')
                            emission_str = wfci.attrib.get('EmissionWavelength', '0')
                            try:
                                emission_val = float(emission_str)
                            except ValueError:
                                emission_val = 0.0

                            # Find the highest ILLEDWavelength_i where ILLEDActiveState_i="1"
                            valid_excitation_wavelength = 0.0
                            for i in range(8):
                                active_state = wfci.attrib.get(f'ILLEDActiveState{i}', '0')
                                if active_state == '1':
                                    w_str = wfci.attrib.get(f'ILLEDWavelength{i}', '0')
                                    try:
                                        w_val = float(w_str)
                                    except ValueError:
                                        w_val = 0.0
                                    valid_excitation_wavelength = w_val

                            # Append to metadata fields
                            metadata['excitation'].append(valid_excitation_wavelength)
                            metadata['emission'].append(emission_val)

                            # Build filterblock as "FluoCubeName + emission"
                            block_label = f"{fluo_cube_name} {int(emission_val)}"
                            metadata['filterblock'].append(block_label)

                            # Also store contrast method if wanted
                            contrast_method_name = wfci.attrib.get('ContrastingMethodName', '')
                            metadata['contrastmethod'].append(contrast_method_name)


    # Convert resolution units to micrometers
    unit = metadata['resunit'].lower()
    if unit in ['meter', 'm']:
        factor = 1e6
    elif unit == 'centimeter':
        factor = 1e4
    elif unit == 'inch':
        factor = 25400
    elif unit == 'millimeter':
        factor = 1e3
    elif unit == 'micrometer':
        factor = 1
    else:
        factor = 1  # Default to micrometers
    metadata['xres2'] = metadata['xres'] * factor
    metadata['yres2'] = metadata['yres'] * factor
    metadata['zres2'] = metadata['zres'] * factor
    metadata['resunit2'] = 'micrometer'

    # Defaults if empty
    channels_count = metadata.get('channels', 1)
    if not metadata['emission']:
        metadata['emission'] = [500] * channels_count
    if not metadata['excitation']:
        metadata['excitation'] = [480] * channels_count

    # Consolidate dimensions
    metadata['dimensions'] = {
        'x': metadata['xs'],
        'y': metadata['ys'],
        'z': metadata['zs'],
        'c': metadata['channels'],
        't': metadata['ts'],
        's': metadata['tiles'],
        'isrgb': metadata['isrgb'],
    }

    return metadata