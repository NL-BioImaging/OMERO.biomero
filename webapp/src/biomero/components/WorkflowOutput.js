import React, { useState, useEffect, useMemo, useRef } from "react";
import { Alignment, Card, FormGroup, HTMLSelect, InputGroup, Switch, SwitchCard, Callout, Tooltip, Icon, Divider, Tag } from "@blueprintjs/core";
import { useAppContext } from "../../AppContext";
import { HistoryOutputCue, HistoryDestructiveWarning, WorkflowStepIntro } from "./HistoryFeedback";
import DatasetSelectWithPopover from "./DatasetSelectWithPopover.js";

const MAX_SUGGESTED_DATASET_NAME_LENGTH = 64;

const safeNamePart = (value) => String(value || "")
  .trim()
  .replace(/\s+/g, "_")
  .replace(/[^A-Za-z0-9._-]+/g, "_")
  .replace(/_+/g, "_")
  .replace(/^[-_.]+|[-_.]+$/g, "");

const truncateNamePart = (value, maxLength) => {
  if (value.length <= maxLength) return value;
  return value.slice(0, maxLength).replace(/[-_.]+$/g, "");
};

const padTimestampPart = (value) => String(value).padStart(2, "0");

const formatRunTimestamp = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown_time";
  return [
    date.getFullYear(),
    padTimestampPart(date.getMonth() + 1),
    padTimestampPart(date.getDate()),
  ].join("") + "_" + [
    padTimestampPart(date.getHours()),
    padTimestampPart(date.getMinutes()),
    padTimestampPart(date.getSeconds()),
  ].join("");
};

export const getSuggestedDatasetDestination = (inputs, workflowName, now = new Date()) => {
  const containers = Array.isArray(inputs) ? inputs.filter(Boolean) : [];
  if (containers.length === 0) return null;

  const firstInput = containers[0];
  const firstInputName = String(firstInput?.data || "").trim();

  // A single dataset already is the most useful destination; all other input
  // combinations get a separator-safe, timestamped result dataset name.
  if (containers.length === 1 && firstInput?.category === "datasets" && firstInputName) {
    return { name: firstInputName, id: firstInput.id ?? null };
  }

  const workflowPart = truncateNamePart(
    safeNamePart(workflowName) || "workflow",
    24
  );
  const timestamp = formatRunTimestamp(now);
  const suffix = `_${workflowPart}_${timestamp}`;
  const inputNameLimit = Math.max(8, MAX_SUGGESTED_DATASET_NAME_LENGTH - suffix.length);
  const inputPart = truncateNamePart(safeNamePart(firstInputName) || "input_data", inputNameLimit);

  return {
    name: `${inputPart}${suffix}`,
    id: null,
  };

};

