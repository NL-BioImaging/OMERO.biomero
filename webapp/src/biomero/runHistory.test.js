import { prepareHistoryRun } from "./runHistory";

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
