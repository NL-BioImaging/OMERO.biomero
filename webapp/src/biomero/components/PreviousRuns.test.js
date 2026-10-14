import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import PreviousRuns, { durationLabel, batchListLabel } from "./PreviousRuns";
import { fetchWorkflowHistory, fetchWorkflowHistoryDetail } from "../../apiService";

jest.mock("../../apiService", () => ({ fetchWorkflowHistory: jest.fn(), fetchWorkflowHistoryDetail: jest.fn() }));
jest.mock("./HistoryDataPreview", () => ({ __esModule: true, default: ({ id }) => <div data-testid={`preview-${id}`} />,
  workflowSearchUrl: id => `/webclient/search/?search_query=${id}`,
  objectUrl: (type, id) => `/webclient/?show=${type.toLowerCase()}-${id}` }));
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
  const button = await screen.findByRole("button", { name: "Run again on same data" });
  expect(apply).not.toHaveBeenCalled();
  expect(screen.getByText(/Plate A/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Use settings on selected data" })).not.toBeInTheDocument();
  fireEvent.click(button);
  expect(apply).toHaveBeenCalledWith(detail, null);
});

test("reuse forwards current selection instead of old inputs", async () => {
  const apply = jest.fn();
  const selection = { IDs: [25], Data_Type: "Plate" };
  render(<PreviousRuns embedded isOpen onClose={jest.fn()} onApply={apply} selection={selection} />);
  fireEvent.click(await screen.findByRole("button", { name: "Use settings on selected data" }));
  expect(apply).toHaveBeenCalledWith(detail, selection);
});

