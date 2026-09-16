import React, { useState, useEffect, useRef } from "react";
import { useAppContext } from "../../AppContext";
import {
  Card,
  Elevation,
  InputGroup,
  Button,
  H5,
  H6,
  MultistepDialog,
  DialogBody,
  DialogStep,
  Spinner,
  SpinnerSize,
  ButtonGroup,
  Tag,
  Tooltip,
  Intent,
  Tabs,
  Tab,
  Icon,
} from "@blueprintjs/core";
import { FaDocker } from "react-icons/fa6";
import WorkflowConfiguration from "./WorkflowConfiguration";
import WorkflowOutput from "./WorkflowOutput";
import WorkflowInput from "./WorkflowInput";
import InputOptions from "./InputOptions";
import PlateWorkflowDialog from "./plate/PlateWorkflowDialog";
import WorkflowFileInputStep, { getFileInputParams, isFileInputStepValid } from "./WorkflowFileInputStep";
import { getWorkflowModes, isWorkflowAvailableInTab } from "../workflowModes";
import PreviousRuns from "./PreviousRuns";
import { prepareHistoryRun, historyContext } from "../runHistory";
import { HistoryDialogTitle } from "./HistoryFeedback";

const DescriptionWithToggle = ({ description }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const textRef = useRef(null);

  // Check real DOM overflow while clamped — re-runs on every resize (column changes, window resize)
  useEffect(() => {
    const el = textRef.current;
    if (!el) return;
    const checkOverflow = () => setIsOverflowing(el.scrollHeight > el.clientHeight);
    const observer = new ResizeObserver(checkOverflow);
    observer.observe(el);
    checkOverflow();
    return () => observer.disconnect();
  }, [description]);

  // Re-check after collapsing so the button reappears correctly
  useEffect(() => {
    if (!isExpanded) {
      requestAnimationFrame(() => {
        if (textRef.current)
          setIsOverflowing(textRef.current.scrollHeight > textRef.current.clientHeight);
      });
    }
  }, [isExpanded]);

  return (
    <div>
      <p ref={textRef} className={`text-sm text-gray-600 ${!isExpanded ? 'line-clamp-5' : ''}`}>
        {description}
      </p>
      {(isOverflowing || isExpanded) && (
        <div className="flex justify-end mt-1">
          <Button
            minimal
            small
            text={isExpanded ? "Show less" : "Show more"}
            onClick={(e) => {
              e.stopPropagation();
              setIsExpanded((prev) => !prev);
            }}
          />
        </div>
      )}
    </div>
  );
};