const WorkflowOutput = ({ onSelectionChange, plateMode = false }) => {
  const { state, updateState } = useAppContext();
  const [renamePattern, setRenamePattern] = useState("{original_file}_result.{ext}");
  const [renameValidation, setRenameValidation] = useState({ hasError: false, hasWarning: false, message: "" });
  const renameInputRef = useRef(null);

  // Plate-mode helpers: auto-fill screen tracking, importer check, parent-screen finder
  const autoFilledForPlateId = useRef(null);
  const isImporterEnabled = !plateMode || (window.WEBCLIENT?.UI?.IMPORTER_ENABLED || false);
  const isShallowZarrEnabled = window.WEBCLIENT?.UI?.BIOMERO_SHALLOW_ZARR_ENABLED || false;
  const findParentScreen = (plateId, treeData) => {
    if (!plateId || !treeData) return null;
    const plateKey = `plate-${plateId}`;
    for (const [, node] of Object.entries(treeData)) {
      if (node.category === "screens" && node.children?.includes(plateKey)) return node;
    }
    return null;
  };

  const outputOptions = plateMode
    ? ["importAsZip", "uploadCsv", "attachFileOutputs", "selectedScreens"]
    : ["importAsZip", "uploadCsv", "attachToOriginalImages", "attachFileOutputs", "selectedDatasets"];

  const defaultValues = plateMode
    ? {
        receiveEmail: true,
        importAsZip: false,
        uploadCsv: false,
        attachFileOutputs: false,
        fileOutputTarget: "auto",
        selectedScreens: [],
        selectedScreenId: null,
        importPlateLabelPreview: false,
        plateLabelPreviewName: "",
        createRois: false,
        deleteLabelImagesAfterRois: false,
        clearExistingRois: false,
        clearRoiFilter: "",
        roiLabelPattern: "",
        roiShape: "Polygon",
        roiColor: "",
      }
    : {
        receiveEmail: true,
        importAsZip: false,
        uploadCsv: false,
        attachToOriginalImages: false,
        attachFileOutputs: false,
        fileOutputTarget: "auto",
        selectedDatasets: [],
        selectedDatasetId: null,
        renamePattern: "{original_file}_result.{ext}",
        enableRename: false,
        createRois: false,
        deleteLabelImagesAfterRois: false,
        clearExistingRois: false,
        clearRoiFilter: "",
        roiLabelPattern: "",
        roiShape: "Polygon",
        roiColor: "",
      };

  const hasOutputSelection = useMemo(() => outputOptions.some((opt) =>
    Array.isArray(state.formData?.[opt])
      ? state.formData[opt].length > 0
      : !!state.formData?.[opt]
  ), [state.formData]);

  // Orange warning: zip is on alongside other import options, causing duplicate storage.
  const hasOtherOutputsAlongWithZip = useMemo(() => {
    if (!state.formData.importAsZip) return false;
    if (plateMode) {
      return !!(
        state.formData.uploadCsv ||
        state.formData.attachFileOutputs ||
        (state.formData.selectedScreens?.length > 0)
      );
    }
    return !!(
      state.formData.uploadCsv ||
      state.formData.attachFileOutputs ||
      state.formData.attachToOriginalImages ||
      (state.formData.selectedDatasets?.length > 0)
    );
  }, [
    plateMode,
    state.formData.importAsZip,
    state.formData.uploadCsv,
    state.formData.attachFileOutputs,
    state.formData.attachToOriginalImages,
    state.formData.selectedDatasets,
    state.formData.selectedScreens,
  ]);

  const hasImageOutputDuplication = useMemo(() => {
    if (plateMode || !state.formData.attachToOriginalImages) return false;
    return (state.formData.selectedDatasets?.length ?? 0) > 0 || !!state.formData.importAsZip;
  }, [
    plateMode,
    state.formData.attachToOriginalImages,
    state.formData.selectedDatasets,
    state.formData.importAsZip,
  ]);

  const useDescriptorFallbackSuggestions = useMemo(() => {
    const outputs = state.selectedWorkflow?.metadata?.outputs;
    return Array.isArray(outputs) && outputs.length === 0;
  }, [state.selectedWorkflow?.metadata?.outputs]);

  const outputHints = useMemo(() => {
    const outputs = state.selectedWorkflow?.metadata?.outputs || [];
    const isType = (output, expected) => String(output?.type || "").toLowerCase() === expected;
    const isCsvTableOutput = (output) => {
      const type = String(output?.type || "").toLowerCase();
      if (!["measurement", "file"].includes(type)) return false;
      const formats = Array.isArray(output?.format)
        ? output.format
        : (output?.format ? [output.format] : []);
      return formats.map((fmt) => String(fmt).toLowerCase()).includes("csv");
    };
    const imageOutputs = outputs.filter((output) => isType(output, "image"));
    const labelImageOutputs = imageOutputs.filter((output) => {
      const subtypes = output?.["sub-type"] || output?.subtype || [];
      const values = Array.isArray(subtypes) ? subtypes : [subtypes];
      return values.map((value) => String(value).toLowerCase()).includes("label");
    });
    const measurementOutputs = outputs.filter((output) => isCsvTableOutput(output));
    // Zip is purely opt-in (bulk backup). No output type auto-enables it.
    const zipOutputs = [];
    // File annotation outputs: array/executable/any file (incl. .log) + non-CSV measurement.
    // The backend now excludes only the specific SLURM job log via skip_paths;
    // all other .log files (workflow run.log etc.) are attached normally.
    const fileAnnotationOutputs = outputs.filter((output) => {
      const type = String(output?.type || "").toLowerCase();
      if (["array", "executable", "file"].includes(type)) return true;
      if (type === "measurement") {
        // Non-CSV measurement (parquet, feather, etc.) → file annotation, not table
        const formats = Array.isArray(output?.format)
          ? output.format
          : (output?.format ? [output.format] : []);
        return !formats.map((f) => String(f).toLowerCase()).includes("csv");
      }
      return false;
    });

    const summarize = (items) => {
      const names = items.map((o) => o.name || o.id).filter(Boolean);
      if (names.length === 0) return "";
      const head = names.slice(0, 2).join(", ");
      return names.length > 2 ? `${head}, +${names.length - 2} more` : head;
    };
    // Full list — used in tooltips where there is space to show every item
    const summarizeFull = (items) =>
      items.map((o) => o.name || o.id).filter(Boolean).join(", ");

    const measurementSuggested = measurementOutputs.length > 0 || useDescriptorFallbackSuggestions;
    const fileAnnotationSuggested = fileAnnotationOutputs.length > 0 || useDescriptorFallbackSuggestions;

    return {
      imageCount: imageOutputs.length,
      measurementCount: measurementOutputs.length,
      zipCount: zipOutputs.length,
      fileAnnotationCount: fileAnnotationOutputs.length,
      imageLabel: summarize(imageOutputs),
      imageLabelFull: summarizeFull(imageOutputs),
      measurementLabel: summarize(measurementOutputs),
      measurementLabelFull: summarizeFull(measurementOutputs) || "CSV measurements and tabular outputs",
      zipLabel: summarize(zipOutputs),
      fileAnnotationLabel: summarize(fileAnnotationOutputs),
      fileAnnotationLabelFull: summarizeFull(fileAnnotationOutputs) || "non-image output files",
      importAsZip: zipOutputs.length > 0,
      uploadCsv: measurementSuggested,
      attachFileOutputs: fileAnnotationSuggested,
      hasImageOutput: imageOutputs.length > 0,
      hasLabelImageOutput: labelImageOutputs.length > 0,
      allImageOutputsAreLabels: imageOutputs.length > 0 && labelImageOutputs.length === imageOutputs.length,
      labelImageLabel: summarize(labelImageOutputs),
      labelImageLabelFull: summarizeFull(labelImageOutputs),
    };
  }, [state.selectedWorkflow?.metadata, useDescriptorFallbackSuggestions]);

  const roiCapability = state.capabilities?.roi_postprocessing;
  const roiCapabilityAvailable = roiCapability?.available === true;
  const roiHasDestination = plateMode
    ? (state.formData.selectedScreens?.length ?? 0) > 0
    : (state.formData.selectedDatasets?.length ?? 0) > 0;
  const roiValidationError = !plateMode && !!state.formData.createRois && (
    !roiCapabilityAvailable || !roiHasDestination
  );

  // suggested: workflow hint recommends this option on
  // label: short badge text (may be truncated with "+N more")
  // currentValue: current form state — undefined = untouched, false = explicitly disabled
  // labelFull: full untruncated list used in the tooltip (defaults to label)
  const renderDefaultCue = (suggested, label, currentValue = undefined, labelFull = label) => {
    if (!suggested) return null;
    const overridden = currentValue === false;
    return (
      <Tooltip
        content={overridden
          ? `Suggested for: ${labelFull}. You have turned this off.`
          : `Suggested for: ${labelFull}`}
        placement="top"
      >
        <Tag
          minimal
          round
          intent={overridden ? "warning" : "primary"}
          className="text-xs font-semibold cursor-help"
        >
          {overridden ? "Suggested (off)" : "Suggested"}
        </Tag>
      </Tooltip>
    );
  };

  const getSuggestedState = (suggested, hasSelection, currentValue = undefined) => {
    if (!suggested) return "none";
    if (!hasSelection) return "danger";
    if (suggested && currentValue === false) return "warning";
    if (suggested && hasSelection) return "success";
    return "none";
  };

  const renderDefaultHelperCallout = (suggested, currentValue = undefined) => {
    if (!suggested) return null;
    if (currentValue === false) {
      return (
        <Callout intent="warning" compact minimal className="mt-2 text-sm font-semibold">
          This is suggested for this workflow — re-enable to include these results (if any).
        </Callout>
      );
    }
    return (
      <Callout intent="success" compact minimal className="mt-2 text-sm font-semibold">
        Suggested for this workflow.
      </Callout>
    );
  };

  const renderCardTitle = (icon, title, subtitle = null, cue = null) => (
    <div className="flex items-center gap-2 flex-wrap mb-0.5">
      <Icon icon={icon} size={14} className="text-gray-500" />
      <span className="text-sm font-semibold">{title}</span>
      {cue}
      {subtitle && <span className="text-xs font-semibold text-gray-500">{subtitle}</span>}
    </div>
  );

  useEffect(() => {
    if (plateMode) return;
    // Sync rename fields - if enableRename is false, ensure pattern gets sent as empty or default
    if (state.formData.enableRename === false) {
      // When rename is disabled, still keep the pattern but the boolean will control usage
      setRenamePattern(state.formData.renamePattern || defaultValues.renamePattern);
    }
  }, [state.formData.enableRename]);

  useEffect(() => {
    if (plateMode) return;
    // Auto-disable rename when the dataset destination is cleared
    if ((state.formData.selectedDatasets?.length ?? 0) === 0 && state.formData.enableRename) {
      handleFormDataUpdate({ enableRename: false });
    }
  }, [state.formData.selectedDatasets, plateMode]);

  useEffect(() => {
    if (plateMode) {
      // Plate mode: no rename validation — selection state is the only gate
      onSelectionChange?.(hasOutputSelection && !roiValidationError);
    } else {
      const hasValidationError = state.formData.enableRename && renameValidation.hasError;
      onSelectionChange?.(hasOutputSelection && !hasValidationError && !roiValidationError);
    }
  }, [plateMode, hasOutputSelection, renameValidation, state.formData.enableRename, roiValidationError]);

  const autoFilledDatasets = useRef(false);

  useEffect(() => {
    if (plateMode) return;
    if (autoFilledDatasets.current) return;
    const destination = getSuggestedDatasetDestination(
      state.inputDatasets,
      state.selectedWorkflow?.name
    );
    if (!destination) return;

    // Only auto-populate once and never overwrite an explicit destination.
    if (
      (!state.formData.selectedDatasets ||
        state.formData.selectedDatasets.length === 0)
    ) {
      autoFilledDatasets.current = true;
      updateState({
        formData: {
          ...state.formData,
          selectedDatasets: [destination.name],
          selectedDatasetId: destination.id,
        },
      });
    }
  }, [
    state.inputDatasets,
    state.selectedWorkflow?.name,
    plateMode,
    state.formData,
    updateState,
  ]);

  // Plate-mode: auto-fill the parent screen once per plate ID
  useEffect(() => {
    if (!plateMode) return;
    const plateIds = state.formData?.IDs || [];
    if (plateIds.length === 0 || !state.formData?.plateMode || !state.omeroFileTreeData) return;
    const autoFillKey = plateIds.join(",");
    if (autoFilledForPlateId.current === autoFillKey) return;
    if (state.formData.selectedScreens?.length > 0) {
      autoFilledForPlateId.current = autoFillKey;
      return;
    }
    const parentScreens = plateIds
      .map((plateId) => findParentScreen(plateId, state.omeroFileTreeData))
      .filter(Boolean);
    const uniqueParentScreens = parentScreens.filter(
      (screen, index, screens) => screens.findIndex((candidate) => candidate.id === screen.id) === index
    );
    const firstParentScreen = uniqueParentScreens[0];
    if (firstParentScreen) {
      autoFilledForPlateId.current = autoFillKey;
      updateState({
        formData: {
          ...state.formData,
          selectedScreens: [firstParentScreen.data],
          selectedScreenId: firstParentScreen.id,
        },
      });
    }
  // NOTE: selectedScreens intentionally omitted — including it causes bounce-back when user clears.
  }, [plateMode, state.formData?.IDs, state.formData?.plateMode, state.omeroFileTreeData]);

  const validateRenamePattern = (pattern) => {
    
    if (pattern.trim() === "") {
      return { hasError: true, hasWarning: false, message: "Pattern cannot be empty" };
    }
    
    // Check for invalid variable names
    const validVariables = ['original_file', 'original_ext', 'file', 'ext'];
    const variablePattern = /\{([^}]+)\}/g;
    const foundVariables = [...pattern.matchAll(variablePattern)].map(match => match[1]);
    const invalidVariables = foundVariables.filter(v => !validVariables.includes(v));
    
    if (invalidVariables.length > 0) {
      return { 
        hasError: true, 
        hasWarning: false, 
        message: `Invalid variable(s): {${invalidVariables.join('}, {')}}. Use: {original_file}, {original_ext}, {file}, or {ext}` 
      };
    }
    
    // Check if pattern has any extension: {ext}, {original_ext}, or manual like .csv, .tiff
    const hasVariableExt = pattern.includes("{ext}") || pattern.includes("{original_ext}");
    const hasManualExt = /\.[a-zA-Z0-9]+/.test(pattern);
    
    if (!hasVariableExt && !hasManualExt) {
      return { hasError: false, hasWarning: true, message: "Consider adding an extension like .{ext} or .tiff" };
    }
    
    return { hasError: false, hasWarning: false, message: "" };
  };

  const handleInputChange = (key, value) => {
    // Compute new state immediately
    const updatedFormData = {
      ...state.formData,
      [key]: value,
    };

    updateState({ formData: updatedFormData });

  };

  // Atomic multi-key update — avoids stale-closure bug when updating related fields together
  const handleFormDataUpdate = (changes) => {
    const updatedFormData = { ...state.formData, ...changes };
    updateState({ formData: updatedFormData });
  };

  const handleRenamePatternChange = (e) => {
    const newValue = e.target.value;
    setRenamePattern(newValue);
    handleInputChange("renamePattern", newValue);
    
    // Validate pattern only if rename is enabled
    if (state.formData.enableRename) {
      const validation = validateRenamePattern(newValue);
      setRenameValidation(validation);
    }
    
    // Auto-enable rename if user edits pattern and it's currently disabled
    if (!state.formData.enableRename && newValue !== defaultValues.renamePattern) {
      handleInputChange("enableRename", true);
      // Validate after enabling
      const validation = validateRenamePattern(newValue);
      setRenameValidation(validation);
    }
  };

  const handleExampleClick = (pattern) => {
    setRenamePattern(pattern);

    // Validate pattern
    const validation = validateRenamePattern(pattern);
    setRenameValidation(validation);

    // Apply renamePattern + enableRename in a single update to avoid stale-closure clobber
    const updatedFormData = {
      ...state.formData,
      renamePattern: pattern,
      enableRename: true,
    };
    updateState({ formData: updatedFormData });

    // Focus the input after clicking example
    if (renameInputRef.current) {
      renameInputRef.current.focus();
    }
  };

  const handleRenameEnableChange = (checked) => {
    handleInputChange("enableRename", checked);
    if (checked) {
      // When enabling, make sure we have a valid pattern
      if (!renamePattern || renamePattern === "") {
        const defaultPattern = defaultValues.renamePattern;
        setRenamePattern(defaultPattern);
        handleInputChange("renamePattern", defaultPattern);
        // Validate the default pattern
        const validation = validateRenamePattern(defaultPattern);
        setRenameValidation(validation);
      } else {
        // Validate current pattern
        const validation = validateRenamePattern(renamePattern);
        setRenameValidation(validation);
      }
      // Focus the input field to draw attention
      setTimeout(() => {
        if (renameInputRef.current) {
          renameInputRef.current.focus();
        }
      }, 100);
    } else {
      // Clear validation when disabled
      setRenameValidation({ hasError: false, hasWarning: false, message: "" });
    }
  };

  // Container (dataset / screen) selection helpers — shared across both modes
  const selectedContainers = plateMode ? state.formData.selectedScreens : state.formData.selectedDatasets;
  const selectedContainerId = plateMode ? state.formData.selectedScreenId : state.formData.selectedDatasetId;
  const containerCategory = plateMode ? "screens" : "datasets";
  const containerType = plateMode ? "screen" : "dataset";
  const inputParentNode = useMemo(() => {
    const inputId = state.formData?.IDs?.[0];
    if (!inputId || !state.omeroFileTreeData) return null;
    const childKey = `${plateMode ? "plate" : "dataset"}-${inputId}`;
    const parentCategory = plateMode ? "screens" : "projects";
    return Object.values(state.omeroFileTreeData).find((node) =>
      node.category === parentCategory && node.children?.includes(childKey)
    ) || null;
  }, [plateMode, state.formData?.IDs, state.omeroFileTreeData]);
  const fileOutputTargetOptions = [
    { value: "auto", label: "Auto — result destination, otherwise input container" },
    {
      value: "result_destination",
      label: selectedContainers?.[0]
        ? `Result destination (${selectedContainers[0]})`
        : `Result ${plateMode ? "Screen" : "Dataset"} (not selected)`,
      disabled: !(selectedContainers?.length > 0),
    },
    { value: "input_container", label: `Input ${plateMode ? "Plate" : "Dataset"}` },
    {
      value: "input_parent",
      label: `Input ${plateMode ? "Screen" : "Project"}${inputParentNode?.data ? ` (${inputParentNode.data})` : ""}`,
    },
  ];

  const handleContainerChange = (values, type) => {
    if (type === "manual") {
      const rawName = values.length
        ? values[values.length - 1].replace(/\s*\(ID:\s*\d+\)$/, "").trim()
        : "";
      const matchedNode = rawName
        ? Object.values(state.omeroFileTreeData || {}).find(
            (n) => n.category === containerCategory && n.data === rawName
          )
        : null;
      handleFormDataUpdate(
        plateMode
          ? { selectedScreens: rawName ? [rawName] : [], selectedScreenId: matchedNode?.id ?? null }
          : { selectedDatasets: rawName ? [rawName] : [], selectedDatasetId: matchedNode?.id ?? null }
      );
    } else {
      const node = state.omeroFileTreeData[values[0]];
      if (node) {
        handleFormDataUpdate(
          plateMode
            ? { selectedScreens: [node.data], selectedScreenId: node.id }
            : { selectedDatasets: [node.data], selectedDatasetId: node.id }
        );
      }
    }
  };

  return (
    <form>
      {/* ── Intro ────────────────────────────────────── */}
      <WorkflowStepIntro step="the output destinations and options">
        <span className="text-sm">
          Choose how your workflow results are imported back into OMERO.
            You must select <strong>at least one output option</strong> below.
            <br />
            <Tag minimal round intent="primary" className="px-1">Suggested</Tag>
              options are recommended based on this workflow's declared outputs.
        </span>
      </WorkflowStepIntro>


      {plateMode && !isImporterEnabled && (
        <Callout intent="danger" className="mb-4">
          <strong>Plate workflows require importer integration</strong>
          <br />
          Plate workflows with ZARR outputs are only supported when IMPORTER_ENABLED=true.
          Please contact your administrator to enable importer integration.
        </Callout>
      )}

      {/* Sticky Validation Messages */}
      <div className="sticky top-0 z-10">
        {!hasOutputSelection && (
          <Callout intent="danger" className="mb-2">
            <strong>Please select at least one output option below</strong>
          </Callout>
        )}

        {!plateMode && state.formData.enableRename && renameValidation.message && (
          <Callout
            intent={renameValidation.hasError ? "danger" : "warning"}
            compact
            className="mb-2"
          >
            <strong>Rename Pattern:</strong> {renameValidation.message}
          </Callout>
        )}
        {state.formData.createRois && !roiHasDestination && (
          <Callout intent="danger" compact className="mb-2">
            <strong>ROI creation:</strong> Select a {containerType} destination so the label images are imported first.
          </Callout>
        )}
        {state.formData.createRois && !roiCapabilityAvailable && (
          <Callout intent="danger" compact className="mb-2">
            <strong>ROI creation:</strong> {roiCapability?.reason || "The ROI utility capability has not been confirmed."}
          </Callout>
        )}
      </div>

      {/* ── Workflow Results ───────────────────────────── */}
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Workflow Results</p>
      <p className="text-xs text-gray-500 mb-3">
        Select <strong className={hasOutputSelection ? "" : "text-red-500"}>one or more</strong> options for how
        the workflow output is imported into OMERO.
      </p>


      
      {/* ① Dataset / Screen destination */}
      {(() => {
        const hasDestination = (selectedContainers?.length ?? 0) > 0;
        const _suggested = outputHints.hasImageOutput || (plateMode ? autoFilledForPlateId.current !== null : autoFilledDatasets.current);
        const _currentValue = hasDestination ? undefined : false;
        return (
          <Card compact={true} interactive selected={hasDestination} className="mt-2">
            {renderCardTitle(
              "media",
              `Add (mask) image results to a ${containerType}`,
              `import viewable images into an OMERO ${containerType}`,
              state.historyRun ? <HistoryOutputCue field={plateMode ? "selectedScreens" : "selectedDatasets"} /> : renderDefaultCue(
                _suggested,
                outputHints.imageLabel || containerType,
                _currentValue,
                outputHints.imageLabelFull || `${containerType} destination`
              )
            )}
            <DatasetSelectWithPopover
                label={null}
                helperText={null}
                subLabel={null}
                tooltip={`Select the OMERO ${containerType} for your workflow results.`}
                buttonText={plateMode ? "Select Screen" : "Select Dataset"}
                placeholder={`Add new ${containerType} name or select...`}
                value={(selectedContainers || []).map((name) =>
                  selectedContainerId ? `${name} (ID: ${selectedContainerId})` : name
                )}
                onChange={handleContainerChange}
                multiSelect={false}
                intent={hasOutputSelection ? "" : "danger"}
                allowedCategories={[containerCategory]}
                tagProps={(val) => {
                  const isKnown = /\(ID:\s*\d+\)/.test(String(val));
                  if (isKnown) return {};
                  return {
                    intent: "warning",
                    rightIcon: "help",
                    title: `New name — OMERO will create a new ${containerType} with this name when the workflow runs. To use an existing ${containerType} instead, select it from the menu.`,
                  };
                }}
              />
              {_currentValue === false && (
               <Callout intent={hasOutputSelection ? "primary" : "danger"} compact minimal className="mt-2 text-sm font-semibold">
                Type a new {containerType} name and press Enter, or pick an existing one from the menu.
              </Callout>
              )}
            {!state.historyRun && renderDefaultHelperCallout(
              _suggested,
              _currentValue
            )}
          </Card>
        );
      })()}

      {/* Optional mask-result presentation */}
      <div className="ml-4 pl-3 border-l border-gray-200">
        {plateMode ? (
          (selectedContainers?.length ?? 0) > 0 && isImporterEnabled && isShallowZarrEnabled ? (
            <Card
              compact={true}
              selected={!!state.formData.importPlateLabelPreview}
              className="mt-2"
            >
              <div className="flex items-center justify-between gap-3 mb-1">
                <div className="min-w-0 flex-1">
                  {renderCardTitle(
                    "grid-view",
                    "Create a Plate mask preview",
                    "show one segmentation layer across the Plate",
                    state.historyRun ? <HistoryOutputCue field="importPlateLabelPreview" /> : outputHints.hasLabelImageOutput
                      ? <Tag minimal round intent="primary">Label output detected</Tag>
                      : null
                  )}
                </div>
                <Switch
                  aria-label="Create a Plate mask preview"
                  checked={!!state.formData.importPlateLabelPreview}
                  onChange={(e) => handleFormDataUpdate(
                    e.target.checked
                      ? { importPlateLabelPreview: true }
                      : {
                          importPlateLabelPreview: false,
                          plateLabelPreviewName: "",
                        }
                  )}
                  className="shrink-0 mt-0.5 mb-0"
                />
              </div>

              <Callout intent="primary" compact minimal className="mt-2 text-sm">
                Adds a second Plate to the selected Screen, with each field displaying
                one segmentation mask. The regular workflow result is still imported
                separately.
              </Callout>

              {state.formData.importPlateLabelPreview && (
                <FormGroup
                  label="Segmentation label name (optional)"
                  labelFor="plate-label-preview-name"
                  helperText="Leave empty when one label is common to every image. If several labels are present, enter the label name to choose which mask Plate to create. If no single label can be selected, only this preview is skipped."
                  className="mt-2 mb-0"
                >
                  <InputGroup
                    id="plate-label-preview-name"
                    value={state.formData.plateLabelPreviewName || ""}
                    onChange={(e) => handleInputChange(
                      "plateLabelPreviewName",
                      e.target.value
                    )}
                    placeholder="e.g. nuclei"
                  />
                </FormGroup>
              )}
            </Card>
          ) : null
        ) : state.formData.createRois ? (
          <Card compact={true} selected className="mt-2">
            <div className="flex items-center justify-between gap-3 mb-1">
              <div className="min-w-0 flex-1">
                {renderCardTitle(
                  "polygon-filter",
                  "Create ROIs on original images",
                  "convert imported label images after import",
                  state.historyRun ? <HistoryOutputCue field="createRois" /> : outputHints.hasLabelImageOutput
                    ? <Tag minimal round intent="primary">Label output detected</Tag>
                    : null
                )}
              </div>
              <Switch
                checked={true}
                onChange={(e) => handleInputChange("createRois", e.target.checked)}
                className="shrink-0 mt-0.5 mb-0"
              />
            </div>

            <Callout
              intent={outputHints.allImageOutputsAreLabels ? "success" : "primary"}
              compact
              minimal
              className="mt-2 text-sm"
            >
              <div>
                {outputHints.allImageOutputsAreLabels
                  ? "All declared image outputs are labels. BIOMERO will use them automatically."
                  : "BIOMERO will match imported results to each original image and select label-like outputs automatically. Ambiguous results are skipped without failing the workflow."}
              </div>
              <div className="mt-1">
                Created ROI names include the workflow name and run UUID for provenance and filtering.
              </div>
            </Callout>

            <FormGroup
              label="ROI representation"
              labelFor="roi-shape"
              helperText="Polygon creates outlines; Mask preserves the segmented pixel region."
              className="mt-2 mb-0"
            >
              <HTMLSelect
                id="roi-shape"
                value={state.formData.roiShape || "Polygon"}
                onChange={(e) => handleInputChange("roiShape", e.target.value)}
                options={["Polygon", "Mask"]}
              />
            </FormGroup>

            <FormGroup
              label="ROI color"
              labelFor="roi-color-mode"
              helperText="Auto derives a stable color from the workflow run UUID, so separate ROI runs are visually distinct. A custom color overrides it."
              className="mt-2 mb-0"
            >
              <div className="flex items-center gap-2">
                <HTMLSelect
                  id="roi-color-mode"
                  value={state.formData.roiColor ? "custom" : "auto"}
                  onChange={(e) => handleInputChange(
                    "roiColor",
                    e.target.value === "custom"
                      ? (state.formData.roiColor || "#147EB3")
                      : ""
                  )}
                  options={[
                    { label: "Auto — based on run UUID", value: "auto" },
                    { label: "Choose a color", value: "custom" },
                  ]}
                />
                {state.formData.roiColor && (
                  <>
                    <input
                      type="color"
                      aria-label="ROI color picker"
                      value={state.formData.roiColor}
                      onChange={(e) => handleInputChange("roiColor", e.target.value.toUpperCase())}
                      className="h-8 w-12 cursor-pointer rounded border border-gray-300 bg-white p-0.5"
                    />
                    <span className="font-mono text-xs text-gray-600">
                      {state.formData.roiColor}
                    </span>
                  </>
                )}
              </div>
            </FormGroup>

            <FormGroup
              label={<span>Imported label images <HistoryOutputCue field="deleteLabelImagesAfterRois" /></span>}
              labelFor="roi-label-image-retention"
              helperText="Workflow files in .analyzed are preserved."
              className="mt-2 mb-0"
            >
              <HTMLSelect
                id="roi-label-image-retention"
                value={state.formData.deleteLabelImagesAfterRois ? "delete" : "keep"}
                onChange={(e) => handleInputChange(
                  "deleteLabelImagesAfterRois",
                  e.target.value === "delete"
                )}
                options={[
                  { label: "Keep in OMERO", value: "keep" },
                  {
                    label: "Delete from OMERO after ROI creation",
                    value: "delete",
                  },
                ]}
              />
            </FormGroup>

            <FormGroup
              helperText="New ROIs are always added to the original images. Enable this only when older ROIs on those originals should be removed first."
              className="mt-2 mb-0"
            >
              <Switch
                label={<span>Clear existing ROIs on original images <HistoryOutputCue field="clearExistingRois" /></span>}
                checked={!!state.formData.clearExistingRois}
                onChange={(e) => handleInputChange("clearExistingRois", e.target.checked)}
                className="mb-0"
              />
            </FormGroup>

            <HistoryDestructiveWarning field="clearExistingRois" label="ROI clearing" />
            <HistoryDestructiveWarning field="deleteLabelImagesAfterRois" label="Label deletion" />
            {state.formData.clearExistingRois && (
              <FormGroup
                label="Only clear ROI names containing (optional)"
                labelFor="roi-clear-filter"
                helperText="Case-sensitive. Leaving the filter empty removes every existing ROI from each original image before this run's ROIs are added."
                className="mt-2 mb-0"
              >
                <InputGroup
                  id="roi-clear-filter"
                  value={state.formData.clearRoiFilter || ""}
                  onChange={(e) => handleInputChange("clearRoiFilter", e.target.value)}
                  placeholder="e.g. cellpose or a workflow UUID"
                />
              </FormGroup>
            )}
          </Card>
        ) : (
          <>
            <SwitchCard
              alignIndicator={Alignment.END}
              checked={false}
              disabled={!roiCapabilityAvailable}
              onChange={(e) => handleFormDataUpdate({
                createRois: e.target.checked,
                roiShape: state.formData.roiShape || "Polygon",
                roiColor: state.formData.roiColor || "",
                ...(e.target.checked
                  ? { roiLabelPattern: outputHints.allImageOutputsAreLabels ? "*" : "" }
                  : {}),
              })}
              className="mt-2"
              compact={true}
            >
              {renderCardTitle(
                "polygon-filter",
                "Create ROIs on original images",
                "optional postprocessing after label image import",
                state.historyRun ? <HistoryOutputCue field="createRois" /> : outputHints.hasLabelImageOutput
                  ? <Tag minimal round intent="primary">Label output detected</Tag>
                  : null
              )}
            </SwitchCard>
            {!roiCapabilityAvailable && (
              <Callout intent="warning" compact minimal className="mt-1 text-sm">
                {roiCapability?.reason || "Checking whether the Labels2Rois utility is installed."}
              </Callout>
            )}
          </>
        )}
      </div>

      {/* 1b. Rename result images (dataset mode only) */}
      {!plateMode && (
        <div className="ml-4 pl-3 border-l border-gray-200">
          {(() => {
            const _enabled = state.formData.enableRename ?? defaultValues.enableRename;
            const _hasDataset = (state.formData.selectedDatasets?.length ?? 0) > 0;
            const _disabled = !_hasDataset;
            const _hasError = _enabled && renameValidation.hasError;
            return _enabled ? (
              // Expanded: plain Card + explicit Switch so form inputs are fully interactive
              <Card compact={true} selected className="mt-2">
                <div className="flex items-center justify-between gap-3 mb-1">
                  <div className="min-w-0 flex-1">
                    {renderCardTitle("edit", "Rename result images", "optional naming pattern for imported images", <HistoryOutputCue field="enableRename" />)}
                  </div>
                  <Switch
                    checked={true}
                    onChange={(e) => handleRenameEnableChange(e.target.checked)}
                    disabled={_disabled}
                    className="shrink-0 mt-0.5 mb-0"
                  />
                </div>
                <FormGroup
                  label="Pattern"
                  labelFor="image-renaming-pattern"
                  className="mt-2 mb-0"
                  helperText={
                    <>
                      <div>
                        <strong>Input variables:</strong> <code>{"{original_file}"}</code> (filename without extension), <code>{"{original_ext}"}</code> (extension)
                      </div>
                      <div>
                        <strong>Result variables:</strong> <code>{"{file}"}</code> (result filename without extension), <code>{"{ext}"}</code> (result extension)
                      </div>
                      <div className="mt-2"><strong>Examples — click to use:</strong></div>
                      <ul className="list-disc list-inside mt-1 text-xs ml-4">
                        <li>
                          <code
                            className="cursor-pointer hover:bg-blue-100 px-1 rounded"
                            onClick={() => handleExampleClick("{original_file}_mask.{ext}")}
                            title="Click to use this pattern"
                          >
                            {"{original_file}_mask.{ext}"}
                          </code> → original name + result extension
                        </li>
                        <li>
                          <code
                            className="cursor-pointer hover:bg-blue-100 px-1 rounded"
                            onClick={() => handleExampleClick("{file}_processed.{original_ext}")}
                            title="Click to use this pattern"
                          >
                            {"{file}_processed.{original_ext}"}
                          </code> → result name + original extension
                        </li>
                        <li>
                          <code
                            className="cursor-pointer hover:bg-blue-100 px-1 rounded"
                            onClick={() => handleExampleClick("analysis_{original_file}.tif")}
                            title="Click to use this pattern"
                          >
                            {"analysis_{original_file}.tif"}
                          </code> → custom prefix + original name + fixed extension
                        </li>
                      </ul>
                    </>
                  }
                >
                  <InputGroup
                    id="image-renaming-pattern"
                    inputRef={renameInputRef}
                    value={renamePattern}
                    onChange={handleRenamePatternChange}
                    fill={true}
                    intent={_hasError ? "danger" : (renameValidation.hasWarning ? "warning" : "none")}
                  />
                </FormGroup>
              </Card>
            ) : (
              // Collapsed: SwitchCard — whole card is clickable to enable
              <SwitchCard
                alignIndicator={Alignment.END}
                checked={false}
                disabled={_disabled}
                onChange={(e) => handleRenameEnableChange(e.target.checked)}
                className="mt-2"
                compact={true}
              >
                {renderCardTitle("edit", "Rename result images", "optional naming pattern for imported images", <HistoryOutputCue field="enableRename" />)}
              </SwitchCard>
            );
          })()}
        </div>
      )}

      {/* ② CSV → OMERO Tables */}
      {(() => {
        const _checked = state.formData.uploadCsv ?? outputHints.uploadCsv ?? defaultValues.uploadCsv;
        return (
          <SwitchCard
            alignIndicator={Alignment.END}
            checked={_checked}
            onChange={(e) => handleInputChange("uploadCsv", e.target.checked)}
            className="mt-2"
            compact={true}
          >
            {renderCardTitle(
              "th-derived",
              "Measurement Tables",
              "csv results as OMERO.tables",
              state.historyRun ? <HistoryOutputCue field="uploadCsv" /> : renderDefaultCue(outputHints.uploadCsv, outputHints.measurementLabel, state.formData.uploadCsv, outputHints.measurementLabelFull)
            )}
            {!state.historyRun && renderDefaultHelperCallout(outputHints.uploadCsv, state.formData.uploadCsv)}
          </SwitchCard>
        );
      })()}

      {/* ③ Individual file annotations */}
      {(() => {
        const _checked = state.formData.attachFileOutputs ?? outputHints.attachFileOutputs ?? defaultValues.attachFileOutputs;
        return (
          <SwitchCard
            alignIndicator={Alignment.END}
            checked={_checked}
            onChange={(e) => handleInputChange("attachFileOutputs", e.target.checked)}
            className="mt-2"
          >
            {renderCardTitle(
              "paperclip",
              "Individual file annotations",
              "attach non-image non-csv output files",
              state.historyRun ? <HistoryOutputCue field="attachFileOutputs" /> : renderDefaultCue(outputHints.attachFileOutputs, outputHints.fileAnnotationLabel, state.formData.attachFileOutputs, outputHints.fileAnnotationLabelFull)
            )}
            {!state.historyRun && renderDefaultHelperCallout(outputHints.attachFileOutputs, state.formData.attachFileOutputs)}
            {_checked && (
              <FormGroup
                label="File annotation destination"
                labelFor="file-output-target"
                className="mt-2 mb-0"
              >
                <HTMLSelect
                  id="file-output-target"
                  aria-label="File annotation destination"
                  fill
                  options={fileOutputTargetOptions}
                  value={state.formData.fileOutputTarget ?? defaultValues.fileOutputTarget}
                  onChange={(e) => handleInputChange("fileOutputTarget", e.target.value)}
                />
              </FormGroup>
            )}
          </SwitchCard>
        );
      })()}

      {/* ④ Attach to input images (dataset mode only) */}
      {!plateMode && (() => {
        const _checked = state.formData.attachToOriginalImages ?? defaultValues.attachToOriginalImages;
        const hasDestination = (selectedContainers?.length ?? 0) > 0;
        return (
          <SwitchCard
            alignIndicator={Alignment.END}
            checked={_checked}
            onChange={(e) => handleInputChange("attachToOriginalImages", e.target.checked)}
            className="mt-2"
          >
            {renderCardTitle(
              "flow-branch",
              "Attach (mask) image results to input images",
              "keep provenance on the original inputs",
               <HistoryOutputCue field="attachToOriginalImages" />
            )}
            {hasImageOutputDuplication && (
              <Callout intent="warning" compact minimal className="mt-2">
                {hasDestination
                  ? `A ${containerType} destination is also selected — image results will be imported twice. Consider using only the ${containerType} destination instead.`
                  : "Bulk ZIP is also selected — image results will be duplicated there as well. Consider disabling one of these outputs if you do not need both."}
              </Callout>
            )}
          </SwitchCard>
        );
      })()}

      {/* ⑤ Bulk ZIP */}
      <SwitchCard
        alignIndicator={Alignment.END}
        checked={state.formData.importAsZip ?? outputHints.importAsZip ?? defaultValues.importAsZip}
        onChange={(e) => handleInputChange("importAsZip", e.target.checked)}
        className="mt-2"
      >
        {renderCardTitle("archive", "Bulk ZIP archive", "single downloadable archive of all results", <HistoryOutputCue field="importAsZip" />)}
        {hasOtherOutputsAlongWithZip && (
          <Callout intent="warning" compact minimal className="mt-2">
            Other output options are also active — the zip will contain all those files too, duplicating storage.
            Use it as a standalone backup or disable the other options if you only need the archive.
          </Callout>
        )}
      </SwitchCard>

      <Divider className="my-3" />

      {/* ── Notifications ───────────────────────────────── */}
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 mt-2">Notifications</p>
      <SwitchCard
        alignIndicator={Alignment.END}
        checked={state.formData.receiveEmail ?? defaultValues.receiveEmail}
        onChange={(e) => handleInputChange("receiveEmail", e.target.checked)}
        className="mt-2"
      >
        {renderCardTitle("envelope", "Email on completion", "SLURM completion or failure notice", <HistoryOutputCue field="receiveEmail" />)}
      </SwitchCard>
    </form>
  );
};

export default WorkflowOutput;