test("embedded reuse keeps apply above I/O and settings and shows recorded results", async () => {
  fetchWorkflowHistoryDetail.mockResolvedValue({ ...detail,
    outputs: [{ type: "Plate", id: 99, name: "Result plate" }],
    batch: { role: "child", parent_id: "parent", index: 2, total: 2 } });
  render(<PreviousRuns embedded onApply={jest.fn()} selection={{ IDs: [25], Data_Type: "Plate" }} />);
  const apply = await screen.findByRole("button", { name: "Use settings on selected data" });
  fireEvent.click(screen.getByRole("tab", { name: /Output data/ }));
  const output = screen.getByRole("link", { name: "Result plate (99)" });
  const settings = screen.getByRole("button", { name: "Recorded settings" });
  expect(apply.compareDocumentPosition(output) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(apply.compareDocumentPosition(settings) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.getByText("Batch 2 of 2")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Search workflow results in OMERO" })).toBeInTheDocument();
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
  await screen.findByRole("button", { name: "Recorded settings" });
  const selected = screen.getByRole("button", { pressed: true });
  expect(selected).toHaveClass("bp5-intent-primary");
  expect(selected).toHaveTextContent("segment");
  const settings = screen.getByRole("button", { name: "Recorded settings" });
  expect(settings).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(settings);
  expect(settings).toHaveAttribute("aria-expanded", "true");
  expect(await screen.findByRole("columnheader", { name: "Recorded value" })).toBeInTheDocument();
});

test("empty selection hides reuse instead of offering a disabled action", async () => {
  render(<PreviousRuns embedded isOpen onApply={jest.fn()} selection={{ IDs: [], Data_Type: "Plate" }} />);
  await screen.findByRole("button", { name: "Recorded settings" });
  expect(screen.queryByRole("button", { name: "Use settings on selected data" })).not.toBeInTheDocument();
});

test("different-data action restores settings with empty inputs, not stale selection", async () => {
  const apply = jest.fn();
  const total = jest.fn();
  fetchWorkflowHistory.mockResolvedValue({ runs: [run], total: 56, has_more: false });
  render(<PreviousRuns isOpen onApply={apply} onTotal={total} selection={{ IDs: [25], Data_Type: "Plate" }} />);
  await screen.findByRole("button", { name: "Run again on same data" });
  expect(screen.getByText("1 of 56")).toBeInTheDocument();
  expect(total).toHaveBeenCalledWith(56);
  fireEvent.click(screen.getByRole("button", { name: "Run on different data" }));
  expect(apply).toHaveBeenCalledWith(detail, { Data_Type: "Plate", IDs: [], batchEnabled: false, batchSize: 1 });
  expect(screen.queryByRole("button", { name: "Use settings on selected data" })).not.toBeInTheDocument();
});

test("clear search returns to browsing all own runs", async () => {
  render(<PreviousRuns embedded isOpen workflowName="segment" onApply={jest.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Clear history search" }));
  expect(screen.getByLabelText("Search previous runs")).toHaveValue("");
  await waitFor(() => expect(fetchWorkflowHistory).toHaveBeenCalledWith("", 0, expect.anything()));
});

test("load more appends runs and preserves selected details", async () => {
  fetchWorkflowHistory.mockResolvedValueOnce({ runs: [run], has_more: true })
    .mockResolvedValueOnce({ runs: [{ ...run, workflow_id: "second", workflow_name: "older" }], has_more: false });
  render(<PreviousRuns onApply={jest.fn()} />);
  await screen.findByRole("button", { name: "Run again on same data" });
  fireEvent.click(screen.getByRole("button", { name: "Load more runs" }));
  await waitFor(() => expect(fetchWorkflowHistory).toHaveBeenCalledWith("", 20, expect.anything()));
  await screen.findByRole("button", { name: /older/ });
  expect(screen.getByRole("button", { pressed: true })).toHaveTextContent("segment");
  expect(fetchWorkflowHistoryDetail).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("button", { name: "Load more runs" })).not.toBeInTheDocument();
});

test("failed run can show recorded partial outputs without claiming success", async () => {
  fetchWorkflowHistory.mockResolvedValue({ runs: [{ ...run, status: "FAILED" }], total: 1 });
  fetchWorkflowHistoryDetail.mockResolvedValue({ ...detail, status: "FAILED", outputs: [{ type: "Plate", id: 99, name: "Partial result" }] });
  render(<PreviousRuns onApply={jest.fn()} />);
  fireEvent.click(await screen.findByRole("tab", { name: /Output data/ }));
  const output = await screen.findByRole("link", { name: "Partial result (99)" });
  expect(output).toHaveAttribute("href", "/webclient/?show=plate-99");
  expect(screen.getAllByText("FAILED")).toHaveLength(2);
});

test("failed runs without outputs hide the output section and use the correct UUID search link", async () => {
  fetchWorkflowHistory.mockResolvedValue({ runs: [{ ...run, status: "FAILED" }], total: 1 });
  fetchWorkflowHistoryDetail.mockResolvedValue({ ...detail, status: "FAILED" });
  render(<PreviousRuns onApply={jest.fn()} />);
  const link = await screen.findByRole("link", { name: "Search workflow results in OMERO" });
  expect(link).toHaveAttribute("href", "/webclient/search/?search_query=abc");
  expect(screen.queryByRole("region", { name: "Output data" })).not.toBeInTheDocument();
});

test("duration is calculated from recorded start and end, never guessed", () => {
  expect(durationLabel("2026-09-16T10:00:00Z", "2026-09-16T14:13:00Z")).toBe("4h 13m");
  expect(durationLabel("2026-09-16T10:00:00Z", null)).toBeNull();
});

test("batch list labels use recorded batch names", () => {
  expect(batchListLabel("Slurm Workflow (Batched) (batch 2/2)")).toBe("Batch 2/2");
  expect(batchListLabel("Slurm Workflow (Batched)")).toBe("Whole run");
  expect(batchListLabel("Slurm Workflow")).toBeNull();
});

test("batch menu shows all child statuses and is removed when switching runs", async () => {
  const children = Array.from({ length: 5 }, (_, i) => ({ workflow_id: `child-${i}`, index: i + 1, status: i === 4 ? "FAILED" : "DONE" }));
  fetchWorkflowHistoryDetail.mockResolvedValueOnce({ ...detail, batch: { role: "child", parent_id: "parent", index: 1, total: 5 } })
    .mockResolvedValueOnce({ ...detail, workflow_id: "parent", status: "FAILED", started: "2026-09-01T12:00:00Z", batch: { role: "parent", total: 5, children } })
    .mockResolvedValueOnce({ ...detail, workflow_id: "child-4", batch: { role: "child", parent_id: "parent", index: 5, total: 5, children } });
  render(<PreviousRuns onApply={jest.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: "Choose whole run or batch" }));
  fireEvent.click(await screen.findByRole("menuitem", { name: /Whole run/ }));
  await screen.findByText("Whole run · 5 batches");
  expect(screen.getByText("FAILED")).toBeInTheDocument();
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Choose whole run or batch" }));
  fireEvent.click(await screen.findByRole("menuitem", { name: /Batch 5.*FAILED/ }));
  await waitFor(() => expect(fetchWorkflowHistoryDetail).toHaveBeenCalledWith("child-4", expect.anything()));
  await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
  expect(await screen.findAllByRole("button", { name: "Choose whole run or batch" })).toHaveLength(1);
});

test("unrecorded settings stay unavailable without showing an empty settings table", async () => {
  fetchWorkflowHistoryDetail.mockResolvedValue({ ...detail, rerun_error: "No analysis workflow settings were recorded for this run, so they cannot be reused.",
    form: { IDs: [], Data_Type: null, version: null }, inputs: [] });
  render(<PreviousRuns onApply={jest.fn()} />);
  expect(await screen.findByRole("button", { name: "Run again on same data" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Run on different data" })).toBeDisabled();
  expect(screen.queryByRole("button", { name: "Recorded settings" })).not.toBeInTheDocument();
});

test("results show five links without eager thumbnails or a preview foldout", async () => {
  fetchWorkflowHistoryDetail.mockResolvedValue({ ...detail, outputs_more: true,
    outputs: Array.from({ length: 6 }, (_, i) => ({ type: "Image", id: i, name: `Result ${i}` })) });
  render(<PreviousRuns onApply={jest.fn()} />);
  fireEvent.click(await screen.findByRole("tab", { name: /Output data/ }));
  await screen.findByRole("link", { name: "Result 4 (4)" });
  expect(screen.queryByTestId("preview-0")).not.toBeInTheDocument();
  expect(screen.queryByTestId("preview-15")).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Result 5 (5)" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Show more outputs" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "View all results in OMERO" })).toBeInTheDocument();
});

test("batch child's primary action restores the parent and its secondary action restores only the batch", async () => {
  const apply = jest.fn();
  const parent = { ...detail, workflow_id: "parent", form: { ...detail.form, IDs: [15, 16], batchEnabled: true } };
  const child = { ...detail, batch: { role: "child", parent_id: "parent", index: 2, total: 2 },
    parent_run: parent, form: { ...detail.form, batchEnabled: false } };
  fetchWorkflowHistoryDetail.mockResolvedValue(child);
  render(<PreviousRuns onApply={apply} />);
  const whole = await screen.findByRole("button", { name: "Rerun whole run" });
  expect(whole).not.toHaveClass("bp5-outlined");
  expect(screen.getByText("Batch 2 of 2")).toBeInTheDocument();
  fireEvent.click(whole);
  expect(apply).toHaveBeenLastCalledWith(parent, null);
  const only = screen.getByRole("button", { name: "Rerun this batch only" });
  expect(only).toHaveClass("bp5-outlined");
  fireEvent.click(only);
  expect(apply).toHaveBeenLastCalledWith(child, null);
});

test("many inputs start compact and can be expanded beyond six", async () => {
  const inputs = Array.from({ length: 9 }, (_, i) => ({ id: i + 1, name: `Source ${i + 1}` }));
  fetchWorkflowHistoryDetail.mockResolvedValue({ ...detail, inputs, form: { ...detail.form, IDs: inputs.map(item => item.id) } });
  render(<PreviousRuns onApply={jest.fn()} />);
  await screen.findByRole("link", { name: "Source 1 (1)" });
  expect(screen.queryByRole("link", { name: "Source 9 (9)" })).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Source 5 (5)" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Show more inputs" }));
  expect(screen.getByRole("link", { name: "Source 9 (9)" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Show fewer inputs" }));
  expect(screen.queryByRole("link", { name: "Source 9 (9)" })).not.toBeInTheDocument();
});

test("workflow breadcrumb filters through the shared workflow search", async () => {
  const filter = jest.fn();
  render(<PreviousRuns onApply={jest.fn()} onWorkflowFilter={filter} />);
  expect(await screen.findByRole("navigation", { name: "Workflow and run" })).toBeInTheDocument();
  expect(screen.queryByText("v1")).not.toBeInTheDocument();
  // jsdom has no layout width, so Blueprint moves the first crumb into overflow.
  fireEvent.click(screen.getByRole("button", { name: "collapsed breadcrumbs" }));
  fireEvent.click(await screen.findByRole("menuitem", { name: "segment" }));
  expect(filter).toHaveBeenCalledWith("segment");
});

test("start time tooltip explains start, end and duration", async () => {
  fetchWorkflowHistoryDetail.mockResolvedValue({ ...detail, ended: "2026-09-15T15:08:00Z" });
  render(<PreviousRuns onApply={jest.fn()} />);
  await screen.findByRole("navigation", { name: "Workflow and run" });
  const times = screen.getAllByText(new Date(detail.started).toLocaleString());
  expect(times).toHaveLength(2);
  fireEvent.focus(times[1]);
  await screen.findByText(/Started:/);
  expect(screen.getByText(/Ended:/)).toBeInTheDocument();
  expect(screen.getByText("Duration: 8m")).toBeInTheDocument();
});
