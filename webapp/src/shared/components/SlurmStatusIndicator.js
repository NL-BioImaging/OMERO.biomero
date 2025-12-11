import React, { useState, useEffect } from "react";
import { ProgressBar, Spinner, Icon, Tooltip, Intent, Button } from "@blueprintjs/core";
import { fetchSlurmStatus } from "../../apiService";
import { useAppContext } from "../../AppContext";

const SlurmStatusIndicator = ({ onTabChange, onWorkflowError }) => {
  const { updateState } = useAppContext();
  const [status, setStatus] = useState({
    status: "checking",
    message: "Checking SLURM status...",
    icon: "time",
    intent: Intent.NONE,
    isLoading: true
  });

  const checkStatus = async () => {
    setStatus(prev => ({ ...prev, isLoading: true }));
    
    try {
      const result = await fetchSlurmStatus();
      
      // Map backend response to proper BlueprintJS intents
      let intent = Intent.NONE;
      if (result.intent === "success") intent = Intent.SUCCESS;
      else if (result.intent === "danger") intent = Intent.DANGER;
      else if (result.intent === "warning") intent = Intent.WARNING;
      
      setStatus({
        status: result.status,
        message: result.message,
        icon: result.icon,
        intent: intent,
        last_checked: result.last_checked,
        isLoading: false
      });
      
      // Store workflow version data in app state for use by RunPanel
      if (result.workflow_versions) {
        updateState({ 
          workflowVersions: result.workflow_versions,
          slurmStatus: result.status 
        });
      } else {
        updateState({ slurmStatus: result.status });
      }
    } catch (error) {
      setStatus({
        status: "error",
        message: "Failed to check SLURM status",
        icon: "error",
        intent: Intent.DANGER,
        isLoading: false
      });
      // Clear version data on error
      updateState({ 
        workflowVersions: {},
        slurmStatus: "error"
      });
    }
  };

  // Check on mount and when Run tab is accessed
  useEffect(() => {
    checkStatus();
  }, []);

  // React to tab changes
  useEffect(() => {
    if (onTabChange === 'Run') {
      checkStatus();
    }
  }, [onTabChange]);

  // React to workflow submission errors
  useEffect(() => {
    if (onWorkflowError) {
      // Delay slightly to allow error to be processed
      setTimeout(() => checkStatus(), 500);
    }
  }, [onWorkflowError]);

  const getProgressValue = () => {
    if (status.isLoading) return undefined; // Indeterminate spinner
    if (status.status === "online") return 1.0;
    if (status.status === "offline" || status.status === "error") return 0.0;
    return 0.5; // unknown/checking
  };

  const getIntent = () => {
    if (status.status === "online") return Intent.SUCCESS;
    if (status.status === "offline" || status.status === "error") return Intent.DANGER;
    return Intent.WARNING;
  };

  const handleManualRefresh = () => {
    checkStatus();
  };

  return (
    <div className="flex items-center space-x-2 ml-6 px-3 py-1 border rounded-md bg-gray-50">
      <Tooltip content="Refresh SLURM status" position="bottom">
        <Button
          icon="refresh"
          minimal={true}
          small={true}
          loading={status.isLoading}
          onClick={handleManualRefresh}
          intent={getIntent()}
        />
      </Tooltip>
      
      <Tooltip content={status.message} position="bottom">
        <div className="flex items-center space-x-2">
          <Icon 
            icon={status.isLoading ? "time" : status.icon} 
            intent={getIntent()}
            size={14}
          />
          
          <div className="flex items-center space-x-2">
            <span className="text-sm font-medium">SLURM:</span>
            <span className="text-sm capitalize font-medium">
              {status.status}
            </span>
          </div>
          
          <div className="w-16">
            <ProgressBar
              value={getProgressValue()}
              intent={getIntent()}
              stripes={status.status === "offline" || status.status === "error"}
              animate={true}
            />
          </div>
        </div>
      </Tooltip>
    </div>
  );
};

export default SlurmStatusIndicator;