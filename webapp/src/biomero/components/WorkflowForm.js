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

  const defaultValues = workflowMetadata.inputs.reduce((acc, input) => {
    const defaultValue = input["default-value"];

    if (input.type === "Number") {
      acc[input.id] = defaultValue !== undefined ? Number(defaultValue) : 0;
    } else if (input.type === "Boolean") {
      acc[input.id] =
        defaultValue !== undefined ? Boolean(defaultValue) : false;
    } else {
      acc[input.id] = defaultValue || "";
    }
    return acc;
  }, {});

  useEffect(() => {
    updateState({ formData: { ...defaultValues, ...state.formData, version } });
  }, [state.formData, version]);

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
          case "String":
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
          case "Number":
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
          case "Boolean":
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
        helperText="⚠️ Experimental feature: Skip TIFF conversion and use ZARR format directly. Only use if your workflow supports ZARR input."
      >
        <Switch
          id="useZarrFormat"
          checked={state.formData?.useZarrFormat || false}
          onChange={(e) => handleInputChange('useZarrFormat', e.target.checked)}
          label="Enable ZARR Format"
        />
      </FormGroup>
    </form>
  );
};

export default WorkflowForm;
