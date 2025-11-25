import React, { useState } from "react";
import {
  Button,
  Popover,
  PopoverInteractionKind,
  Tooltip,
  TagInput,
  FormGroup,
} from "@blueprintjs/core";
import FileAttachmentDataBrowser from "./FileAttachmentDataBrowser";
import { useAppContext } from "../../AppContext";

const FilePicker = ({ 
  id, 
  label,
  value, 
  onChange, 
  allowedFormats = [], 
  placeholder = "Select file...",
  helperText = ""
}) => {
  const { state, updateState, toaster, loadFileAttachmentTreeData } = useAppContext();
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);

  const handleInputChange = (nodeData) => {
    const nodeId = nodeData.id; // This is the node's index from FileTree
    
    // Only allow file selection, not projects or datasets
    const actualNode = state.fileAttachmentTreeData?.[nodeId];
    
    if (!actualNode || actualNode.category !== "files" || !actualNode.fileData) {
      toaster?.show({ 
        intent: "warning", 
        icon: "warning-sign", 
        message: "Please select a file, not a folder." 
      });
      return;
    }

    // Check format filtering if allowedFormats is specified
    if (allowedFormats.length > 0) {
      const fileName = actualNode.fileData.name || "";
      const fileExtension = fileName.split('.').pop()?.toLowerCase() || "";
      const mimeType = actualNode.fileData.mimetype || "";
      
      const isAllowed = allowedFormats.some(format => 
        fileName.toLowerCase().includes(format.toLowerCase()) ||
        fileExtension === format.toLowerCase() ||
        mimeType.includes(format.toLowerCase())
      );
      
      if (!isAllowed) {
        toaster?.show({
          intent: "warning",
          icon: "filter",
          message: `File format not allowed. Expected: ${allowedFormats.join(', ')}`
        });
        return;
      }
    }

    // Update selection in context (single selection for files)
    let updatedSelection;
    if (state.fileAttachmentTreeSelection.includes(nodeId)) {
      // Remove if already selected
      updatedSelection = state.fileAttachmentTreeSelection.filter(id => id !== nodeId);
    } else {
      // Single file selection only
      updatedSelection = [nodeId];
    }
    updateState({ fileAttachmentTreeSelection: updatedSelection });
  };

  const handleManualInputChange = (updatedValues) => {
    // Allow manual typing but only take the last value
    const newValue = updatedValues.length > 0 ? updatedValues[updatedValues.length - 1] : "";
    onChange(newValue);
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault(); // Prevent dialog closing
    }
  };

  const handleSelectFile = () => {
    const { fileAttachmentTreeSelection } = state;
    
    if (fileAttachmentTreeSelection.length === 0) {
      toaster?.show({
        intent: "warning",
        icon: "warning-sign", 
        message: "Please select a file.",
      });
      return; // Keep popover open
    }

    const selectedId = fileAttachmentTreeSelection[0];
    const selectedNode = state.fileAttachmentTreeData?.[selectedId];
    
    if (selectedNode?.fileData) {
      // Store both display path and OMERO file info for backend integration
      const fileInfo = {
        path: selectedNode.fileData.path || selectedNode.fileData.name,
        omeroFileId: selectedNode.fileData.id,
        name: selectedNode.fileData.name,
        mimetype: selectedNode.fileData.mimetype,
        size: selectedNode.fileData.size
      };
      
      // For now, pass the path as string to maintain compatibility
      // Backend can be enhanced later to parse OMERO file references
      onChange(fileInfo.path);
      
    //   // Store the full file info in form data for future backend integration
    //   updateState({
    //     formData: {
    //       ...state.formData,
    //       [`${id}_fileInfo`]: fileInfo
    //     }
    //   });
      
      setIsPopoverOpen(false);
      updateState({ fileAttachmentTreeSelection: [] });
    } else {
      toaster?.show({
        intent: "warning",
        icon: "warning-sign",
        message: "Selected item is not a valid file.",
      });
    }
  };

  const hasValidSelection = state.fileAttachmentTreeSelection?.length > 0 &&
    state.fileAttachmentTreeData?.[state.fileAttachmentTreeSelection[0]]?.fileData;

  // Initialize file attachment data when popover opens
  const handlePopoverInteraction = (isOpen) => {
    setIsPopoverOpen(isOpen);
    if (isOpen && !state.fileAttachmentTreeData) {
      if (loadFileAttachmentTreeData) {
        loadFileAttachmentTreeData().catch(error => {
          toaster?.show({
            intent: "danger",
            icon: "error",
            message: "Failed to load file attachments: " + error.message,
          });
        });
      } else {
        toaster?.show({
          intent: "danger",
          icon: "error",
          message: "File attachment system not available",
        });
      }
    }
  };

  return (
    <FormGroup 
      label={label}
      labelFor={id} 
      helperText={helperText}
    >
      <TagInput
        id={id}
        placeholder={placeholder}
        values={value ? [value] : []}
        onChange={handleManualInputChange}
        onKeyDown={handleKeyDown}
        rightElement={
          <Popover
            interactionKind={PopoverInteractionKind.CLICK}
            isOpen={isPopoverOpen}
            onInteraction={handlePopoverInteraction}
            content={
              <div className="flex flex-col h-[60vh]">
                <div className="flex-1 overflow-y-auto p-4">
                  {state.fileAttachmentTreeData ? (
                    <FileAttachmentDataBrowser
                      onSelectCallback={handleInputChange}
                      allowedFormats={allowedFormats}
                    />
                  ) : (
                    <div className="flex items-center justify-center h-full text-gray-500">
                      Loading file attachments...
                    </div>
                  )}
                </div>
                <div className="p-4 border-t bg-white">
                  <div className="flex justify-end">
                    <Tooltip
                      content={
                        !hasValidSelection
                          ? "No file selected."
                          : "Confirm file selection"
                      }
                    >
                      <Button
                        icon="send-message"
                        onClick={handleSelectFile}
                        intent="primary"
                        disabled={!hasValidSelection}
                      />
                    </Tooltip>
                  </div>
                </div>
              </div>
            }
          >
            <Tooltip
              content={`Browse ${allowedFormats.length > 0 ? allowedFormats.join(', ') : 'all'} file attachments`}
              placement="bottom"
            >
              <Button 
                icon="folder-open" 
                text="Browse Attachments"
              />
            </Tooltip>
          </Popover>
        }
      />
    </FormGroup>
  );
};

export default FilePicker;