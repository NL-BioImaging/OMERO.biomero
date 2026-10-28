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

// Keep descriptor interpretation in one place. Zarr version is an explicit
// admin choice until Bilayers defines a version capability field.
export const getDescriptorInputRequirements = (metadata = {}) => ({
  requiresPlate: metadata?.['requires-plate'] ?? null,
  requiresZarr: metadata?.['requires-zarr'] ?? null,
  isBilayers: metadata?.['schema-version']
    ? String(metadata['schema-version']).startsWith('bilayers') : null,
});

export const getWorkflowInputRequirements = (item = {}, descriptor = {}) => {
  const supportsPlates = !!item.isPlateWorkflow || descriptor?.requiresPlate === true;
  const requiresZarr = !!item.isZarrWorkflow || descriptor?.requiresZarr === true || supportsPlates;
  return {
    supportsPlates,
    requiresZarr,
    useZarrV3: requiresZarr && !!item.useZarrV3,
  };
};

export const getZarrVersionLabel = (useZarrV3) => useZarrV3
  ? 'Zarr v3 / OME-Zarr 0.5' : 'Zarr v2 / OME-Zarr 0.4';

export const getWorkflowModes = (workflowName, uiConfig = {}, metadata = {}) => {
  const plateWorkflows = parseWorkflowList(uiConfig.plate_workflows);
  const zarrWorkflows = parseWorkflowList(uiConfig.zarr_workflows);
  const dualModeWorkflows = parseWorkflowList(uiConfig.dual_mode_workflows);

  const { supportsPlates, requiresZarr } = getWorkflowInputRequirements({
    isPlateWorkflow: plateWorkflows.includes(workflowName),
    isZarrWorkflow: zarrWorkflows.includes(workflowName),
  }, getDescriptorInputRequirements(metadata));
  const supportsImages =
    !supportsPlates || dualModeWorkflows.includes(workflowName);

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
