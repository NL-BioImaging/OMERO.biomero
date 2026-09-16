import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import WorkflowConfiguration from "./WorkflowConfiguration";
import { useAppContext } from "../../AppContext";
import { fetchWorkflowHistory, fetchWorkflowHistoryDetail } from "../../apiService";

jest.mock("../../AppContext", () => ({ useAppContext: jest.fn() }));
jest.mock("../../apiService", () => ({ fetchWorkflowHistory: jest.fn(), fetchWorkflowHistoryDetail: jest.fn() }));

test("configuration tab applies parameters inline while preserving data and outputs", async () => {
  const state = {
    selectedWorkflow: { name: "segment", metadata: { inputs: [{ id: "diameter", type: "Number", "default-value": 99 }] } },
    workflowVersions: { segment: { available_versions: ["v1", "v2"], latest_version: "v2" } },
    slurmStatus: "online", config: {},
    formData: { IDs: [25], Data_Type: "Plate", version: "v2", diameter: 99, batchSize: 3, selectedScreens: ["new"] },
  };
  const updateState = jest.fn(value => Object.assign(state, value));
  useAppContext.mockReturnValue({ state, updateState });
  const run = { workflow_id: "abc", workflow_name: "segment", started: "2026-09-15T15:00:00Z", status: "DONE" };
  fetchWorkflowHistory.mockResolvedValue({ runs: [run], has_more: false });
  fetchWorkflowHistoryDetail.mockResolvedValue({ ...run, inputs_available: true, inputs: [{ id: 15, name: "Old plate" }],
    form: { IDs: [15], Data_Type: "Plate", version: "v1", diameter: 12, batchSize: 6, selectedScreens: ["old"] } });
  render(<WorkflowConfiguration />);
  fireEvent.click(screen.getByRole("tab", { name: "Reuse previous settings" }));
  fireEvent.click(await screen.findByRole("button", { name: "Use settings on selected data" }));
  await waitFor(() => expect(screen.getByRole("tab", { name: "Parameters" })).toHaveAttribute("aria-selected", "true"));
  expect(state.formData).toMatchObject({ IDs: [25], version: "v1", diameter: 12, batchSize: 3, selectedScreens: ["new"] });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
