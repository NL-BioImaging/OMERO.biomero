import React, { useState } from "react";
import { useAppContext } from "../../AppContext";
import {
  H4,
  Button,
  Card,
  Elevation,
  MenuItem,
  Tag,
  Icon,
  Switch,
  NumericInput,
} from "@blueprintjs/core";
import { Select } from "@blueprintjs/select";
import LocalFolderSelectWithPopover from "./LocalFolderSelectWithPopover";

const AdminPanel = () => {
  const { state, saveGroupMappings, loadBiomeroConfig, saveConfigData } = useAppContext();
  const [folderMappings, setFolderMappings] = useState(state.groupFolderMappings || {});
  
  const chunkSize = state.config?.UPLOADER?.chunk_size !== undefined 
    ? parseInt(state.config.UPLOADER.chunk_size) 
    : 100;
  const [chunkSizeInput, setChunkSizeInput] = useState(chunkSize);
  
  // Update local state when global state changes
  React.useEffect(() => {
    setFolderMappings(state.groupFolderMappings || {});
    if (state.config?.UPLOADER?.chunk_size !== undefined) {
      setChunkSizeInput(parseInt(state.config.UPLOADER.chunk_size) || 100);
    }
  }, [state.groupFolderMappings, state.config?.UPLOADER?.chunk_size]);

  // Debounce saving of chunk size to avoid spamming API calls on every keystroke
  React.useEffect(() => {
    const parsedConfigVal = state.config?.UPLOADER?.chunk_size !== undefined
      ? parseInt(state.config.UPLOADER.chunk_size)
      : 100;
      
    if (chunkSizeInput && !isNaN(chunkSizeInput) && chunkSizeInput !== parsedConfigVal && chunkSizeInput > 0) {
      const handler = setTimeout(async () => {
        await saveUploaderConfig({ chunk_size: chunkSizeInput });
      }, 500);
      return () => clearTimeout(handler);
    }
  }, [chunkSizeInput, state.config?.UPLOADER?.chunk_size]);

  React.useEffect(() => {
    loadBiomeroConfig();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [selectedGroup, setSelectedGroup] = useState("");
  const [selectedFolder, setSelectedFolder] = useState("");

  const uploaderEnabled = state.config?.UPLOADER?.enabled === true || state.config?.UPLOADER?.enabled === "True";
  const uploadToGroupFolderEnabled =
    state.config?.UPLOADER?.upload_to_group_folder === true ||
    state.config?.UPLOADER?.upload_to_group_folder === "True";

  const saveUploaderConfig = async (updates) => {
    const newConfig = {
      ...state.config,
      UPLOADER: {
        ...state.config?.UPLOADER,
        ...updates,
      },
    };
    await saveConfigData(newConfig);
    loadBiomeroConfig();
  };

  const handleUploaderToggle = async () => {
    await saveUploaderConfig({ enabled: !uploaderEnabled });
  };

  const handleUploadToGroupFolderToggle = async () => {
    await saveUploaderConfig({
      upload_to_group_folder: !uploadToGroupFolderEnabled,
    });
  };

  const renderOption = (item, { handleClick, handleFocus, modifiers }) => {
    if (!modifiers.matchesPredicate) {
      return null;
    }
    return (
      <MenuItem
        active={modifiers.active}
        disabled={modifiers.disabled}
        key={item.id}
        onClick={handleClick}
        onFocus={handleFocus}
        roleStructure="listoption"
        text={item.name}
        className="text-sm"
      />
    );
  };

  const handleGroupSelect = (item) => {
    setSelectedGroup(item.id);
  };

  const handleAddMapping = async () => {
    if (selectedGroup !== "" && selectedFolder) {
      const selectedGroupObj = state?.user?.groups?.find(g => g.id === selectedGroup);
      const newMappings = {
        ...folderMappings,
        [selectedGroup]: {
          folder: selectedFolder,
          groupName: selectedGroupObj?.name
        }
      };
      
      if (await saveGroupMappings(newMappings)) {
        setFolderMappings(newMappings);
      }
      setSelectedGroup("");
      setSelectedFolder("");
    }
  };

  const handleEditMapping = (groupId, folder) => {
    setSelectedGroup(parseInt(groupId));
    setSelectedFolder(folder);
  };

  const handleDeleteMapping = async (groupId) => {
    const newMappings = { ...folderMappings };
    delete newMappings[groupId];
    if (await saveGroupMappings(newMappings)) {
      setFolderMappings(newMappings);
    }
  };

  return (
    <div className="p-4">
      <H4>Admin Settings</H4>
      
      <Card elevation={Elevation.TWO} className="mt-4 w-full">
        <h3 className="text-lg font-semibold mb-4">General Settings</h3>
        <Switch
          checked={uploaderEnabled}
          label="Enable Web Uploader"
          onChange={handleUploaderToggle}
          large={true}
        />
        <Switch
          checked={uploadToGroupFolderEnabled}
          label="Upload to group folder"
          onChange={handleUploadToGroupFolderToggle}
          large={true}
          className="mt-4"
        />
        
        <div className="mt-4 max-w-[300px]">
          <label className="bp5-label font-semibold text-sm">
            Uploader Chunk Size (MB)
            <NumericInput
              value={chunkSizeInput}
              onValueChange={(valueAsNumber) => {
                setChunkSizeInput(valueAsNumber);
              }}
              min={1}
              minorStepSize={null}
              stepSize={1}
              className="mt-1"
            />
          </label>
        </div>

        <div className="bp5-text-muted text-sm mt-3">
          When enabled, the "Upload images" tab will be visible to all users.
        </div>
        <div className="bp5-text-muted text-sm mt-2">
          When enabled, uploaded files are assembled under the active group's mapped folder in uploads/username instead of the shared uploader destination.
        </div>
        <div className="bp5-text-muted text-sm mt-2">
          Uploader chunk size specifies the chunk size in MB for resumable uploads. Lower values help if reverse proxies (like Nginx) limit POST request sizes.
        </div>
      </Card>

      <Card elevation={Elevation.TWO} className="mt-4 w-full">
        <h3 className="text-lg font-semibold mb-4">Group Folder Mappings</h3>
        
        <div className="mb-4">
          <div className="flex flex-col gap-4 md:flex-row">
            <div className="min-w-0 flex-1">
              <Select
                items={state?.user?.groups || []}
                itemRenderer={renderOption}
                onItemSelect={handleGroupSelect}
                activeItem={state?.user?.groups?.find(g => g.id === selectedGroup)}
                filterable={false}
                noResults={
                  <MenuItem
                    disabled={true}
                    text="No groups available"
                    roleStructure="listoption"
                  />
                }
              >
                <Button
                  text={state?.user?.groups?.find(g => g.id === selectedGroup)?.name || "Select a group..."}
                  rightIcon="double-caret-vertical"
                  icon="people"
                  fill={true}
                />
              </Select>
            </div>

            <div className="min-w-0 flex-1">
              <LocalFolderSelectWithPopover
                value={selectedFolder}
                onChange={(folderId) => setSelectedFolder(folderId)}
              />
            </div>
          </div>

          <div className="mt-4 mb-8 flex justify-stretch sm:justify-end">
            <Button
              onClick={handleAddMapping}
              disabled={selectedGroup === undefined || selectedGroup === "" || !selectedFolder}
              rightIcon="plus"
              intent="success"
              className="w-full sm:w-auto"
            >
              Add mapping
            </Button>
          </div>
        </div>

        <div className="mt-4">
          <h4 className="text-md font-semibold mb-2">Current Mappings:</h4>
          <div className="max-h-64 overflow-y-auto">
          {Object.entries(folderMappings).map(([group, data]) => (
            <Card 
              key={group} 
              className="mb-2 p-3"
              elevation={Elevation.ONE}
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <Tag
                    intent="primary"
                    round={true}
                    icon="people"
                    className="max-w-full"
                  >
                    {data.groupName}
                  </Tag>
                  <Icon icon="arrow-right" className="shrink-0" />
                  <Tag
                    intent="success"
                    round={true}
                    icon="folder-close"
                    className="max-w-full"
                  >
                    {data.folder}
                  </Tag>
                </div>
                <div className="flex shrink-0 self-end space-x-2 sm:self-auto">
                  <Button
                    icon="edit"
                    minimal={true}
                    small={true}
                    intent="primary"
                    onClick={() => handleEditMapping(group, data.folder)}
                  />
                  <Button
                    icon="cross"
                    minimal={true}
                    small={true}
                    intent="danger"
                    onClick={() => handleDeleteMapping(group)}
                  />
                </div>
              </div>
            </Card>
          ))}
          </div>
        </div>
      </Card>
    </div>
  );
};

export default AdminPanel;
