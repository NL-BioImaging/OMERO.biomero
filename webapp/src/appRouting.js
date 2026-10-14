export const resolveAppName = (requested, ui) => {
  const enabled = {
    import: Boolean(ui.importer_enabled),
    biomero: Boolean(ui.analyzer_enabled),
    "data-analysis": Boolean(ui.data_analysis_enabled),
  };
  if (requested && enabled[requested]) return requested;
  return ["import", "biomero", "data-analysis"].find((name) => enabled[name]) || "";
};
