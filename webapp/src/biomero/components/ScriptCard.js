import React, { useEffect, useState } from "react";
import { useAppContext } from "../../AppContext";
import { Card, Elevation, H6, Button } from "@blueprintjs/core";

const ScriptCard = ({ script }) => {
  const { 
    openScriptWindow, 
    fetchScriptDetails, 
    state, 
    apiLoading, 
    apiError,
    markSlurmInitExecuted,
    markSlurmCheckExecuted,
    needsSlurmInit,
    needsSlurmCheck
  } = useAppContext();
  const [hasTriggeredLoad, setHasTriggeredLoad] = useState(false);

  useEffect(() => {
    // Check if this script needs detailed data
    const needsLoading = !script.description || 
                        script.description === "No description available" ||
                        !script.authors || 
                        script.authors === "Unknown" ||
                        !script.version || 
                        script.version === "Unknown";
    
    if (needsLoading && !hasTriggeredLoad) {
      fetchScriptDetails(script.id, script.name);
      setHasTriggeredLoad(true);
    }
  }, [script.id, fetchScriptDetails]); // Simplified dependencies - only trigger on script ID change

  const handleCardClick = () => {
    const scriptUrl = `/webclient/script_ui/${script.id}`;
    
    // Track admin script executions
    if (script.name === "Slurm Init (Admin Only)") {
      markSlurmInitExecuted();
    } else if (script.name === "Slurm Check Setup (Admin Only)") {
      markSlurmCheckExecuted();
    }
    
    openScriptWindow(scriptUrl);
  };

  const isSlurmWorkflow = script.name === "Slurm Workflow";
  const isSlurmInit = script.name === "Slurm Init (Admin Only)";
  const isSlurmCheck = script.name === "Slurm Check Setup (Admin Only)";
  
  // Determine intent based on admin script importance
  const getScriptIntent = () => {
    if (isSlurmInit && needsSlurmInit()) {
      return "warning"; // Orange - Settings changed, init needed
    }
    if (isSlurmCheck && needsSlurmCheck()) {
      return "warning"; // Orange - Init was run, check recommended
    }
    if (isSlurmWorkflow) {
      return "success"; // Green - Main workflow
    }
    return "primary"; // Blue - Default
  };
  
  const isHighPriority = (isSlurmInit && needsSlurmInit()) || (isSlurmCheck && needsSlurmCheck());

  return (
    <Card
      key={script.id}
      className="script-card"
      interactive={true}
      onClick={handleCardClick}
      selected={isSlurmWorkflow || isHighPriority}
      elevation={Elevation.ONE}
    >
      <ScriptDetailsContent
        script={script}
        apiLoading={apiLoading}
        handleCardClick={handleCardClick}
        intent={getScriptIntent()}
      />
      {apiError && <p className="error">{apiError}</p>}
    </Card>
  );
};

const ScriptDetailsContent = ({
  script,
  apiLoading,
  handleCardClick,
  intent,
}) => {
  return (
    <div>
      <H6 className={`script-name ${apiLoading ? "bp5-skeleton" : ""}`}>
        {apiLoading ? "Loading..." : script.name || "Lorem ipsum dolor"}
      </H6>
      <p className={`${apiLoading ? "bp5-skeleton" : ""}`}>
        {script?.description || "No description available"}
      </p>
      <p className={`${apiLoading ? "bp5-skeleton" : ""}`}>
        <strong>Authors:</strong> {script?.authors || "Unknown"}
      </p>
      <p className={`${apiLoading ? "bp5-skeleton" : ""}`}>
        <strong>Version:</strong> {script?.version || "Unknown"}
      </p>
      <Button
        intent={intent}
        icon="document"
        rightIcon="take-action"
        onClick={handleCardClick}
      >
        Run script
      </Button>
    </div>
  );
};

export default ScriptCard;
