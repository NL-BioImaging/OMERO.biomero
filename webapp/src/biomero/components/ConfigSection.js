import React, { useState } from "react";
import { Collapse, Button, H4, Icon, Tooltip } from "@blueprintjs/core";

const ConfigSection = ({
  items,
  onItemChange,
  onAddItem,
  onAddParam,
  onDeleteItem,
  onResetItem,
  CardComponent, // Allow custom card component
  title = "New Item", // Default title prefix
  description, // Helper text description
  errors, // Error states
  validateField, // Validation function
  versionStatus, // Version check results
  versionCheckLoading, // Version check loading state
  config, // Config for workflow type detection
  onRepoBlur, // Repo blur handler
  descriptorMetadata, // Descriptor flags keyed by index
  gpuSettings, // { gpu_partition, gpu_gres, gpu_gpus } for GPU misconfiguration warnings
  globalJobParams, // { sbatchParams, defaultPartition } for showing active global params
}) => {
  const [expandedIndex, setExpandedIndex] = useState(null);
  const [editableIndex, setEditableIndex] = useState(null);

  // Helper function to get workflow type from name
  const getWorkflowTypeIcons = (workflowName) => {
    if (!workflowName || !config || !config.UI) return null;
    
    const plateWorkflows = config.UI.plate_workflows ? 
      JSON.parse(config.UI.plate_workflows || '[]') : [];
    const isPlateWorkflow = plateWorkflows.includes(workflowName);
    
    const dualModeWorkflows = config.UI.dual_mode_workflows ?
      JSON.parse(config.UI.dual_mode_workflows || '[]') : [];
    const isDualModeWorkflow = dualModeWorkflows.includes(workflowName);

    const zarrWorkflows = config.UI.zarr_workflows ? 
      JSON.parse(config.UI.zarr_workflows || '[]') : [];
    const isZarrWorkflow = zarrWorkflows.includes(workflowName);
    
    return { isPlateWorkflow, isZarrWorkflow, isDualModeWorkflow };
  };

  const toggleItem = (index) => {
    setExpandedIndex(expandedIndex === index ? null : index);
  };

  const addItemHandler = () => {
    onAddItem();
    setExpandedIndex(items.length); // Open the newly added item
    setEditableIndex(items.length); // Make it editable
  };

  const setEditable = (index, editable) => {
    setEditableIndex(editable ? index : null);
  };

  return (
    <div>
      {description && (
        <div className="bp5-form-group">
          <div className="bp5-form-content">
            {description.map((text, idx) => (
              <div key={idx} className="bp5-form-helper-text">
                {text}
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="space-y-4">
        {items.map((item, index) => {
          const dmeta = descriptorMetadata ? descriptorMetadata[index] : null;
          const hasDescriptorMismatch = dmeta && (
            (dmeta.requiresPlate !== null && (item.isPlateWorkflow || false) !== dmeta.requiresPlate) ||
            (dmeta.requiresZarr !== null && (item.isZarrWorkflow || false) !== dmeta.requiresZarr)
          );
          // GPU misconfiguration: useGpu is on but global GPU resources aren't configured
          // and no per-workflow sbatch overrides cover the gap.
          const hasGpuMisconfiguration = (() => {
            if (!item.useGpu) return false;
            const partition = gpuSettings?.gpu_partition;
            const gres = gpuSettings?.gpu_gres;
            const gpus = gpuSettings?.gpu_gpus;
            const extraKeys = Object.keys(item.extraParams || {}).map(k => k.toLowerCase());
            const hasPerWfPartition = extraKeys.some(k => k.endsWith('_job_partition'));
            const hasPerWfGres = extraKeys.some(k => k.endsWith('_job_gres') || k.endsWith('_job_gpus'));
            return (!partition && !hasPerWfPartition) || (!(gres || gpus) && !hasPerWfGres);
          })();
          const gpuMisconfigTooltip = (() => {
            if (!item.useGpu || !hasGpuMisconfiguration) return null;
            const partition = gpuSettings?.gpu_partition;
            const gres = gpuSettings?.gpu_gres;
            const gpus = gpuSettings?.gpu_gpus;
            const extraKeys = Object.keys(item.extraParams || {}).map(k => k.toLowerCase());
            const hasPerWfPartition = extraKeys.some(k => k.endsWith('_job_partition'));
            const hasPerWfGres = extraKeys.some(k => k.endsWith('_job_gres') || k.endsWith('_job_gpus'));
            const parts = [];
            if (!partition && !hasPerWfPartition) parts.push('gpu_partition not set');
            if (!(gres || gpus) && !hasPerWfGres) parts.push('no gpu_gres / gpu_gpus set');
            return 'GPU workflow: ' + parts.join(', ');
          })();
          const descriptorMismatchTooltip = dmeta && (() => {
            const parts = [];
            if (dmeta.requiresPlate !== null && (item.isPlateWorkflow || false) !== dmeta.requiresPlate)
              parts.push(dmeta.requiresPlate ? 'Descriptor indicates plate input — enable Plate Workflow?' : 'Plate Workflow enabled but not in descriptor — intentional?');
            if (dmeta.requiresZarr !== null && (item.isZarrWorkflow || false) !== dmeta.requiresZarr)
              parts.push(dmeta.requiresZarr ? 'Descriptor indicates Zarr input — enable Zarr Workflow?' : 'Zarr Workflow enabled but not in descriptor — intentional?');
            return parts.join(' · ');
          })();
          const isVersionOutdated = versionStatus && versionStatus[index] &&
            (versionStatus[index].status === 'outdated' || (versionStatus[index].status === 'unknown' && versionStatus[index].latestVersion)) &&
            !versionStatus[index].justUpdated;
          return (
          <div key={index}>
            <div className="flex items-center justify-between">
              <H4 className={`font-semibold flex items-center cursor-pointer ${
                errors && errors[index] ? 'text-red-600' :
                isVersionOutdated || hasGpuMisconfiguration ? 'text-orange-600' : ''
              }`}
                onClick={() => toggleItem(index)}
              >
                {item.name || item.key || `${title} ${index + 1}`}
                {/* Validation error indicator — first, highest priority */}
                {errors && errors[index] && (
                  <Tooltip content={Object.values(errors[index]).filter(Boolean).join(' · ')}>
                    <Icon icon="error" size={12} intent="danger" className="ml-2" />
                  </Tooltip>
                )}
                {/* Add icons for different version statuses */}
                {(() => {
                  const status = versionStatus && versionStatus[index];
                  
                  if (status) {
                    const isOutdated = (status.status === 'outdated' || (status.status === 'unknown' && status.latestVersion)) && !status.justUpdated;
                    const isRateLimited = status.status === 'rate-limited';
                    const isStale = status.isStale || status.status?.includes('-stale');
                    
                    if (isRateLimited) {
                      const resetTime = status.rateLimitInfo?.reset 
                        ? new Date(parseInt(status.rateLimitInfo.reset) * 1000).toLocaleTimeString()
                        : 'unknown';
                      return (
                        <Tooltip content={`GitHub rate limit exceeded. Resets at ${resetTime}`}>
                          <Icon icon="help" size={12} intent="warning" className="ml-2" />
                        </Tooltip>
                      );
                    } else if (isStale) {
                      return (
                        <Tooltip content="Version data is stale due to rate limiting">
                          <Icon icon="outdated" size={12} className="ml-2 text-orange-500" />
                        </Tooltip>
                      );
                    } else if (isOutdated) {
                      return (
                        <Tooltip content={
                          status.status === 'unknown'
                            ? `No version pinned — latest is ${status.latestVersion}`
                            : `Update available: ${status.currentVersion} → ${status.latestVersion}`
                        }>
                          <Icon icon="outdated" size={12} intent="warning" className="ml-2" />
                        </Tooltip>
                      );
                    }
                  }
                  return null;
                })()}
                {/* Descriptor mismatch hint (soft — not a blocking warning) */}
                {hasDescriptorMismatch && (
                  <Tooltip content={descriptorMismatchTooltip}>
                    <Icon icon="help" size={12} className="ml-2 bp5-text-muted" />
                  </Tooltip>
                )}
                {/* GPU misconfiguration indicator */}
                {hasGpuMisconfiguration && (
                  <Tooltip content={gpuMisconfigTooltip}>
                    <Icon icon="warning-sign" size={12} intent="warning" className="ml-2" />
                  </Tooltip>
                )}
              </H4>
              <div className="flex items-center">
                {/* Workflow type indicators - right aligned, multiple can show at once */}
                {(() => {
                  const workflowTypeIcons = getWorkflowTypeIcons(item.name);
                  const extraItemKeys = Object.keys(item.extraParams || {}).map(k => k.toLowerCase());
                  const isGpuWorkflow = item.useGpu || extraItemKeys.some(k => k.endsWith('_job_gres') || k.endsWith('_job_gpus'));
                  return (
                    <>
                      {workflowTypeIcons?.isPlateWorkflow && (
                        <Tooltip content={
                          workflowTypeIcons.isDualModeWorkflow
                            ? "Plate and image workflow (one SLURM workflow)"
                            : "Plate Workflow (operates on OME-ZARR plates)"
                        }>
                          <Icon icon="grid-view" size={14} intent="primary" className="mr-1" />
                        </Tooltip>
                      )}
                      {!workflowTypeIcons?.isPlateWorkflow && workflowTypeIcons?.isZarrWorkflow && (
                        <Tooltip content="ZARR Workflow (requires importer for results)">
                          <Icon icon="cube" size={14} intent="none" className="mr-1" />
                        </Tooltip>
                      )}
                      {isGpuWorkflow && (
                        <Tooltip content={item.useGpu ? 'GPU Workflow (use_gpu enabled)' : 'GPU resources set in sbatch params'}>
                          <Icon icon="lightning" size={14} className="mr-1 text-yellow-500" />
                        </Tooltip>
                      )}
                    </>
                  );
                })()}
                <Icon
                  icon={expandedIndex === index ? "caret-down" : "caret-right"}
                  className="cursor-pointer"
                  onClick={() => toggleItem(index)}
                />
              </div>
            </div>
            <Collapse isOpen={expandedIndex === index}>
              <CardComponent
                item={item}
                index={index}
                onChange={(idx, field, value, options) => onItemChange(idx, field, value, options)}
                onAddParam={onAddParam}
                onDelete={onDeleteItem}
                onReset={onResetItem}
                onRepoBlur={onRepoBlur}
                editable={editableIndex === index}
                setEditable={setEditable}
                errors={errors ? errors[index] : null} // Safely handle null errors
                validateField={validateField} // Pass validation function
                versionStatus={versionStatus ? versionStatus[index] : null} // Pass version status for this item
                versionCheckLoading={versionCheckLoading} // Pass loading state
                descriptorMeta={descriptorMetadata ? descriptorMetadata[index] ?? null : null}
                config={config}
                gpuSettings={gpuSettings}
                globalJobParams={globalJobParams}
              />
            </Collapse>
          </div>
          );
        })}
      </div>
      <Button
        icon="add"
        intent="none"
        onClick={addItemHandler}
        className="mt-4 mb-4"
      >
        Add {title}
      </Button>
    </div>
  );
};

export default ConfigSection;
