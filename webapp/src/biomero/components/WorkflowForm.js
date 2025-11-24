import React, { useEffect } from "react";
import { FormGroup, InputGroup, NumericInput, Switch } from "@blueprintjs/core";
import { useAppContext } from "../../AppContext";

const WorkflowForm = () => {
  const { state, updateState } = useAppContext();

  const ghURL = state.selectedWorkflow?.githubUrl;
  const versionMatch = ghURL?.match(/\/tree\/(v[\d.]+)/);
  const version = versionMatch ? versionMatch[1] : "";
  const workflowMetadata = state.selectedWorkflow?.metadata;

  if (!workflowMetadata) {
    return <div>Loading workflow...</div>;
  }

  // Check if workflow expects ZARR format
  const hasZarrInput = workflowMetadata.inputs?.some(input => 
    input.type === "image" && 
    (input.format === "zarr" || input.format === "ome.zarr")
  );

  // Check if this is a BIAFLOWS workflow (legacy format) 
  // After normalization, we can detect this from raw_metadata if present
  const isBiaflowsWorkflow = workflowMetadata.raw_metadata?.inputs?.some(input => 
    input.id?.startsWith("cytomine") || input.type === "Number"
  ) || false;

  // Check if workflow expects TIF format
  const hasTifInput = workflowMetadata.inputs?.some(input => 
    input.type === "image" && input.format === "tif"
  );

  const defaultValues = workflowMetadata.inputs.reduce((acc, input) => {
    const defaultValue = input["default-value"];

    // After normalization, types are consistent: integer, float, boolean, string, image, file
    if (input.type === "float" || input.type === "integer") {
      acc[input.id] = defaultValue !== undefined ? Number(defaultValue) : 0;
    } else if (input.type === "boolean") {
      acc[input.id] =
        defaultValue !== undefined ? Boolean(defaultValue) : false;
    } else {
      // string, image, file all treated as strings
      acc[input.id] = defaultValue || "";
    }
    return acc;
  }, {});

  useEffect(() => {
    const initialFormData = { ...defaultValues, ...state.formData, version };
    
    // Auto-enable ZARR format if workflow expects it
    if (hasZarrInput && !state.formData?.useZarrFormat) {
      initialFormData.useZarrFormat = true;
    }
    
    updateState({ formData: initialFormData });
  }, [state.formData, version, hasZarrInput]);

  const handleInputChange = (id, value) => {
    updateState({
      formData: {
        ...state.formData,
        [id]: value,
      },
    });
  };

  const renderFormFields = () => {
    return workflowMetadata.inputs
      .filter((input) => !input.id.startsWith("cytomine")) // Ignore fields starting with "cytomine"
      .map((input) => {
        const { id, name, description, type, optional } = input;
        const defaultValue = input["default-value"];

        switch (type) {
          case "string":
            return (
              <FormGroup
                key={id}
                label={name}
                labelFor={id}
                helperText={description || ""}
              >
                <InputGroup
                  id={id}
                  value={state.formData[id] || ""}
                  onChange={(e) => handleInputChange(id, e.target.value)}
                  placeholder={defaultValue || name}
                />
              </FormGroup>
            );
          case "image":
            return (
              <FormGroup
                key={id}
                label={name}
                labelFor={id}
                helperText={description || ""}
              >
                <InputGroup
                  id={id}
                  value={state.formData[id] || ""}
                  onChange={(e) => handleInputChange(id, e.target.value)}
                  placeholder={defaultValue || `${name} path`}
                  // TODO: Add image browser/selector component
                />
              </FormGroup>
            );
          case "file":
            return (
              <FormGroup
                key={id}
                label={name}
                labelFor={id}
                helperText={description || ""}
              >
                <InputGroup
                  id={id}
                  value={state.formData[id] || ""}
                  onChange={(e) => handleInputChange(id, e.target.value)}
                  placeholder={defaultValue || `${name} path`}
                  // TODO: Add file browser/selector component
                />
              </FormGroup>
            );
          case "float":
          case "integer":
            return (
              <FormGroup
                key={id}
                label={name}
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
                    // Use string value if it contains a decimal point at the end (partial input)
                    // or if it's invalid (like "1e")
                    if (
                      valueAsString.endsWith(".") ||
                      valueAsString.includes("e") ||
                      isNaN(valueAsNumber) ||
                      valueAsNumber === null
                    ) {
                      handleInputChange(id, valueAsString);
                    } else {
                      // Use the number value for complete valid numbers
                      handleInputChange(id, valueAsNumber);
                    }
                  }}
                  onBlur={(e) => {
                    // Convert to final number on blur, fallback to 0 if invalid
                    const finalValue = parseFloat(e.target.value);
                    handleInputChange(id, isNaN(finalValue) ? 0 : finalValue);
                  }}
                  onKeyDown={(e) => {
                    // Also handle Enter key like the example
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
            return (
              <FormGroup
                key={id}
                label={name}
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
      });
  };

  return (
    <form>
      <h2>{workflowMetadata.workflow}</h2>
      {renderFormFields()}
      
      {/* Experimental ZARR Format Support */}
      <FormGroup
        label="Use ZARR Format (Experimental)"
        labelFor="useZarrFormat"
        helperText={
          hasZarrInput 
            ? "✅ This workflow expects ZARR format - automatically enabled."
            : (state.formData?.useZarrFormat && (isBiaflowsWorkflow || hasTifInput))
              ? "⚠️ WARNING: This workflow expects TIF format. ZARR may not work properly."
              : "⚠️ Experimental feature: Skip TIFF conversion and use ZARR format directly. Only use if your workflow supports ZARR input."
        }
        intent={
          (state.formData?.useZarrFormat && (isBiaflowsWorkflow || hasTifInput)) 
            ? "danger" 
            : hasZarrInput 
              ? "success" 
              : "none"
        }
      >
        <Switch
          id="useZarrFormat"
          checked={state.formData?.useZarrFormat || false}
          onChange={(e) => handleInputChange('useZarrFormat', e.target.checked)}
          label={hasZarrInput ? "Enable ZARR Format (Auto-detected)" : "Enable ZARR Format"}
          intent={
            (state.formData?.useZarrFormat && (isBiaflowsWorkflow || hasTifInput)) 
              ? "danger" 
              : hasZarrInput 
                ? "success" 
                : "none"
          }
        />
      </FormGroup>
    </form>
  );
};

export default WorkflowForm;
