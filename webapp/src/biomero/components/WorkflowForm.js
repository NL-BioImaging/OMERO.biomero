import React, { useEffect, useState } from "react";
import { FormGroup, InputGroup, NumericInput, Switch, HTMLSelect, Intent, Tag, Callout, Divider, Tooltip, Icon, Collapse, Button } from "@blueprintjs/core";
import { useAppContext } from "../../AppContext";
import { HistoryFieldCue } from "./HistoryFeedback";

const WorkflowForm = () => {
  const { state, updateState } = useAppContext();
  const [selectedVersion, setSelectedVersion] = useState(state.formData?.version || "");
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const ghURL = state.selectedWorkflow?.githubUrl;
  const versionMatch = ghURL?.match(/\/tree\/(v[\d.]+)/);
  const configuredVersion = versionMatch ? versionMatch[1] : "";
  const workflowMetadata = state.selectedWorkflow?.metadata;
  const workflowName = state.selectedWorkflow?.name;
  const workflowVersions = state.workflowVersions?.[workflowName];
  const availableVersions = workflowVersions?.available_versions || [];
  const latestVersion = workflowVersions?.latest_version;
  const slurmOnline = state.slurmStatus === "online";

  // Determine version status
  const getVersionStatus = (version) => {
    if (!slurmOnline) {
      return { intent: Intent.DANGER, message: "SLURM cluster offline" };
    }
    if (!availableVersions.includes(version)) {
      return { intent: Intent.DANGER, message: "Version not available on SLURM" };
    }
    if (version !== latestVersion && latestVersion) {
      return { intent: Intent.WARNING, message: `Outdated version (latest: ${latestVersion})` };
    }
    return { intent: Intent.SUCCESS, message: "Version available" };
  };

  // Helper function to check workflow flags from config and from schema metadata
  const getWorkflowFlags = (workflowName) => {
    const config = state.config;
    let isPlateWorkflow = false;
    let isZarrWorkflow = false;

    // Admin-configured overrides (zarr_workflows / plate_workflows lists)
    if (config?.UI) {
      const plateWorkflows = config.UI.plate_workflows ?
        JSON.parse(config.UI.plate_workflows || '[]') : [];
      const zarrWorkflows = config.UI.zarr_workflows ?
        JSON.parse(config.UI.zarr_workflows || '[]') : [];
      isPlateWorkflow = plateWorkflows.includes(workflowName);
      isZarrWorkflow = zarrWorkflows.includes(workflowName);
    }

    // Schema-level flags auto-detected from the descriptor (bilayers)
    isZarrWorkflow = isZarrWorkflow || (workflowMetadata?.['requires-zarr'] ?? false);
    isPlateWorkflow = isPlateWorkflow || (workflowMetadata?.['requires-plate'] ?? false);

    return { isPlateWorkflow, isZarrWorkflow };
  };

  // Initialize selected version
  useEffect(() => {
    if (!selectedVersion) {
      if (availableVersions.includes(configuredVersion)) {
        setSelectedVersion(configuredVersion);
      } else if (latestVersion) {
        setSelectedVersion(latestVersion);
      } else if (configuredVersion) {
        setSelectedVersion(configuredVersion);
      }
    }
  }, [configuredVersion, availableVersions, latestVersion, selectedVersion]);

  const defaultValues = (workflowMetadata?.inputs || []).reduce((acc, input) => {
    const defaultValue = input["default-value"];
    const choices = input["value-choices"] || [];

    if ((input.type === "string" || input.type === "String") && choices.length > 0) {
      // Choice fields must be strings for OMERO RString validation.
      acc[input.id] = String(defaultValue ?? choices[0]);
    } else if (input.type === "Number" || input.type === "integer" || input.type === "float") {
      acc[input.id] = defaultValue !== undefined ? Number(defaultValue) : 0;
    } else if (input.type === "Boolean" || input.type === "boolean") {
      acc[input.id] =
        defaultValue !== undefined ? Boolean(defaultValue) : false;
    } else {
      acc[input.id] = defaultValue ?? "";
    }
    return acc;
  }, {});

  useEffect(() => {
    if (selectedVersion && workflowMetadata) {
      const mergedFormData = {
        ...defaultValues,
        ...state.formData,
        version: selectedVersion
      };

      // Keep choice fields valid even when stale state contains an empty string.
      (workflowMetadata.inputs || []).forEach((input) => {
        const choices = input["value-choices"] || [];
        if (choices.length === 0) return;

        const allowed = choices.map((choice) => String(choice));
        const defaultChoiceRaw = (input["default-value"] ?? choices[0]);
        const defaultChoice = String(defaultChoiceRaw);
        const currentRaw = mergedFormData[input.id];
        const current = currentRaw ?? "";
        const currentStr = String(current);

        if (currentStr === "" || !allowed.includes(currentStr)) {
          mergedFormData[input.id] = allowed.includes(defaultChoice) ? defaultChoice : allowed[0];
        } else {
          // Normalize to string to avoid sending RInt for string choice fields.
          mergedFormData[input.id] = currentStr;
        }
      });

      updateState({ 
        formData: mergedFormData
      });
    }
  }, [selectedVersion, workflowMetadata]);

  // Force ZARR format when workflow requires it (plate workflows or admin-configured ZARR workflows)
  useEffect(() => {
    if (workflowName) {
      const { isPlateWorkflow, isZarrWorkflow } = getWorkflowFlags(workflowName);
      
      if (isPlateWorkflow || isZarrWorkflow) {
        // Force ZARR for plate workflows or admin-configured ZARR workflows
        updateState({
          formData: {
            ...state.formData,
            Format: "ZARR", // Force zarr format for configured workflows
            useZarrFormat: true, // Force zarr backend flag for configured workflows
          },
        });
      }
    }
  }, [workflowName, state.config, workflowMetadata]);

  if (!workflowMetadata) {
    return <div>Loading workflow...</div>;
  }

  const handleInputChange = (id, value) => {
    updateState({
      formData: {
        ...state.formData,
        [id]: value,
      },
    });
  };

  const renderFormFields = () => {
    const visibleInputs = workflowMetadata.inputs
      .filter((input) => !input.id.startsWith("cytomine"))
      .filter((input) => !input["set-by-server"])
      .filter((input) => !input["output-dir-set"]);

    const beginnerInputs = visibleInputs.filter((inp) => inp.mode !== "advanced");
    const advancedInputs = visibleInputs.filter((inp) => inp.mode === "advanced");

    const renderOne = (input) => {
      const { id, name, description, type, optional } = input;
      const defaultValue = input["default-value"];
      const choices = input["value-choices"] || [];
      const choiceLabels = input["value-choices-labels"] || [];
      const isFormatField = id === "Format";
      const { isPlateWorkflow, isZarrWorkflow } = getWorkflowFlags(workflowName);
      const requiresZarr = isPlateWorkflow || isZarrWorkflow;

        switch (type) {
          case "string":
          case "String":
            // Special handling for Format field when workflow requires ZARR
            if (isFormatField && requiresZarr) {
              return (
                <FormGroup
                  key={id}
                  label={<span>{name} <HistoryFieldCue field={id} /></span>}
                  labelFor={id}
                  helperText="Format is locked to ZARR for admin-configured workflows"
                >
                  <InputGroup
                    id={id}
                    value="ZARR"
                    readOnly={true}
                    disabled={true}
                    intent="primary"
                    rightElement={
                      <Tooltip content="This workflow requires ZARR format (admin-configured)">
                        <Icon icon="lock" intent="primary" />
                      </Tooltip>
                    }
                  />
                </FormGroup>
              );
            }
            // Dropdown when value-choices are provided
            if (choices.length > 0) {
              return (
                <FormGroup
                  key={id}
                  label={<span>{name} <HistoryFieldCue field={id} /></span>}
                  labelFor={id}
                  helperText={description || ""}
                >
                  <HTMLSelect
                    id={id}
                    value={state.formData[id] !== undefined ? String(state.formData[id]) : String(defaultValue ?? choices[0] ?? "")}
                    onChange={(e) => handleInputChange(id, e.target.value)}
                  >
                    {choices.map((choice, i) => {
                      const label = choiceLabels[i] != null ? String(choiceLabels[i]) : String(choice);
                      return <option key={String(choice)} value={String(choice)}>{label}</option>;
                    })}
                  </HTMLSelect>
                </FormGroup>
              );
            }
            return (
              <FormGroup
                key={id}
                  label={<span>{name} <HistoryFieldCue field={id} /></span>}
                labelFor={id}
                helperText={description || ""}
              >
                <InputGroup
                  id={id}
                  value={state.formData[id] ?? ""}
                  onChange={(e) => handleInputChange(id, e.target.value)}
                  placeholder={defaultValue ?? name}
                />
              </FormGroup>
            );
          case "integer":
            return (
              <FormGroup
                key={id}
                  label={<span>{name} <HistoryFieldCue field={id} /></span>}
                labelFor={id}
                helperText={description || ""}
              >
                <NumericInput
                  id={id}
                  value={
                    state.formData[id] !== undefined
                      ? state.formData[id]
                      : defaultValue !== undefined
                      ? defaultValue
                      : 0
                  }
                  stepSize={1}
                  minorStepSize={null}
                  onValueChange={(valueAsNumber, valueAsString) => {
                    if (isNaN(valueAsNumber) || valueAsNumber === null) {
                      handleInputChange(id, valueAsString);
                    } else {
                      handleInputChange(id, Math.trunc(valueAsNumber));
                    }
                  }}
                  onBlur={(e) => {
                    const finalValue = parseInt(e.target.value, 10);
                    handleInputChange(id, isNaN(finalValue) ? 0 : finalValue);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      const finalValue = parseInt(e.currentTarget.value, 10);
                      handleInputChange(id, isNaN(finalValue) ? 0 : finalValue);
                    }
                  }}
                  placeholder={optional ? `Optional ${name}` : name}
                  allowNumericCharactersOnly={true}
                />
              </FormGroup>
            );
          case "float":
            return (
              <FormGroup
                key={id}
                  label={<span>{name} <HistoryFieldCue field={id} /></span>}
                labelFor={id}
                helperText={description || ""}
              >
                <NumericInput
                  id={id}
                  value={
                    state.formData[id] !== undefined
                      ? state.formData[id]
                      : defaultValue !== undefined
                      ? defaultValue
                      : 0
                  }
                  stepSize={0.01}
                  minorStepSize={0.001}
                  onValueChange={(valueAsNumber, valueAsString) => {
                    if (
                      valueAsString.endsWith(".") ||
                      valueAsString.includes("e") ||
                      isNaN(valueAsNumber) ||
                      valueAsNumber === null
                    ) {
                      handleInputChange(id, valueAsString);
                    } else {
                      handleInputChange(id, valueAsNumber);
                    }
                  }}
                  onBlur={(e) => {
                    const finalValue = parseFloat(e.target.value);
                    handleInputChange(id, isNaN(finalValue) ? 0 : finalValue);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      const finalValue = parseFloat(e.currentTarget.value);
                      handleInputChange(id, isNaN(finalValue) ? 0 : finalValue);
                    }
                  }}
                  placeholder={optional ? `Optional ${name}` : name}
                  allowNumericCharactersOnly={false}
                />
              </FormGroup>
            );
          case "Number":
            return (
              <FormGroup
                key={id}
                  label={<span>{name} <HistoryFieldCue field={id} /></span>}
                labelFor={id}
                helperText={description || ""}
              >
                <NumericInput
                  id={id}
                  value={
                    state.formData[id] !== undefined
                      ? state.formData[id]
                      : defaultValue !== undefined
                      ? defaultValue
                      : 0
                  }
                  onValueChange={(valueAsNumber, valueAsString) => {
                    if (
                      valueAsString.endsWith(".") ||
                      valueAsString.includes("e") ||
                      isNaN(valueAsNumber) ||
                      valueAsNumber === null
                    ) {
                      handleInputChange(id, valueAsString);
                    } else {
                      handleInputChange(id, valueAsNumber);
                    }
                  }}
                  onBlur={(e) => {
                    const finalValue = parseFloat(e.target.value);
                    handleInputChange(id, isNaN(finalValue) ? 0 : finalValue);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      const finalValue = parseFloat(e.currentTarget.value);
                      handleInputChange(id, isNaN(finalValue) ? 0 : finalValue);
                    }
                  }}
                  placeholder={optional ? `Optional ${name}` : name}
                  allowNumericCharactersOnly={false}
                />
              </FormGroup>
            );
          case "boolean":
          case "Boolean":
            return (
              <FormGroup
                key={id}
                  label={<span>{name} <HistoryFieldCue field={id} /></span>}
                labelFor={id}
                helperText={description || ""}
              >
                <Switch
                  id={id}
                  checked={
                    state.formData[id] !== undefined
                      ? state.formData[id]
                      : defaultValue || false
                  }
                  onChange={(e) => handleInputChange(id, e.target.checked)}
                  label={name}
                />
              </FormGroup>
            );
          default:
            return null;
        }
      };

    return (
      <>
        {beginnerInputs.map(renderOne)}
        {advancedInputs.length > 0 && (
          <>
            <Divider />
            <Button
              minimal
              small
              rightIcon={advancedOpen ? "chevron-up" : "chevron-down"}
              onClick={() => setAdvancedOpen((o) => !o)}
              className="text-gray-500 mb-2"
            >
              Advanced ({advancedInputs.length})
            </Button>
            <Collapse isOpen={advancedOpen}>
              {advancedInputs.map(renderOne)}
            </Collapse>
          </>
        )}
      </>
    );
  };

  return (
    <form>
      <h2>{workflowMetadata.name || workflowMetadata.workflow}</h2>

      {!state.historyRun && <Callout intent={Intent.PRIMARY} icon="info-sign" className="mb-4">
        Review the workflow parameters before launch. Most fields start with sensible defaults, so in many cases you only need to confirm the version and adjust only those settings relevant to your run.
      </Callout>}
      
      {/* Version Selection */}
      <FormGroup
        label={<span>Workflow Version <HistoryFieldCue field="version" /></span>}
        labelInfo="(required)"
        helperText="Select the version to run on SLURM cluster"
      >
        <div className="flex items-center gap-2">
          <HTMLSelect
            value={selectedVersion}
            onChange={(e) => setSelectedVersion(e.target.value)}
            disabled={!slurmOnline}
          >
            {!selectedVersion && <option value="">Select version...</option>}
            {configuredVersion && (
              <option value={configuredVersion}>
                {configuredVersion} (Configured)
              </option>
            )}
            {availableVersions.map(version => 
              version !== configuredVersion && (
                <option key={version} value={version}>
                  {version} {version === latestVersion ? "(Latest)" : ""}
                </option>
              )
            )}
            {/* Show unavailable configured version as option */}
            {configuredVersion && !availableVersions.includes(configuredVersion) && (
              <option value={configuredVersion} disabled>
                {configuredVersion} (Not Available)
              </option>
            )}
          </HTMLSelect>
          
          {selectedVersion && (
            <Tag
              intent={getVersionStatus(selectedVersion).intent}
              minimal
              round
            >
              {getVersionStatus(selectedVersion).message}
            </Tag>
          )}
        </div>
      </FormGroup>
      
      {/* Warning callouts - only show critical ones inline */}
      {!slurmOnline && (
        <FormGroup helperText="">
          <Callout intent={Intent.DANGER}>
            SLURM cluster is offline. Cannot validate or run workflows.
          </Callout>
        </FormGroup>
      )}
      
      {selectedVersion && slurmOnline && !availableVersions.includes(selectedVersion) && (
        <FormGroup helperText="">
          <Callout intent={Intent.DANGER}>
            Selected version "{selectedVersion}" is not available on the SLURM cluster. 
            {availableVersions.length > 0 ? `Available versions: ${availableVersions.join(", ")}` : "No versions available."}
          </Callout>
        </FormGroup>
      )}
      
      {selectedVersion && selectedVersion !== latestVersion && latestVersion && availableVersions.includes(selectedVersion) && (
        <FormGroup helperText="">
          <Callout intent={Intent.WARNING}>
            You are using an older version. Latest available: {latestVersion}
          </Callout>
        </FormGroup>
      )}
      
      <Divider />
      
      {renderFormFields()}
    </form>
  );
};

export default WorkflowForm;
