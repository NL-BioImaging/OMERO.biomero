import { prepareHistoryRun, historyParametersUnchanged, historyContext } from "./runHistory";

const workflow = { name: "segment", metadata: { inputs: [{ id: "diameter", type: "Number" }] } };
const versions = { available_versions: ["v1"] };
const detail = { workflow_id: "old", inputs_available: true, inputs: [{ id: 15 }],
  form: { IDs: [15], Data_Type: "Plate", version: "v1", diameter: 12, batchSize: 2,
    batchEnabled: true, clearExistingRois: true, removed: 99 } };

test("restores settings and original inputs without destructive options", () => {
  const result = prepareHistoryRun(detail, workflow, versions);
  expect(result.form.IDs).toEqual([15]);
  expect(result.form.diameter).toBe(12);
  expect(result.form.batchSize).toBe(2);
  expect(result.form.clearExistingRois).toBe(false);
  expect(result.form.removed).toBeUndefined();
  expect(detail.form.clearExistingRois).toBe(true);
});

test("reuse replaces only the input selection", () => {
  const result = prepareHistoryRun(detail, workflow, versions, { IDs: [20], Data_Type: "Plate" });
  expect(result.form.IDs).toEqual([20]);
  expect(result.form.diameter).toBe(12);
});

test("never silently changes an unavailable version", () => {
  expect(() => prepareHistoryRun(detail, workflow, { available_versions: ["v2"] })).toThrow("v1");
});

test("missing inputs allow reuse but not rerun", () => {
  const missing = { ...detail, inputs_available: false };
  expect(() => prepareHistoryRun(missing, workflow, versions)).toThrow("inaccessible");
  expect(prepareHistoryRun(missing, workflow, versions, { IDs: [20], Data_Type: "Plate" }).form.IDs).toEqual([20]);
});

test("UI control fields are not reported as removed workflow parameters", () => {
  const result = prepareHistoryRun({ ...detail, form: { ...detail.form, Format: "ZARR", plateMode: true } }, workflow, versions);
  expect(result.warnings.some(w => /Format|plateMode/.test(w))).toBe(false);
});

test("BIAFLOWS runtime parameters are removed silently", () => {
  const runtime = { infolder: "/in", outfolder: "/out", gtfolder: "/gt", local: true, nmc: 1 };
  const result = prepareHistoryRun({ ...detail, form: { ...detail.form, ...runtime } }, workflow, versions);
  for (const key of Object.keys(runtime)) {
    expect(result.form[key]).toBeUndefined();
    expect(result.warnings.some(warning => warning.includes(key))).toBe(false);
  }
});

test("preserves resolved destination IDs and uses original input names for feedback", () => {
  const source = { ...detail, inputs: [{ id: 15, name: "Experiment A" }, { id: 16, name: "Experiment B" }],
    form: { ...detail.form, selectedScreens: ["Results"], selectedScreenId: 51 } };
  const { form, warnings } = prepareHistoryRun(source, workflow, versions);
  expect(form.selectedScreenId).toBe(51);
  expect(warnings.some(w => w.includes("selectedScreenId"))).toBe(false);
  expect(historyContext(source, form, warnings, "reuse").sourceLabel).toBe("Plate Experiment A and 1 more");
});

test("unchanged parameters require all configured values and version to match", () => {
  const original = historyContext(detail, detail.form, [], "rerun");
  expect(historyParametersUnchanged(original, { ...detail.form, IDs: [99] }, workflow.metadata)).toBe(true);
  expect(historyParametersUnchanged(original, { ...detail.form, diameter: "12" }, workflow.metadata)).toBe(true);
  expect(historyParametersUnchanged(original, { ...detail.form, diameter: 13 }, workflow.metadata)).toBe(false);
  expect(historyParametersUnchanged(original, { ...detail.form, version: "v2" }, workflow.metadata)).toBe(false);
  expect(historyParametersUnchanged(original, detail.form, { inputs: [{ id: "newParameter" }] })).toBe(false);
});
