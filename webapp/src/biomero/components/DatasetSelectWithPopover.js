import React, { useState } from "react";
import {
  Button,
  Popover,
  PopoverInteractionKind,
  Tooltip,
  TagInput,
  FormGroup,
} from "@blueprintjs/core";
import OmeroDataBrowser from "../../shared/components/OmeroDataBrowser";
import { useAppContext } from "../../AppContext";

const DatasetSelectWithPopover = ({
  value,
  onChange,
  multiSelect = true,
  label = "",
  helperText = "",
  subLabel = "",
  tooltip = "",
  buttonText = "Add Dataset",
  placeholder = "Add new dataset name or select...",
  intent = "",
  allowedCategories = ["datasets", "plates", "screens"], // default: allow most except projects
  tagProps = undefined, // optional: (value, index) => TagProps for per-tag styling
  onClear = null, // optional: called when user clicks the clear-all X button
}) => {
  const { state, updateState, toaster, loadOmeroTreeData, apiLoading } = useAppContext();
  const [isPopoverOpen, setPopoverOpen] = useState(false);
  const [values, setValues] = useState([]);
  const getCategoryFromId = (id) => {
    if (!id) return undefined;
    if (id.startsWith("project-")) return "projects";
    if (id.startsWith("dataset-")) return "datasets";
    if (id.startsWith("screen-")) return "screens";
    if (id.startsWith("plate-")) return "plates";
    if (id === "orphaned") return "orphaned"; // treat orphaned like images container? disallow by default
    return undefined;
  };

  const isDisallowed = (id, nodeData) => {
    const category = nodeData?.category || getCategoryFromId(id);
    // Always disallow projects
    if (category === "projects") return true;
    // Disallow if not in allowedCategories list
    if (category && !allowedCategories.includes(category)) return true;
    return false;
  };

  const handleInputChange = (nodeData) => {
    const nodeId = nodeData.id;

    if (isDisallowed(nodeId, nodeData)) {
      const category = nodeData?.category || getCategoryFromId(nodeId);
      let message;
      
      // Helper function to get suggested alternatives based on allowedCategories
      const getSuggestedText = () => {
        const suggestions = [];
        if (allowedCategories.includes("datasets")) suggestions.push("dataset");
        if (allowedCategories.includes("plates")) suggestions.push("plate"); 
        if (allowedCategories.includes("screens")) suggestions.push("screen");
        
        if (suggestions.length === 0) return "an allowed item";
        if (suggestions.length === 1) return suggestions[0];
        if (suggestions.length === 2) return `${suggestions[0]} or ${suggestions[1]}`;
        return suggestions.slice(0, -1).join(", ") + `, or ${suggestions[suggestions.length - 1]}`;
      };
      
      if (category === "projects") {
        message = `Projects cannot be selected. Select a ${getSuggestedText()}.`;
      } else if (category === "datasets") {
        message = `Datasets cannot be selected for this output. Select a ${getSuggestedText()}.`;
      } else if (category === "screens") {
        message = allowedCategories.includes("plates")
          ? "Screens cannot be selected directly. Expand and select a plate."
          : `Screens cannot be selected for this output. Select or create a ${getSuggestedText()}.`;
      } else if (category === "plates") {
        message = allowedCategories.includes("plates")
          ? "Plate selection currently disabled."
          : `Plates cannot be selected for this output. Select a ${getSuggestedText()}.`;
      } else if (category === "orphaned") {
        message = `Orphaned images container cannot be selected. Choose a ${getSuggestedText()}.`;
      } else {
        message = "This item cannot be selected here.";
      }
      toaster?.show({ intent: "warning", icon: "warning-sign", message });
      return;
    }
    let updatedSelection;
    if (state.omeroFileTreeSelection.includes(nodeId)) {
      // Remove the node if it was already selected
      updatedSelection = state.omeroFileTreeSelection.filter(
        (id) => id !== nodeId
      );
    } else {
      // Add the node, with multi selection maybe
      if (!multiSelect) {
        updatedSelection = [nodeId];
      } else {
        updatedSelection = [...state.omeroFileTreeSelection, nodeId];
      }
    }
    updateState({ omeroFileTreeSelection: updatedSelection }); // update selector
  };

  const handleManualInputChange = (updatedValues) => {
    setValues(updatedValues); // Update local state
    onChange(updatedValues, "manual"); // Pass the full array to the parent
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault(); // Prevent the default behavior (dialog closing)
    }
  };

  const handleSelectFolder = () => {
    const { omeroFileTreeSelection } = state;
    const validSelection = omeroFileTreeSelection.filter(
      (id) => !isDisallowed(id, state.omeroFileTreeData?.[id])
    );
    const invalidSelection = omeroFileTreeSelection.filter(
      (id) => isDisallowed(id, state.omeroFileTreeData?.[id])
    );

    if (validSelection.length === 0) {
      const allowedHuman = allowedCategories
        .map((c) => c.replace(/s$/, ""))
        .join(" / ");
      toaster?.show({
        intent: "warning",
        icon: "warning-sign",
        message: `Select at least one ${allowedHuman}. Projects and disallowed containers are ignored.`,
      });
      return; // Keep popover open
    }

    if (invalidSelection.length > 0) {
      toaster?.show({
        intent: "warning",
        icon: "filter",
        message: `${invalidSelection.length} item(s) ignored (not allowed here).`,
        timeout: 3000,
      });
    }

    onChange(validSelection); // Pass only valid IDs to parent
    setPopoverOpen(false); // Close popover once selection is made
    updateState({ omeroFileTreeSelection: [] });
  };

  const containsInvalid = state.omeroFileTreeSelection.some((id) =>
    isDisallowed(id, state.omeroFileTreeData?.[id])
  );
  const hasValidItems = state.omeroFileTreeSelection.some(
    (id) => !isDisallowed(id, state.omeroFileTreeData?.[id])
  );

  const [refreshKey, setRefreshKey] = useState(0);

  const handleRefresh = async () => {
    await loadOmeroTreeData();
    setRefreshKey((prev) => prev + 1);
  };

  return (
    <FormGroup
      label={label}
      labelFor="upload-ex-dataset-options"
      helperText={helperText}
      subLabel={subLabel}
      intent={intent}
    >
      <TagInput
        placeholder={placeholder}
        values={value || []}
        onChange={handleManualInputChange}
        onKeyDown={handleKeyDown}
        intent={intent}
        tagProps={tagProps}
        rightElement={
          <div style={{ display: "flex", alignItems: "center" }}>
            {onClear && value?.length > 0 && (
              <Tooltip content="Clear all">
                <Button
                  minimal
                  small
                  icon="cross"
                  intent="danger"
                  onClick={onClear}
                />
              </Tooltip>
            )}
          <Popover
            interactionKind={PopoverInteractionKind.CLICK}
            isOpen={isPopoverOpen}
            onInteraction={(state) => setPopoverOpen(state)}
            content={
              <div className="flex flex-col h-[60vh]">
                <div className="flex-1 overflow-y-auto p-4">
                  <OmeroDataBrowser
                    key={refreshKey}
                    onSelectCallback={(folder) => handleInputChange(folder)}
                  />
                </div>
                <div className="p-4 border-t bg-bp-surface">
                  <div className="flex justify-end gap-2">
                    <Tooltip content="Refresh file tree">
                      <Button
                        icon="refresh"
                        onClick={handleRefresh}
                        loading={apiLoading}
                      />
                    </Tooltip>
                    <Tooltip
                      content={
                        !hasValidItems
                          ? "No valid items selected."
                          : containsInvalid
                          ? "Some selections invalid and will be ignored."
                          : "Confirm selection"
                      }
                    >
                      <Button
                        icon="send-message"
                        onClick={handleSelectFolder}
                        intent={containsInvalid ? "warning" : "primary"}
                        disabled={!hasValidItems}
                      />
                    </Tooltip>
                  </div>
                </div>
              </div>
            }
          >
            <Tooltip
              content={tooltip}
              placement="bottom"
              defaultIsOpen={true}
              usePortal={false}
            >
              <Button icon="folder-open" text={buttonText} />
            </Tooltip>
          </Popover>
          </div>
        }
      />
    </FormGroup>
  );
};

export default DatasetSelectWithPopover;
