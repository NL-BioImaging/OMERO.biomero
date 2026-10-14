import React from "react";
import { render, waitFor } from "@testing-library/react";
import WorkflowForm from "./WorkflowForm";
import InputOptions from "./InputOptions";
import { useAppContext } from "../../AppContext";

jest.mock("../../AppContext", () => ({ useAppContext: jest.fn() }));

test("workflow form keeps recorded version rather than selecting latest", async () => {
  const updateState = jest.fn();
  useAppContext.mockReturnValue({ updateState, state: {
    selectedWorkflow: { name: "segment", metadata: { inputs: [{ id: "diameter", type: "Number", "default-value": 99 }] } },
    workflowVersions: { segment: { available_versions: ["v1", "v2"], latest_version: "v2" } },
    slurmStatus: "online", formData: { version: "v1", diameter: 12 }, config: {},
  } });
  render(<WorkflowForm />);
  await waitFor(() => expect(updateState).toHaveBeenCalledWith({ formData: { version: "v1", diameter: 12 } }));
  expect(updateState.mock.calls.every(([value]) => value.formData.version !== "v2")).toBe(true);
});

test("batch options preserve historical batch size, not just rounded job count", async () => {
  const updateState = jest.fn();
  useAppContext.mockReturnValue({ updateState, state: {
    formData: { IDs: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], batchEnabled: true, batchSize: 6 },
    config: {}, slurmStatus: "online",
  } });
  render(<InputOptions />);
  await waitFor(() => expect(updateState).toHaveBeenCalledWith({ formData: expect.objectContaining({
    batchEnabled: true, batchSize: 6, batchCount: 2,
  }) }));
});
