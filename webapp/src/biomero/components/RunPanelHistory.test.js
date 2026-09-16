import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import RunPanel from "./RunPanel";
import { useAppContext } from "../../AppContext";
import { fetchWorkflowHistory, fetchWorkflowHistoryDetail } from "../../apiService";

jest.mock("../../AppContext", () => ({ useAppContext: jest.fn() }));
jest.mock("./HistoryDataPreview", () => ({ __esModule: true, default: () => null,
  objectUrl: (type, id) => `/webclient/?show=${type.toLowerCase()}-${id}` }));
jest.mock("../../apiService", () => ({ fetchWorkflowHistory: jest.fn(), fetchWorkflowHistoryDetail: jest.fn() }));

test("Run history tab uses shared search and inline details without opening a dialog", async () => {
  const runWorkflowData = jest.fn();
  useAppContext.mockReturnValue({ state: { workflows: [], user: { active_group_id: 2 }, formData: {}, slurmStatus: "online" },
    updateState: jest.fn(), runWorkflowData });
  fetchWorkflowHistory.mockResolvedValue({ runs: [{ workflow_id: "abc", workflow_name: "segment", status: "DONE" }], has_more: false });
  fetchWorkflowHistoryDetail.mockResolvedValue({ workflow_id: "abc", workflow_name: "segment", inputs_available: true,
    form: { version: "v1", Data_Type: "Plate", IDs: [15] }, inputs: [{ id: 15, name: "Plate A" }] });
  render(<RunPanel />);
  expect(screen.queryByRole("button", { name: "Rerun a workflow" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("tab", { name: /Previous runs/ }));
  fireEvent.change(screen.getByLabelText("Search previous runs"), { target: { value: "abc" } });
  await waitFor(() => expect(fetchWorkflowHistory).toHaveBeenCalledWith("abc", 0, expect.anything()));
  await screen.findByRole("button", { name: "Run again on same data" });
  expect(screen.getAllByRole("textbox")).toHaveLength(1);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(runWorkflowData).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("tab", { name: /Image Workflows/ }));
  expect(screen.queryByRole("region", { name: "Selected run details" })).not.toBeInTheDocument();
});
