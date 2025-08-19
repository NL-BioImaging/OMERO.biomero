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
} from "@blueprintjs/core";
import { Select } from "@blueprintjs/select";

const AdminPanel = () => {
  const { state, saveGroupMappings } = useAppContext();
  const [folderMappings, setFolderMappings] = useState(state.groupFolderMappings || {});
  
  // Update local state when global state changes
  React.useEffect(() => {
    setFolderMappings(state.groupFolderMappings || {});
  }, [state.groupFolderMappings]);

  const [selectedGroup, setSelectedGroup] = useState("");
  const [selectedFolder, setSelectedFolder] = useState("");

  // Create items array for folder select
  const folderItems = state.localFileTreeData ? 
    Object.keys(state.localFileTreeData)
      .filter(key => state.localFileTreeData[key].isFolder)
      .map(folder => ({
        id: folder,
        name: folder
      })) : [];

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

  const handleFolderSelect = (item) => {
    setSelectedFolder(item.id);
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
    <div className="h-full overflow-y-auto p-4">
      <H4>Admin Settings</H4>
      
      <Card elevation={Elevation.TWO} className="mt-4 max-w-[800px]">
        <h3 className="text-lg font-semibold mb-4">Group Folder Mappings</h3>
        
        <div className="mb-4">
          <div className="flex space-x-4">
            <div className="flex-1">
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

            <div className="flex-1">
              <Select
                items={folderItems}
                itemRenderer={renderOption}
                onItemSelect={handleFolderSelect}
                activeItem={folderItems.find(f => f.id === selectedFolder)}
                filterable={false}
                noResults={
                  <MenuItem
                    disabled={true}
                    text="No folders available"
                    roleStructure="listoption"
                  />
                }
              >
                <Button
                  text={folderItems.find(f => f.id === selectedFolder)?.name || "Select a folder..."}
                  rightIcon="double-caret-vertical"
                  icon="folder-close"
                  fill={true}
                />
              </Select>
            </div>
          </div>

          <div className="mt-4 mb-8 flex justify-end">
            <Button
              onClick={handleAddMapping}
              disabled={selectedGroup === undefined || selectedGroup === "" || !selectedFolder}
              rightIcon="plus"
              intent="success"
            >
              Add mapping
            </Button>
          </div>
        </div>

        <div className="mt-4">
          <h4 className="text-md font-semibold mb-2">Current Mappings:</h4>
          {Object.entries(folderMappings).map(([group, data]) => (
            <Card 
              key={group} 
              className="mb-2 p-3"
              elevation={Elevation.ONE}
            >
              <div className="flex justify-between items-center">
                <div className="flex items-center space-x-4">
                  <Tag
                    intent="primary"
                    round={true}
                    icon="people"
                    className="min-w-fit"
                  >
                    {data.groupName}
                  </Tag>
                  <Icon icon="arrow-right" />
                  <Tag
                    intent="success"
                    round={true}
                    icon="folder-close"
                    className="min-w-fit"
                  >
                    {data.folder}
                  </Tag>
                </div>
                <div className="flex space-x-2">
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
      </Card>
    </div>
  );
};

export default AdminPanel;