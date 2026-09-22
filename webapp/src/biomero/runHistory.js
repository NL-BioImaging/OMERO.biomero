// Translate a historical run into dialog state, never into a submission.
export function prepareHistoryRun(detail, workflow, versions, selection = null) {
  if (!workflow) throw new Error("This workflow is no longer configured.");
  if (!(versions?.available_versions || []).includes(detail.form.version)) {
    throw new Error(`Version ${detail.form.version} is not installed. Ask an administrator to initialize it first.`);
  }
  if (!selection && !detail.inputs_available) {
    throw new Error("Some original inputs are missing or inaccessible. Use settings on selected data instead.");
  }
  if (selection && selection.Data_Type !== detail.form.Data_Type) {
    throw new Error("Select the same input type as the original run (Image or Plate).");
  }
  const form = { ...detail.form, ...(selection || {}) };
  const warnings = [...(detail.warnings || [])];
  const inputs = workflow.metadata?.inputs || [];
  for (const input of inputs) {
    if (input["set-by-server"] || input["output-dir-set"] || input.id.startsWith("cytomine")) {
      delete form[input.id];
      continue;
    }
    if (form[input.id] === undefined) {
      warnings.push(`New parameter: ${input.name || input.id}. Review its default.`);
    }
    const choices = input["value-choices"] || [];
    if (choices.length && form[input.id] !== undefined &&
        !choices.map(String).includes(String(form[input.id]))) {
      throw new Error(`The recorded value for ${input.name || input.id} is no longer supported.`);
    }
  }
  // Historical names removed from the descriptor must not become script inputs.
  const controls = new Set(["IDs", "Data_Type", "workflowMode", "plateMode", "Format", "version", "receiveEmail",
    "useZarrFormat", "omeZarrVersion", "importAsZip", "attachToOriginalImages", "uploadCsv",
    "attachFileOutputs", "fileOutputTarget", "createRois", "roiLabelPattern", "roiShape",
    "roiColor", "importPlateLabelPreview", "plateLabelPreviewName", "selectedDatasets",
    "selectedScreens", "selectedScreenId", "selectedDatasetId", "enableRename", "renamePattern", "batchEnabled", "batchSize",
    "clearExistingRois", "deleteLabelImagesAfterRois"]);
  for (const key of Object.keys(form)) {
    if (!controls.has(key) && !inputs.some(input => input.id === key)) {
      delete form[key];
      warnings.push(`Removed parameter: ${key}. It will not be submitted.`);
    }
  }
  form.clearExistingRois = false;
  form.deleteLabelImagesAfterRois = false;
  form.workflowMode = form.Data_Type === "Plate" ? "plates" : "images";
  return { form, warnings };
}

export const sameHistoryValue = (a, b) => {
  if (Array.isArray(a) || Array.isArray(b)) return JSON.stringify(a) === JSON.stringify(b);
  return a != null && b != null ? String(a) === String(b) : a === b;
};

export const historyParameterKeys = metadata => ["version", ...(metadata?.inputs || [])
  .filter(input => !input["set-by-server"] && !input["output-dir-set"] && !input.id.startsWith("cytomine"))
  .map(input => input.id)];

export function historyContext(detail, form, warnings, mode) {
  const inputs = detail.inputs || [];
  const first = inputs[0];
  const sourceLabel = first
    ? `${detail.form.Data_Type} ${first.name || first.data || first.id}${inputs.length > 1 ? ` and ${inputs.length - 1} more` : ""}`
    : "a previous run";
  return { id: detail.workflow_id, workflow: detail.workflow_name, mode,
    sourceLabel,
    values: { ...form }, sourceOptions: { ...detail.form, ...detail.source_options }, warnings };
}

export function historyParametersUnchanged(history, params, metadata) {
  return !!history && historyParameterKeys(metadata).every(key =>
    Object.prototype.hasOwnProperty.call(history.values, key) && sameHistoryValue(history.values[key], params[key]));
}
