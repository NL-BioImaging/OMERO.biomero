import React, { useState, useEffect } from "react";
import { InputGroup, FormGroup, Switch } from "@blueprintjs/core";
import { useAppContext } from "../../AppContext";
import DatasetSelectWithPopover from "./DatasetSelectWithPopover.js";

const WorkflowOutput = ({ onSelectionChange }) => {
  const { state, updateState } = useAppContext();
  const [renamePattern, setRenamePattern] = useState("");
  const [hasOutputSelection, setHasOutputSelection] = useState(true);
  const outputOptions = [
    "importAsZip",
    "uploadCsv",
    "attachToOriginalImages",
    "selectedDatasets",
  ];
  const defaultValues = {
    receiveEmail: true,
    importAsZip: true,
    uploadCsv: true,
    attachToOriginalImages: false,
    selectedDatasets: [],
    renamePattern: "",
  };

  useEffect(() => {
    // Merge default values into formData, ensuring missing values are populated
    updateState({ formData: { ...defaultValues, ...state.formData } });
  }, [state.formData]);

  useEffect(() => {
    // Tell the parent
    onSelectionChange(hasOutputSelection);
  }, [hasOutputSelection]);

  useEffect(() => {
    const inputs = state.inputDatasets || [];
    if (inputs.length === 0) return;
    const hasPlate = inputs.some((d) => d?.category === "plates");
    const allDatasets = inputs.every((d) => d?.category === "datasets");

    // If any plate present (alone or mixed), don't auto-populate (and clear existing auto defaults)
    if (hasPlate || !allDatasets) {
      if (state.formData.selectedDatasets?.length) {
        handleInputChange("selectedDatasets", []); // clear; requirement: empty when plates involved
      }
      return;
    }

    // Only auto-populate when all inputs are datasets and nothing chosen yet
    if (
      allDatasets &&
      (!state.formData.selectedDatasets ||
        state.formData.selectedDatasets.length === 0)
    ) {
      const inputDatasetNames = inputs.map((dataset) => dataset.data);
      handleInputChange("selectedDatasets", inputDatasetNames);
    }
  }, [state.inputDatasets]);

  const handleInputChange = (key, value) => {
    // Compute new state immediately
    const updatedFormData = {
      ...state.formData,
      [key]: value,
    };

    updateState({ formData: updatedFormData });

    if (outputOptions.includes(key)) {
      // Check if at least one of the output options is still selected
      const hasSelection = outputOptions.some((opt) =>
        Array.isArray(updatedFormData[opt])
          ? updatedFormData[opt].length > 0
          : !!updatedFormData[opt]
      );
      setHasOutputSelection(hasSelection);
    }
  };

  const handleRenamePatternChange = (e) => {
    setRenamePattern(e.target.value);
    handleInputChange("renamePattern", e.target.value);
  };

  return (
    <form>
      <h2>Output Options</h2>

      {/* Receive Email Option */}
      <FormGroup
        label="Receive E-mail on Completion?"
        labelFor="email-notification"
        helperText="Receive an email notification when the workflow finishes."
      >
        <Switch
          id="email-notification"
          checked={state.formData.receiveEmail ?? defaultValues.receiveEmail}
          onChange={(e) => handleInputChange("receiveEmail", e.target.checked)}
        />
      </FormGroup>

      {/* Import Options */}
      <FormGroup
        label="How would you like to add the workflow results to OMERO?"
        labelFor="import-options"
        subLabel={
          <span>
            Select{" "}
            <strong
              className={hasOutputSelection ? "" : "font-bold text-red-500"}
            >
              one or more
            </strong>{" "}
            options below for how you want the data resulting from this workflow
            imported back into OMERO
          </span>
        }
        intent={hasOutputSelection ? "" : "danger"}
      >
        {/* Zip File Option */}
        <FormGroup
          label="Add results as a zip file archive."
          labelFor="upload-zip-options"
          helperText="Archive the output package (e.g., images, CSVs) as a zip file attached to the parent dataset/project."
          intent={hasOutputSelection ? "" : "danger"}
        >
          <Switch
            id="upload-zip-options"
            checked={state.formData.importAsZip ?? defaultValues.importAsZip}
            onChange={(e) => handleInputChange("importAsZip", e.target.checked)}
            intent={hasOutputSelection ? "" : "danger"}
          />
        </FormGroup>

        {/* OMERO Tables Option */}
        <FormGroup
          label="Add results as OMERO tables."
          labelFor="upload-csv-options"
          helperText="Upload the output CSVs as interactive OMERO tables for further analysis."
          intent={hasOutputSelection ? "" : "danger"}
        >
          <Switch
            id="upload-csv-options"
            checked={state.formData.uploadCsv ?? defaultValues.uploadCsv}
            onChange={(e) => handleInputChange("uploadCsv", e.target.checked)}
            intent={hasOutputSelection ? "" : "danger"}
          />
        </FormGroup>

        {/* Attachments to Original Images */}
        <FormGroup
          label="Add results as attachments to input images."
          labelFor="upload-images-options"
          helperText="Attach the output images (e.g., masks) to the original input images to track their provenance."
          intent={hasOutputSelection ? "" : "danger"}
        >
          <Switch
            id="upload-images-options"
            checked={
              state.formData.attachToOriginalImages ??
              defaultValues.attachToOriginalImages
            }
            onChange={(e) =>
              handleInputChange("attachToOriginalImages", e.target.checked)
            }
            intent={hasOutputSelection ? "" : "danger"}
          />
        </FormGroup>

        {/* Dataset Selection with Popover */}
        <DatasetSelectWithPopover
          label="Add results to a new or existing dataset."
          helperText="The output images will be organized in an OMERO dataset for viewing and further analysis."
          subLabel="Don't forget to press ENTER if you type a new name!"
          tooltip="Select the OMERO dataset for your workflow results."
          buttonText="Select Dataset"
          value={state.formData.selectedDatasets || []}
          onChange={(values, type) => {
            if (type === "manual") {
              handleInputChange(
                "selectedDatasets",
                values?.length ? [values[values.length - 1]] : []
              );
            } else {
              const selectedDataset = values.map(
                (dataset) => state.omeroFileTreeData[dataset].data
              );
              handleInputChange("selectedDatasets", selectedDataset);
            }
          }}
          multiSelect={false}
          intent={hasOutputSelection ? "" : "danger"}
          allowedCategories={["datasets"]}
        />

        {/* Optional Image File Renamer */}
        <FormGroup
          label="Rename result images?"
          labelFor="image-renaming-pattern"
          helperText={
            <>
              <div>
                Use <code>{"{original_file}"}</code> and <code>{"{ext}"}</code>{" "}
                to create a naming pattern for the new images.
              </div>
              <div>
                For example, if the original image is <code>sample1.tiff</code>,
                you can name the result image{" "}
                <code>sample1_nuclei_mask.tiff</code> by using the pattern{" "}
                <code>{"{original_file}_nuclei_mask.{ext}"}</code>.
              </div>
            </>
          }
          disabled={
            !state.formData.selectedDatasets ||
            state.formData.selectedDatasets.length === 0
          }
        >
          <InputGroup
            id="image-renaming-pattern"
            placeholder="e.g., {original_file}_nuclei_mask.{ext}"
            value={renamePattern}
            onChange={handleRenamePatternChange}
            fill={true}
            disabled={
              !state.formData.selectedDatasets ||
              state.formData.selectedDatasets.length === 0
            }
          />
        </FormGroup>
      </FormGroup>
      {!hasOutputSelection && (
        <div className="text-red-500 text-sm">
          Please select at least one output option
        </div>
      )}
    </form>
  );
};

export default WorkflowOutput;
