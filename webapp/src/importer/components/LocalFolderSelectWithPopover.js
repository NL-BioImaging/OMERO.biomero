import React, { useState } from "react";
import { Button, Popover, PopoverInteractionKind, Tooltip } from "@blueprintjs/core";
import FileBrowser from "./FileBrowser";
import { useAppContext } from "../../AppContext";

/**
 * A folder-picker that opens a Popover containing the local file tree.
 *
 * Only folders are shown; nodes whose display name contains a '.' are hidden
 * (this removes hidden dirs like .analyzed/.processed and container files
 * like .zarr/.lif from appearing as selectable destinations).
 *
 * Props:
 *   value      – currently selected folder node key (e.g. "uploads/GroupA")
 *   onChange   – called with (folderId) when the user confirms a selection
 *   placeholder – button label when nothing is selected
 */
const LocalFolderSelectWithPopover = ({
  value,
  onChange,
  placeholder = "Select a folder...",
}) => {
  const { state, loadFolderData } = useAppContext();
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const [pendingFolderId, setPendingFolderId] = useState(null);

  const handlePopoverInteraction = (nextOpen) => {
    setIsPopoverOpen(nextOpen);
    // Ensure root-level folder data is loaded when the picker opens
    if (nextOpen && !(state.localFileTreeData?.root?.children?.length > 0)) {
      loadFolderData();
    }
    // Clear pending selection whenever the popover closes without confirming
    if (!nextOpen) {
      setPendingFolderId(null);
    }
  };

  // Called by FileBrowser/FileTree on any node click
  const handleSelectCallback = (nodeData, _coords, _e, deselect = false) => {
    if (deselect) {
      setPendingFolderId(null);
      return;
    }
    // nodeData is a Blueprint TreeNodeInfo object (id = node key) for single clicks,
    // or an array of node keys when coming from context-menu "select all children".
    const nodeId = Array.isArray(nodeData) ? nodeData[0] : nodeData.id;
    const node = state.localFileTreeData?.[nodeId];
    if (node?.isFolder) {
      // Toggle: clicking the already-pending folder deselects it
      setPendingFolderId(nodeId === pendingFolderId ? null : nodeId);
    }
  };

  const handleConfirm = () => {
    if (pendingFolderId) {
      onChange(pendingFolderId);
    }
    setIsPopoverOpen(false);
    setPendingFolderId(null);
  };

  const handleCancel = () => {
    setIsPopoverOpen(false);
    setPendingFolderId(null);
  };

  // Prefer the human-readable display name from the tree; fall back to the raw key
  const displayName = value
    ? (state.localFileTreeData?.[value]?.data || value)
    : null;

  const pendingName = pendingFolderId
    ? (state.localFileTreeData?.[pendingFolderId]?.data || pendingFolderId)
    : null;

  return (
    <Popover
      isOpen={isPopoverOpen}
      onInteraction={handlePopoverInteraction}
      interactionKind={PopoverInteractionKind.CLICK}
      content={
        <div className="flex flex-col" style={{ width: 320, height: 420 }}>
          <div className="flex-1 overflow-y-auto p-2">
            <FileBrowser
              onSelectCallback={handleSelectCallback}
              foldersOnly={true}
              excludeDotNames={true}
              selectedItems={pendingFolderId ? [pendingFolderId] : []}
            />
          </div>
          <div className="p-2 border-t flex items-center justify-between gap-2">
            <span className="text-xs bp5-text-muted truncate">
              {pendingName ? `Selected: ${pendingName}` : "Click a folder to select it"}
            </span>
            <div className="flex gap-2 shrink-0">
              <Button text="Cancel" small={true} onClick={handleCancel} />
              <Button
                text="Select"
                small={true}
                intent="primary"
                disabled={!pendingFolderId}
                onClick={handleConfirm}
              />
            </div>
          </div>
        </div>
      }
    >
      <Tooltip content={displayName || placeholder} disabled={!displayName} placement="top">
        <Button
          text={displayName || placeholder}
          rightIcon="double-caret-vertical"
          icon="folder-close"
          fill={true}
          ellipsizeText={true}
        />
      </Tooltip>
    </Popover>
  );
};

export default LocalFolderSelectWithPopover;
