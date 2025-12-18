import React, { useEffect, useState } from "react";
import { FormGroup, InputGroup, NumericInput, Switch, HTMLSelect, Intent, Tag, Callout, Slider, Divider, Tooltip, Button } from "@blueprintjs/core";
import { useAppContext } from "../../AppContext";

const WorkflowForm = () => {
  const { state, updateState } = useAppContext();
  const [selectedVersion, setSelectedVersion] = useState("");
  const [batchEnabled, setBatchEnabled] = useState(false);
  const [unlockDangerousJobs, setUnlockDangerousJobs] = useState(false);
  
  // Calculate batch size from job count
  const calculateBatchSizeFromJobCount = (totalImages, jobCount) => {
    if (jobCount <= 1) return totalImages;
    return Math.ceil(totalImages / jobCount);
  };

  // Calculate job count from batch size  
  const calculateJobCountFromBatchSize = (totalImages, batchSize) => {
    if (batchSize <= 0) return 1;
    return Math.ceil(totalImages / batchSize);
  };

  // Get smart default job count
  const getDefaultJobCount = (totalImages) => {
    if (totalImages <= 1) return 1;
    if (totalImages <= 10) return Math.min(2, totalImages);
    if (totalImages <= 64) return Math.min(4, Math.ceil(totalImages / 16));
    if (totalImages <= 200) return 5; // Sweet spot for medium datasets
    return 6; // Conservative for large datasets (matches recommendation)
  };

  const totalImages = state.formData?.IDs?.length || 0;
  const [selectedJobCount, setSelectedJobCount] = useState(() => {
    return totalImages > 0 ? getDefaultJobCount(totalImages) : 2;
  });
  
  const batchSize = calculateBatchSizeFromJobCount(totalImages, selectedJobCount);

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

  // Update selected job count when IDs change
  useEffect(() => {
    const currentTotalImages = state.formData?.IDs?.length || 0;
    if (currentTotalImages > 0) {
      const optimalJobCount = getDefaultJobCount(currentTotalImages);
      if (optimalJobCount !== selectedJobCount || totalImages !== currentTotalImages) {
        setSelectedJobCount(optimalJobCount);
      }
    }
  }, [state.formData?.IDs?.length]);

  useEffect(() => {
    if (selectedVersion) {
      // Calculate batch count based on job count and total images
      const currentTotalImages = state.formData?.IDs?.length || 0;
      const calculatedBatchCount = batchEnabled && currentTotalImages > 0 ? selectedJobCount : 1;
      const calculatedBatchSize = calculateBatchSizeFromJobCount(currentTotalImages, selectedJobCount);
      
      updateState({ 
        formData: { 
          ...defaultValues, 
          ...state.formData, 
          version: selectedVersion,
          batchEnabled: batchEnabled,
          batchCount: calculatedBatchCount,
          batchSize: calculatedBatchSize
        } 
      });
    }
  }, [state.formData, selectedVersion, batchEnabled, selectedJobCount]);

  const handleInputChange = (id, value) => {
    updateState({
      formData: {
        ...state.formData,
        [id]: value,
      },
    });
  };

  const handleBatchToggle = (enabled) => {
    setBatchEnabled(enabled);
  };

  const handleJobCountChange = (jobCount) => {
    setSelectedJobCount(jobCount);
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
      
      {/* Version Selection */}
      <FormGroup
        label="Workflow Version"
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
      
      {/* Batch Processing Section */}
      <FormGroup
        label="Batch Processing"
        helperText={batchEnabled ? 
          `Split ${totalImages} images across ${selectedJobCount} parallel SLURM jobs` :
          "Process all images in a single SLURM job"
        }
      >
        <Switch
          checked={batchEnabled}
          onChange={(e) => handleBatchToggle(e.target.checked)}
          label={
            <Tooltip
              content="Batch processing splits your images across multiple smaller jobs instead of one large job. This can improve performance but adds overhead."
              placement="top"
              intent={Intent.PRIMARY}
            >
              <span>Enable batch processing for large datasets</span>
            </Tooltip>
          }
          disabled={!slurmOnline || totalImages < 2}
        />
        
        {batchEnabled && totalImages > 1 && (
          <div style={{ marginTop: '12px' }}>
            <FormGroup>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ fontWeight: 'bold' }}>
                  {selectedJobCount} parallel jobs ({batchSize} images each)
                </span>
                
                {totalImages > 10 && (
                  <Switch
                    checked={unlockDangerousJobs}
                    onChange={(e) => {
                      const unlock = e.target.checked;
                      setUnlockDangerousJobs(unlock);
                      // Reset to safe value when locking
                      if (!unlock && selectedJobCount > 10) {
                        setSelectedJobCount(10);
                      }
                    }}
                    label={
                      <span style={{ color: '#c23030', fontWeight: unlockDangerousJobs ? 'bold' : 'normal' }}>
                        Allow >10 jobs (dangerous)
                      </span>
                    }
                    intent={Intent.DANGER}
                  />
                )}
              </div>
              
              <div style={unlockDangerousJobs ? { 
                padding: '8px', 
                backgroundColor: '#ffebee', 
                border: '1px solid #f44336', 
                borderRadius: '4px' 
              } : {}}>
                <Slider
                  min={2}
                  max={unlockDangerousJobs ? Math.min(100, totalImages) : Math.min(10, totalImages)}
                  stepSize={1}
                  value={selectedJobCount}
                  onChange={handleJobCountChange}
                  showTrackFill={true}
                  labelStepSize={unlockDangerousJobs ? Math.max(10, Math.floor(totalImages / 8)) : 1}
                  labelRenderer={(value) => {
                    const imagesPerJob = calculateBatchSizeFromJobCount(totalImages, value);
                    return `${value}`;
                  }}
                  intent={unlockDangerousJobs && selectedJobCount > 10 ? Intent.DANGER : Intent.PRIMARY}
                />
              </div>
            </FormGroup>
            
            {(() => {
              const jobCount = selectedJobCount;
              
              // Practical warnings about job failure likelihood
              if (jobCount > 50) {
                return (
                  <Callout intent={Intent.DANGER} style={{ marginTop: '8px' }}>
                    <strong>CRITICAL:</strong> {jobCount} jobs significantly increases likelihood of job failures and data loss. 
                    High server resource usage may affect other users.
                  </Callout>
                );
              }
              
              if (jobCount > 20) {
                return (
                  <Callout intent={Intent.DANGER} style={{ marginTop: '8px' }}>
                    <strong>HIGH RISK:</strong> {jobCount} jobs greatly increases chance of job failures and result data loss.
                  </Callout>
                );
              }
              
              if (jobCount > 10) {
                return (
                  <Callout intent={Intent.WARNING} style={{ marginTop: '8px' }}>
                    <strong>CAUTION:</strong> {jobCount} jobs increases likelihood of job failures compared to fewer, larger jobs.
                  </Callout>
                );
              }
              
              // Performance suggestions
              if (batchSize === 1) {
                return (
                  <Callout intent={Intent.WARNING} style={{ marginTop: '8px' }}>
                    One image per job creates maximum overhead. Consider fewer jobs for better efficiency.
                  </Callout>
                );
              }
              
              if (totalImages > 64 && jobCount >= 4 && jobCount <= 6) {
                return (
                  <Callout intent={Intent.SUCCESS} style={{ marginTop: '8px' }}>
                    Excellent choice! {jobCount} jobs is optimal for {totalImages} images - good balance of speed and reliability.
                  </Callout>
                );
              }
              
              if (totalImages > 64 && jobCount <= 3) {
                return (
                  <Callout intent={Intent.SUCCESS} style={{ marginTop: '8px' }}>
                    Conservative choice! For {totalImages} images, you might try 4-6 jobs for better performance.
                  </Callout>
                );
              }
              
              return null;
            })()}
          </div>
        )}
      </FormGroup>
      
      <Divider />
      
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
