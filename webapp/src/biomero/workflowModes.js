export const parseWorkflowList = (value) => {
  if (Array.isArray(value)) return value;
  if (!value) return [];

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export const getWorkflowModes = (workflowName, uiConfig = {}, metadata = {}) => {
  const plateWorkflows = parseWorkflowList(uiConfig.plate_workflows);
  const zarrWorkflows = parseWorkflowList(uiConfig.zarr_workflows);
  const dualModeWorkflows = parseWorkflowList(uiConfig.dual_mode_workflows);

  const supportsPlates =
    plateWorkflows.includes(workflowName) ||
    (metadata?.["requires-plate"] ?? false);
  const supportsImages =
    !supportsPlates || dualModeWorkflows.includes(workflowName);
  const requiresZarr =
    zarrWorkflows.includes(workflowName) ||
    (metadata?.["requires-zarr"] ?? false) ||
    supportsPlates;

  return {
    supportsImages,
    supportsPlates,
    requiresZarr,
    isDualMode: supportsImages && supportsPlates,
  };
};

export const isWorkflowAvailableInTab = (
  modes,
  tab,
  isImporterEnabled
) => {
  if (tab === "plates") {
    return isImporterEnabled && modes.supportsPlates;
  }

  return modes.supportsImages && (!modes.requiresZarr || isImporterEnabled);
};
