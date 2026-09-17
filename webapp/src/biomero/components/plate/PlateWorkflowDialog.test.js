import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import PlateWorkflowDialog from "./PlateWorkflowDialog";
import { useAppContext } from "../../../AppContext";
import { fetchWorkflowHistory, fetchWorkflowHistoryDetail } from "../../../apiService";

jest.mock("../../../AppContext", () => ({ useAppContext: jest.fn() }));
jest.mock("../../../apiService", () => ({ fetchWorkflowHistory: jest.fn(), fetchWorkflowHistoryDetail: jest.fn() }));
jest.mock("./PlateWorkflowInput", () => () => <div>Selected plate</div>);
jest.mock("./PlateWorkflowOutput", () => () => <div>Output destination</div>);
jest.mock("../HistoryDataPreview", () => ({ __esModule: true, default: () => null,
  workflowSearchUrl: id => `/webclient/search/?search_query=${id}`,
  objectUrl: (type, id) => `/webclient/?show=${type.toLowerCase()}-${id}` }));

test("the real wizard blocks Next on reuse until settings are applied", async () => {
  const workflow = { name: "segment", description: "Segment plate", metadata: {
    inputs: [{ id: "diameter", type: "Number", "default-value": 99 }] } };
  const state = { selectedWorkflow: workflow, slurmStatus: "online", config: {},
    workflowVersions: { segment: { available_versions: ["v1", "v2"], latest_version: "v2" } },
    formData: { IDs: [25], Data_Type: "Plate", version: "v2", diameter: 99, selectedScreens: ["new"] } };
  const runWorkflowData = jest.fn();
  useAppContext.mockReturnValue({ state, runWorkflowData,
    updateState: value => Object.assign(state, value) });
  const run = { workflow_id: "abc", workflow_name: "segment", status: "DONE" };
  fetchWorkflowHistory.mockResolvedValue({ runs: [run], has_more: false });
  fetchWorkflowHistoryDetail.mockResolvedValue({ ...run, inputs_available: true,
    inputs: [{ id: 15, name: "Old plate" }], form: {
      IDs: [15], Data_Type: "Plate", version: "v1", diameter: 12 } });
  render(<PlateWorkflowDialog workflow={workflow} dialogOpen setDialogOpen={jest.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  fireEvent.click(await screen.findByRole("tab", { name: "Reuse previous settings" }));
  expect(screen.getByRole("button", { name: "Next" })).toHaveAttribute("aria-disabled", "true");
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(screen.queryByText("Output destination")).not.toBeInTheDocument();
  expect(state.formData.diameter).toBe(99);
  fireEvent.click(await screen.findByRole("button", { name: "Use settings on selected data" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Next" })).not.toHaveAttribute("aria-disabled", "true"));
  expect(state.formData).toMatchObject({ IDs: [25], diameter: 12, selectedScreens: ["new"] });
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(await screen.findByText("Output destination")).toBeInTheDocument();
  expect(runWorkflowData).not.toHaveBeenCalled();
});
