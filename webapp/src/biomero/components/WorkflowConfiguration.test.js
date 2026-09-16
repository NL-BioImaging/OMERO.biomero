import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import WorkflowConfiguration from "./WorkflowConfiguration";
import { useAppContext } from "../../AppContext";
import { fetchWorkflowHistory, fetchWorkflowHistoryDetail } from "../../apiService";

jest.mock("../../AppContext", () => ({ useAppContext: jest.fn() }));
jest.mock("../../apiService", () => ({ fetchWorkflowHistory: jest.fn(), fetchWorkflowHistoryDetail: jest.fn() }));
jest.mock("./HistoryDataPreview", () => ({ __esModule: true, default: () => null,
  workflowSearchUrl: id => `/webclient/search/?search_query=${id}`,
  objectUrl: (type, id) => `/webclient/?show=${type.toLowerCase()}-${id}` }));

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
  const blocked = jest.fn();
  render(<WorkflowConfiguration onNavigationBlockedChange={blocked} />);
  expect(blocked).toHaveBeenLastCalledWith(false);
  fireEvent.click(screen.getByRole("tab", { name: "Reuse previous settings" }));
  expect(blocked).toHaveBeenLastCalledWith(true);
  expect(state.formData.diameter).toBe(99);
  fireEvent.click(await screen.findByRole("button", { name: "Use settings on selected data" }));
  await waitFor(() => expect(screen.getByRole("tab", { name: "Parameters" })).toHaveAttribute("aria-selected", "true"));
  expect(state.formData).toMatchObject({ IDs: [25], version: "v1", diameter: 12, batchSize: 3, selectedScreens: ["new"] });
  expect(blocked).toHaveBeenLastCalledWith(false);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

test("leaving reuse without applying preserves current settings and releases navigation", () => {
  const state = { selectedWorkflow: { name: "segment", metadata: { inputs: [] } },
    workflowVersions: { segment: { available_versions: ["v1"], latest_version: "v1" } },
    slurmStatus: "online", config: {}, formData: { IDs: [25], Data_Type: "Plate", version: "v1" } };
  const updateState = jest.fn();
  useAppContext.mockReturnValue({ state, updateState });
  const blocked = jest.fn();
  const view = render(<WorkflowConfiguration onNavigationBlockedChange={blocked} />);
  fireEvent.click(screen.getByRole("tab", { name: "Reuse previous settings" }));
  expect(blocked).toHaveBeenLastCalledWith(true);
  fireEvent.click(screen.getByRole("tab", { name: "Parameters" }));
  expect(blocked).toHaveBeenLastCalledWith(false);
  fireEvent.click(screen.getByRole("tab", { name: "Reuse previous settings" }));
  view.unmount();
  expect(blocked).toHaveBeenLastCalledWith(false);
  for (const [value] of updateState.mock.calls) {
    expect(value).toEqual({ formData: state.formData });
  }
});