const RunPanel = ({ onWorkflowError }) => {
  const { state, updateState, toaster, runWorkflowData, apiLoading } = useAppContext();
  const [searchTerm, setSearchTerm] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [dialogRevision, setDialogRevision] = useState(0);
  const [isNextDisabled, setIsNextDisabled] = useState(true);
  const [isRunDisabled, setIsRunDisabled] = useState(false);
  const [isFileInputNextDisabled, setIsFileInputNextDisabled] = useState(false);
  const [activeWorkflowTab, setActiveWorkflowTab] = useState("images"); // "images" or "plates"
  const [customStepIndex, setCustomStepIndex] = useState(0); // Track current step for custom navigation

  // Get workflow versions from SLURM status
  const workflowVersions = state.workflowVersions || {};
  
  // Check if importer is enabled - only show plate features if it is
  const isImporterEnabled = window.WEBCLIENT?.UI?.IMPORTER_ENABLED || false;

  // Resolve workflow modes from admin overrides and BILAYERS descriptor metadata.
  const getModesForWorkflow = (workflowName) => {
    const wfData = state.workflows?.find(w => w.name === workflowName);
    return getWorkflowModes(
      workflowName,
      state.config?.UI,
      wfData?.metadata
    );
  };
  
  // Helper to get SLURM status intent for version tags
  const getSlurmIntent = () => {
    if (state.slurmStatus === "online") return Intent.SUCCESS;
    if (state.slurmStatus === "offline" || state.slurmStatus === "error") return Intent.DANGER;
    return Intent.WARNING;
  };

  // Helper to get workflow-specific intent and info
  const getWorkflowStatus = (workflowName) => {
    const isOnline = state.slurmStatus === "online";
    const hasVersions = workflowVersions[workflowName];
    const hasValidVersion = hasVersions && hasVersions.latest_version && hasVersions.latest_version.trim() !== "";
    
    if (!isOnline) {
      return {
        intent: Intent.DANGER,
        icon: "error",
        message: "SLURM cluster offline",
        showTag: true,
        tagText: "Offline"
      };
    }
    
    if (!hasValidVersion) {
      return {
        intent: Intent.WARNING,
        icon: "warning-sign", 
        message: "Workflow not installed on SLURM cluster",
        showTag: true,
        tagText: "Not Available"
      };
    }
    
    return {
      intent: Intent.NONE,
      icon: "tag",
      message: `Available versions: ${hasVersions.available_versions.join(', ')}`,
      showTag: true,
      tagText: hasVersions.latest_version
    };
  };

  const getWorkflowOutputDefaults = (workflow) => {
    const outputs = workflow?.metadata?.outputs || [];
    const useDescriptorFallbackSuggestions = Array.isArray(outputs) && outputs.length === 0;
    const hasCsvTableOutput = outputs.some((output) => {
      const type = String(output?.type || "").toLowerCase();
      if (!["measurement", "file"].includes(type)) return false;
      const formats = Array.isArray(output?.format)
        ? output.format
        : (output?.format ? [output.format] : []);
      return formats.map((fmt) => String(fmt).toLowerCase()).includes("csv");
    });
    // File annotation default: array/executable/any file (incl. .log)/non-csv measurement.
    // .log outputs are now handled by the backend without double-attachment — the SLURM
    // job log is excluded via skip_paths; workflow .log outputs attach normally.
    const hasFileAnnotationOutput = outputs.some((output) => {
      const type = String(output?.type || "").toLowerCase();
      if (["array", "executable", "file"].includes(type)) return true;
      if (type === "measurement") {
        const formats = Array.isArray(output?.format)
          ? output.format
          : (output?.format ? [output.format] : []);
        return !formats.map((f) => String(f).toLowerCase()).includes("csv");
      }
      return false;
    });
    const imageOutputs = outputs.filter(
      (output) => String(output?.type || "").toLowerCase() === "image"
    );
    const allImageOutputsAreLabels = imageOutputs.length > 0 && imageOutputs.every((output) => {
      const subtypes = output?.["sub-type"] || output?.subtype || [];
      const values = Array.isArray(subtypes) ? subtypes : [subtypes];
      return values.map((value) => String(value).toLowerCase()).includes("label");
    });

    return {
      attachToOriginalImages: false,
      importAsZip: false,  // Zip is opt-in only; no output type auto-enables it
      uploadCsv: hasCsvTableOutput || useDescriptorFallbackSuggestions,
      attachFileOutputs: hasFileAnnotationOutput || useDescriptorFallbackSuggestions,
      fileOutputTarget: "auto",
      createRois: false,
      deleteLabelImagesAfterRois: false,
      clearExistingRois: false,
      clearRoiFilter: "",
      roiLabelPattern: allImageOutputsAreLabels ? "*" : "",
      roiShape: "Polygon",
      roiColor: "",
    };
  };

  // Utility to beautify names
  const beautifyName = (name) => {
    return name
      .replace(/_/g, " ")
      .replace(/\b\w/g, (char) => char.toUpperCase());
  };

  // Filter all workflows by search term first (before tab filtering)
  const searchFilteredWorkflows = state.workflows?.filter((workflow) => {
    return workflow.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
           workflow.description.toLowerCase().includes(searchTerm.toLowerCase());
  }) || [];

  // Count workflows for each tab after search filtering
  // Only show plate workflows if importer is enabled
  const imageWorkflowCount = searchFilteredWorkflows.filter((workflow) => {
    return isWorkflowAvailableInTab(
      getModesForWorkflow(workflow.name),
      "images",
      isImporterEnabled
    );
  }).length;

  const plateWorkflowCount = isImporterEnabled ? searchFilteredWorkflows.filter((workflow) => {
    return isWorkflowAvailableInTab(
      getModesForWorkflow(workflow.name),
      "plates",
      isImporterEnabled
    );
  }).length : 0;

  // Filter workflows based on active tab from the search results
  const filteredWorkflows = searchFilteredWorkflows.filter((workflow) => {
    return isWorkflowAvailableInTab(
      getModesForWorkflow(workflow.name),
      activeWorkflowTab,
      isImporterEnabled
    );
  });

  useEffect(() => {
    setIsNextDisabled(state.formData?.IDs?.length === 0 || apiLoading);
  }, [state.formData?.IDs, apiLoading]);

  useEffect(() => {
    setIsFileInputNextDisabled(
      !isFileInputStepValid(state.selectedWorkflow?.metadata, state.formData)
    );
  }, [state.formData, state.selectedWorkflow?.metadata]);

  // Auto-switch to tab with results only when search term changes (not when user manually clicks tab)
  useEffect(() => {
    // Only auto-switch if there's a search term (user is actively filtering)
    if (!searchTerm) return;
    
    const currentTabCount = activeWorkflowTab === "images" ? imageWorkflowCount : plateWorkflowCount;
    const otherTabCount = activeWorkflowTab === "images" ? plateWorkflowCount : imageWorkflowCount;
    
    // Switch to other tab if current tab is empty but other tab has workflows
    if (currentTabCount === 0 && otherTabCount > 0) {
      setActiveWorkflowTab(activeWorkflowTab === "images" ? "plates" : "images");
    }
  }, [searchTerm, imageWorkflowCount, plateWorkflowCount]); // Only trigger on search term or count changes

  // Ensure plates tab is only accessible when importer is enabled
  useEffect(() => {
    if (!isImporterEnabled && activeWorkflowTab === "plates") {
      setActiveWorkflowTab("images");
    }
  }, [isImporterEnabled, activeWorkflowTab]);

  // Handle workflow click
  const handleWorkflowClick = (workflow) => {
    setDialogRevision(value => value + 1);
    // Dual-mode workflows use the dialog associated with the card's active tab.
    const workflowMode = activeWorkflowTab === "plates" ? "plates" : "images";
    
    // Set selected workflow in the global state context
    updateState({
      selectedWorkflow: workflow, // Set selectedWorkflow in context
      historyRun: null,
      historicalInputImages: [],
      formData: {
        IDs: [], // Empty or default value
        Data_Type: "Image", // Backend expects "Image" (case sensitive)
        workflowMode: workflowMode, // Set based on workflow config, not tab
        ...getWorkflowOutputDefaults(workflow),
      },
    });
    setDialogOpen(true); // Open the dialog
  };

  const applyHistory = (detail, selection) => {
    const workflow = state.workflows?.find(item => item.name === detail.workflow_name);
    const { form, warnings } = prepareHistoryRun(detail, workflow,
      workflowVersions[detail.workflow_name], selection);
    if (!isWorkflowAvailableInTab(getModesForWorkflow(detail.workflow_name), form.workflowMode, isImporterEnabled)) {
      throw new Error("This workflow is not available for this input type in the current setup.");
    }
    const updates = {
      historyRun: historyContext(detail, form, warnings, selection ? "reuse" : "rerun"),
      selectedWorkflow: workflow,
      formData: { ...getWorkflowOutputDefaults(workflow), ...form },
    };
    if (!selection) {
      updates.workflowInputState = {
        ...state.workflowInputState,
        selectedImageIds: form.Data_Type === "Image" ? form.IDs : [],
        selectedPlates: form.Data_Type === "Plate" ? detail.inputs : [],
      };
      updates.inputDatasets = [];
      updates.historicalInputImages = form.Data_Type === "Image" ? detail.inputs : [];
      updates.images = updates.historicalInputImages;
    }
    updateState(updates);
    setActiveWorkflowTab(form.workflowMode);
    setHistoryOpen(false);
    setDialogRevision(value => value + 1);
    setDialogOpen(true);
  };

  const handleFinalSubmit = (workflow) => {
    updateState({ workflowStatusTooltipShown: true });
    if (toaster) {
      toaster.show({
        intent: "primary",
        icon: "cloud-upload",
        message: (
          <div className="flex items-center gap-2">
            <Spinner size={16} intent="warning" />
            <span>Submitting workflow to the compute gods...</span>
          </div>
        ),
      });
    } else {
      console.warn("Toaster not initialized yet.");
    }

    submitWorkflow(workflow.name);
  };

  const submitWorkflow = (workflow_name) => {
    const metadata = state.selectedWorkflow?.metadata;
    const fileParams = getFileInputParams(metadata);

    // Rekey file-attachment selections from `param.id` → `FILE_{param.id}` so
    // the backend (analyzer_views) can recognise them and use rlong().
    // The original keys are removed to avoid going through the generic wrap() path.
    const params = { ...state.formData };
    fileParams.forEach((param) => {
      const ids = params[param.id];
      delete params[param.id];
      if (Array.isArray(ids) && ids.length > 0) {
        params[`FILE_${param.id}`] = ids;   // keep as array; backend handles list
      }
    });

    runWorkflowData(workflow_name, params, onWorkflowError);
  };
  
  // Helper function to determine if Input Options step should be skipped
  const shouldSkipInputOptions = () => {
    if (!state.selectedWorkflow) return false;
    
    const isPlateMode = state.formData?.workflowMode === "plates";
    const selectedCount = state.formData?.IDs?.length || 0;
    
    // Skip for the plate dialog or when only one image is selected.
    return isPlateMode || selectedCount === 1;
  };
  
  // Custom step navigation logic
  const getNextStepIndex = (currentStepIndex) => {
    // Step mapping: 0 = Input Data, 1 = Input Options, 2 = Workflow Parameters, 3 = Output Data
    if (currentStepIndex === 0 && shouldSkipInputOptions()) {
      return 2; // Skip from Input Data directly to Workflow Parameters
    }
    return currentStepIndex + 1;
  };
  
  const getPreviousStepIndex = (currentStepIndex) => {
    if (currentStepIndex === 2 && shouldSkipInputOptions()) {
      return 0; // Skip back from Workflow Parameters directly to Input Data
    }
    return currentStepIndex - 1;
  };  
  
  const handleStepChange = (stepIndex) => {
    setCustomStepIndex(stepIndex);
    if (stepIndex === "step2") {
      // Handle any specific form submission if necessary
    }
  };

  return (
    <div>
      <PreviousRuns key={state.user?.active_group_id} isOpen={historyOpen} onClose={() => setHistoryOpen(false)}
        onApply={applyHistory} />
      <div className="p-4">
        <Button icon="history" className="mb-3" onClick={() => setHistoryOpen(true)}>Previous runs</Button>
        {/* Unified Workflow Search */}
        <div className="mb-4">
          <InputGroup
            leftIcon="search"
            placeholder="Search workflows (segment, count, etc.)..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            rightElement={
              searchTerm && (
                <Button
                  minimal
                  icon="cross"
                  onClick={() => setSearchTerm("")}
                />
              )
            }
          />
        </div>

        {/* Workflow Type Tabs */}
        <div className="mb-4">
          <Tabs
            id="workflow-type-tabs"
            selectedTabId={activeWorkflowTab}
            onChange={(newTabId) => setActiveWorkflowTab(newTabId)}
            large={true}
          >
            <Tab
              id="images"
              title="Image Workflows"
              tagContent={imageWorkflowCount}
              tagProps={{
                round: true,
                intent: imageWorkflowCount === 0 ? "danger" : undefined
              }}
            />
            {isImporterEnabled && (
              <Tab
                id="plates"
                title="Plate Workflows"
                tagContent={plateWorkflowCount}
                tagProps={{
                  round: true,
                  intent: plateWorkflowCount === 0 ? "danger" : undefined
                }}
              />
            )}
          </Tabs>
          
          {/* Active Tab Description */}
          <div className="mt-2">
            {activeWorkflowTab === "images" && (
              <p className="text-sm text-gray-500">
                For analyzing individual images from datasets or plates
              </p>
            )}
            {activeWorkflowTab === "plates" && isImporterEnabled && (
              <p className="text-sm text-gray-500">
                For analyzing entire plates as single units (requires importer integration)
              </p>
            )}
          </div>
        </div>

        {filteredWorkflows?.length > 0 ? (
          // Only render grid after SLURM status is determined to prevent height jumping
          state.slurmStatus ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {filteredWorkflows.map((workflow) => {
                const workflowStatus = getWorkflowStatus(workflow.name);
                const isReady = workflowStatus.intent === Intent.NONE;
                
                const cardContent = (
                  <Card
                    key={workflow.name} // Use the workflow name as the key
                    interactive={isReady}
                    elevation={Elevation.TWO}
                    className={`flex flex-col gap-2 p-4 h-full ${
                      workflowStatus.intent === Intent.WARNING ? 'bp4-intent-warning' :
                      workflowStatus.intent === Intent.DANGER ? 'bp4-intent-danger' : ''
                    } ${!isReady ? 'opacity-75 cursor-not-allowed' : ''}`}
                    onClick={isReady ? () => handleWorkflowClick(workflow) : undefined}
                  >
                {/* Header Section with Title and Icons */}
                <div className="flex justify-between items-center">
                  <H5 className="mb-0">{beautifyName(workflow.name)}</H5>
                  <div className="flex items-center gap-2">
                    {/* Version Tag */}
                    {workflowStatus.showTag && (
                      <Tooltip
                        content={workflowStatus.message}
                        position="bottom"
                      >
                        <Tag
                          icon={workflowStatus.icon}
                          intent={workflowStatus.intent}
                          minimal
                          round
                        >
                          {workflowStatus.tagText}
                        </Tag>
                      </Tooltip>
                    )}
                    </div>
                    
                    <ButtonGroup>
                    {/* GitHub Icon */}
                    {workflow.githubUrl && (
                      <Button
                        icon="git-branch"
                        minimal
                        intent="primary"
                        title="View GitHub Repository"
                        onClick={(e) => {
                          e.stopPropagation();
                          window.open(
                            workflow.githubUrl,
                            "_blank",
                            "noopener,noreferrer"
                          );
                        }}
                      />
                    )}

                    {/* Container Image Icon */}
                    {workflow.metadata?.["container-image"]?.image && (
                      <Button
                        icon={<FaDocker />}
                        minimal
                        intent="primary"
                        title="View Container Image"
                        onClick={(e) => {
                          e.stopPropagation();
                          const image = workflow.metadata["container-image"].image;
                          // Version lives in githubUrl (e.g. /tree/v1.0.1), not in the image string
                          const versionMatch = workflow.githubUrl?.match(/\/tree\/(v[\d.]+)/);
                          const imageTag = versionMatch?.[1] || '';
                          const tagsUrl = imageTag
                            ? `https://hub.docker.com/r/${image}/tags?name=${imageTag}`
                            : `https://hub.docker.com/r/${image}`;
                          window.open(tagsUrl, "_blank", "noopener,noreferrer");
                        }}
                      />
                    )}

                    {/* DOI / Citation Icon */}
                    {workflow.metadata?.citations?.find(c => c.doi) && (
                      <Button
                        icon="manual"
                        minimal
                        intent="primary"
                        title={`View citation: ${workflow.metadata.citations.find(c => c.doi).name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          const doi = workflow.metadata.citations.find(c => c.doi).doi;
                          window.open(
                            `https://doi.org/${doi}`,
                            "_blank",
                            "noopener,noreferrer"
                          );
                        }}
                      />
                    )}
                  </ButtonGroup>
                  </div>

                {/* Description Section */}
                <DescriptionWithToggle description={workflow.description} />
              </Card>
              );
              
              // Wrap entire card in tooltip if not ready
              return isReady ? cardContent : (
                <Tooltip
                  key={workflow.name}
                  content={workflowStatus.message}
                  position="bottom"
                  intent={workflowStatus.intent}
                >
                  {cardContent}
                </Tooltip>
              );
            })}
          </div>
        ) : (
          <Card
            elevation={Elevation.ONE}
            className="flex flex-col items-center justify-center p-6 text-center"
          >
            {!state.workflows ? (
              // Still loading workflows from server
              <>
                <Spinner intent="primary" size={SpinnerSize.SMALL} />
                <p className="text-sm text-gray-600 mt-4">Loading workflows...</p>
              </>
            ) : !state.slurmStatus ? (
              // Workflows loaded but SLURM status still checking
              <>
                <Spinner intent="primary" size={SpinnerSize.SMALL} />
                <p className="text-sm text-gray-600 mt-4">Checking workflow availability...</p>
              </>
            ) : (
              // Workflows loaded but no results match current filters
              <>
                <Icon icon="search" size={40} color="#718096" />
                <H6 className="mt-4 text-gray-600">No workflows found</H6>
                <p className="text-sm text-gray-500">
                  {searchTerm ? 
                    `No workflows match "${searchTerm}" in the ${activeWorkflowTab} category.` :
                    `No ${activeWorkflowTab} workflows have been configured yet.`
                  }
                </p>
                {searchTerm && (
                  <Button 
                    minimal 
                    intent="primary" 
                    onClick={() => setSearchTerm("")}
                    className="mt-2"
                  >
                    Clear search
                  </Button>
                )}
              </>
            )}
          </Card>
        )
        ) : (
          // No workflows found after filtering
          <Card
            elevation={Elevation.ONE}
            className="flex flex-col items-center justify-center p-6 text-center"
          >
            {!state.workflows ? (
              // Still loading workflows from server
              <>
                <Spinner intent="primary" size={SpinnerSize.SMALL} />
                <p className="text-sm text-gray-600 mt-4">Loading workflows...</p>
              </>
            ) : !state.slurmStatus ? (
              // Workflows loaded but SLURM status still checking - don't show "no workflows" yet
              <>
                <Spinner intent="primary" size={SpinnerSize.SMALL} />
                <p className="text-sm text-gray-600 mt-4">Checking workflow availability...</p>
              </>
            ) : (
              // SLURM checked and truly no workflows match filters
              <>
                <Icon icon="search" size={40} color="#718096" />
                <H6 className="mt-4 text-gray-600">No workflows found</H6>
                <p className="text-sm text-gray-500">
                  {searchTerm ? 
                    `No workflows match "${searchTerm}" in the ${activeWorkflowTab} category.` :
                    `No ${activeWorkflowTab} workflows have been configured yet.`
                  }
                </p>
                {searchTerm && (
                  <Button 
                    minimal 
                    intent="primary" 
                    onClick={() => setSearchTerm("")}
                    className="mt-2"
                  >
                    Clear search
                  </Button>
                )}
              </>
            )}
          </Card>
        )}
      </div>

      {/* Conditional Dialog for Workflow Details */}
      {state.selectedWorkflow && (() => {
        const isPlateMode = state.formData?.workflowMode === "plates";
        
        // Use PlateWorkflowDialog when the workflow was opened from the plate tab.
        if (isPlateMode && isImporterEnabled) {
          return (
            <PlateWorkflowDialog
              key={dialogRevision}
              workflow={state.selectedWorkflow}
              dialogOpen={dialogOpen}
              setDialogOpen={setDialogOpen}
              onWorkflowError={onWorkflowError}
              onFinalSubmit={handleFinalSubmit}
            />
          );
        }
        
        // Use existing MultistepDialog for image workflows (or plate workflows when importer is disabled)
        return (
        <MultistepDialog
          key={dialogRevision}
          isOpen={dialogOpen}
          onClose={() => {
            setDialogOpen(false);
            setCustomStepIndex(0); // Reset step index on close
          }}
          initialStepIndex={0}
          title={<HistoryDialogTitle title={beautifyName(state.selectedWorkflow.name)} />}
          style={state.historyRun ? { border: "1px solid #2d72d2" } : undefined}
          onChange={handleStepChange}
          navigationPosition={"top"}
          icon="cog"
          className="w-[calc(100vw-20vw)]"
          finalButtonProps={{
            disabled: isRunDisabled,
            text: "Run",
            onClick: () => {
              // Handle the final submit action here
              handleFinalSubmit(state.selectedWorkflow); // Perform the final action
              setDialogOpen(false); // Close the dialog
            },
          }}
        >
          <DialogStep
            id="step1"
            title="Input Data"
            className="min-h-[75vh]"
            panel={
              <>
              <WorkflowInput
                onSelectionChange={(selectedImages) => {
                  setIsNextDisabled(selectedImages.length === 0);
                }}
              />
              </>
            }
            nextButtonProps={{
              disabled: isNextDisabled,
              icon: apiLoading ? <Spinner size={14} /> : undefined,
              text: apiLoading ? "Loading images…" : "Next",
              title: apiLoading ? "Wait for all images to finish loading" : undefined,
            }}
          />

          {/* Conditionally show File Inputs step for workflows with non-image file params */}
          {getFileInputParams(state.selectedWorkflow?.metadata).length > 0 && (
            <DialogStep
              id="step2b"
              title="Attach Files"
              panel={<WorkflowFileInputStep dialogBodyClassName="flex flex-col min-h-[75vh]" />}
              nextButtonProps={{
                disabled: isFileInputNextDisabled,
              }}
            />
          )}

          {/* Conditionally show Input Options step */}
          {!shouldSkipInputOptions() && (
            <DialogStep
              id="step1b"
              title="Input Options"
              panel={
                <DialogBody>
                  <H6>Advanced Input Options (Optional)</H6>
                  <InputOptions />
                </DialogBody>
              }
            />
          )}

          <DialogStep
            id="step2"
            title="Configure Workflow"
            panel={
              <DialogBody>
                <H6>{state.selectedWorkflow.description}</H6>
                <WorkflowConfiguration />
              </DialogBody>
            }
          />

          <DialogStep
            id="step3"
            title="Output Data"
            panel={
              <DialogBody>
                <WorkflowOutput
                  onSelectionChange={(selectedOutput) => {
                    setIsRunDisabled(!selectedOutput);
                  }}
                />
              </DialogBody>
            }
          />
        </MultistepDialog>
        );
      })()}
    </div>
  );
};

export default RunPanel;
