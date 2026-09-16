import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import PreviousRuns from "./PreviousRuns";
import { fetchWorkflowHistory, fetchWorkflowHistoryDetail } from "../../apiService";

jest.mock("../../apiService", () => ({ fetchWorkflowHistory: jest.fn(), fetchWorkflowHistoryDetail: jest.fn() }));
const run = { workflow_id: "abc", workflow_name: "segment", started: "2026-09-15T15:00:00Z", status: "DONE" };
const detail = { ...run, inputs_available: true, inputs: [{ id: 15, name: "Plate A" }],
  form: { IDs: [15], Data_Type: "Plate", version: "v1" } };
beforeEach(() => {
  jest.clearAllMocks();
  fetchWorkflowHistory.mockResolvedValue({ runs: [run], has_more: false });
  fetchWorkflowHistoryDetail.mockResolvedValue(detail);
});

test("opens newest run directly and only applies when requested", async () => {
  const apply = jest.fn();
  render(<PreviousRuns isOpen onClose={jest.fn()} onApply={apply} />);
  const button = await screen.findByRole("button", { name: "Run again" });
  expect(apply).not.toHaveBeenCalled();
  expect(screen.getByText(/Plate A/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Use settings on selected data" })).toBeDisabled();
  fireEvent.click(button);
  expect(apply).toHaveBeenCalledWith(detail, null);
});

test("reuse forwards current selection instead of old inputs", async () => {
  const apply = jest.fn();
  const selection = { IDs: [25], Data_Type: "Plate" };
  render(<PreviousRuns isOpen onClose={jest.fn()} onApply={apply} selection={selection} />);
  fireEvent.click(await screen.findByRole("button", { name: "Use settings on selected data" }));
  expect(apply).toHaveBeenCalledWith(detail, selection);
});

test("UUID search is sent to the history endpoint", async () => {
  render(<PreviousRuns isOpen onClose={jest.fn()} onApply={jest.fn()} />);
  fireEvent.change(screen.getByLabelText("Search previous runs"), { target: { value: "abc" } });
  await waitFor(() => expect(fetchWorkflowHistory).toHaveBeenCalledWith("abc", 0, expect.anything()));
});

test("closing aborts pending history requests", async () => {
  fetchWorkflowHistory.mockImplementation(() => new Promise(() => {}));
  const view = render(<PreviousRuns isOpen onClose={jest.fn()} onApply={jest.fn()} />);
  await waitFor(() => expect(fetchWorkflowHistory).toHaveBeenCalled());
  const signal = fetchWorkflowHistory.mock.calls[0][2];
  view.unmount();
  expect(signal.aborted).toBe(true);
});

test("embedded history renders inline, without another dialog or rerun action", async () => {
  render(<PreviousRuns embedded isOpen onApply={jest.fn()} selection={{ IDs: [25], Data_Type: "Plate" }} />);
  await screen.findByRole("button", { name: "Use settings on selected data" });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Run again" })).not.toBeInTheDocument();
});

test("failed lookup is not presented as empty history", async () => {
  fetchWorkflowHistory.mockRejectedValue(new Error("unavailable"));
  render(<PreviousRuns embedded isOpen onApply={jest.fn()} />);
  await screen.findByText("Could not load previous runs. Try again.");
  expect(screen.queryByText("No previous runs found.")).not.toBeInTheDocument();
});

test("selected run uses Blueprint primary intent and settings expand as a table", async () => {
  render(<PreviousRuns embedded isOpen onApply={jest.fn()} />);
  await screen.findByRole("button", { name: "Use settings on selected data" });
  const selected = screen.getByRole("button", { pressed: true });
  expect(selected).toHaveClass("bp5-intent-primary");
  expect(selected).toHaveTextContent("segment");
  const settings = screen.getByRole("button", { name: "Recorded settings" });
  expect(settings).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(settings);
  expect(settings).toHaveAttribute("aria-expanded", "true");
  expect(await screen.findByRole("columnheader", { name: "Recorded value" })).toBeInTheDocument();
});

test("clear search returns to browsing all own runs", async () => {
  render(<PreviousRuns embedded isOpen workflowName="segment" onApply={jest.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Clear history search" }));
  expect(screen.getByLabelText("Search previous runs")).toHaveValue("");
  await waitFor(() => expect(fetchWorkflowHistory).toHaveBeenCalledWith("", 0, expect.anything()));
});
