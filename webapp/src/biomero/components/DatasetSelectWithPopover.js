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
  intent = "",
  allowedCategories = ["datasets", "plates", "screens"], // default: allow most except projects
}) => {
  const { state, updateState, toaster } = useAppContext();
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
      if (category === "projects") {
        message =
          "Projects cannot be selected. Expand the project and choose a dataset or plate.";
      } else if (category === "screens") {
        message =
          allowedCategories.includes("plates")
            ? "Screens cannot be selected directly. Expand and select a plate."
            : "Screens cannot be selected for this output. Select or create a dataset.";
      } else if (category === "plates") {
        message =
          allowedCategories.includes("plates")
            ? "Plate selection currently disabled."
            : "Plates cannot be selected for this output. Select a dataset.";
      } else if (category === "orphaned") {
        message =
          "Orphaned images container cannot be selected. Choose a dataset.";
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

  return (
    <FormGroup
      label={label}
      labelFor="upload-ex-dataset-options"
      helperText={helperText}
      subLabel={subLabel}
      intent={intent}
    >
      <TagInput
        placeholder="Add new dataset name or select..."
        values={value || []}
        onChange={handleManualInputChange}
        onKeyDown={handleKeyDown}
        intent={intent}
        rightElement={
          <Popover
            interactionKind={PopoverInteractionKind.CLICK}
            isOpen={isPopoverOpen}
            onInteraction={(state) => setPopoverOpen(state)}
            content={
              <div className="flex flex-col h-[60vh]">
                <div className="flex-1 overflow-y-auto p-4">
                  <OmeroDataBrowser
                    onSelectCallback={(folder) => handleInputChange(folder)}
                  />
                </div>
                <div className="p-4 border-t bg-white">
                  <div className="flex justify-end">
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
        }
      />
    </FormGroup>
  );
};

export default DatasetSelectWithPopover;
