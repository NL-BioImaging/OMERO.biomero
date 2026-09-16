import React, { useState, useEffect } from "react";
import {
  MultistepDialog,
  DialogStep,
  DialogBody,
  H6,
} from "@blueprintjs/core";
import { useAppContext } from "../../../AppContext";
import PlateWorkflowInput from "./PlateWorkflowInput";
import PlateWorkflowOutput from "./PlateWorkflowOutput";
import WorkflowForm from "../WorkflowForm";
import InputOptions from "../InputOptions";
import WorkflowFileInputStep, { getFileInputParams, isFileInputStepValid } from "../WorkflowFileInputStep";

const PlateWorkflowDialog = ({ 
  workflow, 
  dialogOpen, 
  setDialogOpen, 
  onWorkflowError, 
  onFinalSubmit,
  historyButton,
  historyNotice,
}) => {
  const { state, runWorkflowData } = useAppContext();
  const [isNextDisabled, setIsNextDisabled] = useState(true);
  const [isRunDisabled, setIsRunDisabled] = useState(true);
  const [isFileInputNextDisabled, setIsFileInputNextDisabled] = useState(false);

  // Utility to beautify names
  const beautifyName = (name) => {
    return name
      .replace(/_/g, " ")
      .replace(/\b\w/g, (char) => char.toUpperCase());
  };

  // Check if we can proceed to next step
  useEffect(() => {
    const hasPlateSelected = state.formData?.IDs?.length > 0;
    setIsNextDisabled(!hasPlateSelected);
  }, [state.formData?.IDs]);

  useEffect(() => {
    setIsFileInputNextDisabled(
      !isFileInputStepValid(workflow?.metadata, state.formData)
    );
  }, [state.formData, workflow?.metadata]);

  // Handle final submit
  const handleFinalSubmit = () => {
    if (workflow && !isRunDisabled) {
      runWorkflowData(workflow.name, state.formData, onWorkflowError);
      setDialogOpen(false);
    }
  };

  return (
    <MultistepDialog
      isOpen={dialogOpen}
      onClose={() => {
        setDialogOpen(false);
      }}
      initialStepIndex={0}
      title={<span>Run Plate Workflow: {beautifyName(workflow?.name || 'Unknown')} {historyButton}</span>}
      navigationPosition="top"
      icon="lab-test"
      className="w-[calc(100vw-20vw)]"
      finalButtonProps={{
        disabled: isRunDisabled,
        text: "Run Workflow",
        onClick: handleFinalSubmit,
      }}
    >
      {/* Step 1: Select Plate */}
      <DialogStep
        id="plate-input"
        title="Select Plate"
        className="min-h-[75vh]"
        panel={
          <>
          {historyNotice}
          <PlateWorkflowInput
            onSelectionChange={(hasSelection) => {
              setIsNextDisabled(!hasSelection);
            }}
          />
          </>
        }
        nextButtonProps={{
          disabled: isNextDisabled,
        }}
      />

      {/* Conditionally show File Inputs step for workflows with non-image file params */}
      {getFileInputParams(workflow?.metadata).length > 0 && (
        <DialogStep
          id="file-inputs"
          title="Attach Files"
          panel={<WorkflowFileInputStep />}
          nextButtonProps={{
            disabled: isFileInputNextDisabled,
          }}
        />
      )}

      {/* Step 2 (conditional): Batch Options when >1 plate selected */}
      {(state.formData?.IDs?.length || 0) > 1 && (
        <DialogStep
          id="batch-options"
          title="Batch Options"
          panel={
            <DialogBody>
              <H6>Batch Processing (Optional)</H6>
              <InputOptions itemLabel="plates" />
            </DialogBody>
          }
        />
      )}

      {/* Step 2/3: Configure Workflow */}
      <DialogStep
        id="workflow-config"
        title="Configure Workflow"
        panel={
          <DialogBody>
            <H6>{workflow?.description}</H6>
            <WorkflowForm />
          </DialogBody>
        }
      />

      {/* Step 3: Output to Screen */}
      <DialogStep
        id="screen-output"
        title="Output to Screen"
        panel={
          <PlateWorkflowOutput
            onSelectionChange={(hasSelection) => {
              setIsRunDisabled(!hasSelection);
            }}
          />
        }
      />
    </MultistepDialog>
  );
};

export default PlateWorkflowDialog;
