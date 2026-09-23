import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import HistoryObjectList from "./HistoryObjectList";
import { fetchWorkflowHistoryOutputs, fetchPlateGridData } from "../../apiService";

jest.mock("../../apiService", () => ({ fetchWorkflowHistoryOutputs: jest.fn(), fetchPlateGridData: jest.fn() }));
const objects = Array.from({ length: 5 }, (_, i) => ({ id: i + 1, name: `Plate ${i + 1}`, type: "Plate" }));
beforeEach(() => jest.clearAllMocks());

test("previews load only on hover and are cancelled after leaving", async () => {
  fetchPlateGridData.mockImplementation(() => new Promise(() => {}));
  const view = render(<HistoryObjectList objects={objects} />);
  expect(fetchPlateGridData).not.toHaveBeenCalled();
  fireEvent.mouseEnter(screen.getByRole("link", { name: "Plate 1 (1)" }));
  await waitFor(() => expect(fetchPlateGridData).toHaveBeenCalledWith(1, expect.anything()));
  const signal = fetchPlateGridData.mock.calls[0][1];
  fireEvent.mouseLeave(screen.getByRole("link", { name: "Plate 1 (1)" }));
  await waitFor(() => expect(signal.aborted).toBe(true));
  view.unmount();
});

test("loads another real result page and preserves links when collapsed", async () => {
  fetchWorkflowHistoryOutputs.mockResolvedValue({ objects: [{ id: 6, name: "Sixth plate", type: "Plate" }], has_more: false });
  render(<HistoryObjectList objects={objects} output hasMore workflowId="run" />);
  fireEvent.click(screen.getByRole("button", { name: "Show more outputs" }));
  await screen.findByRole("link", { name: "Sixth plate (6)" });
  expect(fetchWorkflowHistoryOutputs).toHaveBeenCalledWith("run", "Plate:5", expect.anything());
  fireEvent.click(screen.getByRole("button", { name: "Show fewer outputs" }));
  fireEvent.click(screen.getByRole("button", { name: "Show more outputs" }));
  expect(screen.getByRole("link", { name: "Sixth plate (6)" })).toBeInTheDocument();
  expect(fetchWorkflowHistoryOutputs).toHaveBeenCalledTimes(1);
});

test("failed result pages retain existing objects and can retry", async () => {
  fetchWorkflowHistoryOutputs.mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce({ objects: [], has_more: false });
  render(<HistoryObjectList objects={objects} output hasMore workflowId="run" />);
  fireEvent.click(screen.getByRole("button", { name: "Show more outputs" }));
  await screen.findByRole("alert");
  expect(screen.getByRole("link", { name: "Plate 1 (1)" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Retry outputs" }));
  await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
});

test("pending results are aborted on unmount and only evidenced Zarrs get viewer links", () => {
  fetchWorkflowHistoryOutputs.mockImplementation(() => new Promise(() => {}));
  const view = render(<HistoryObjectList objects={[{ ...objects[0], viewer_url: "/biomero_zarr_viewer/?plate=1" }, ...objects.slice(1)]}
    output hasMore workflowId="run" />);
  expect(screen.getByRole("button", { name: "Open Plate 1 in Zarr viewer" })).toHaveAttribute("href", "/biomero_zarr_viewer/?plate=1");
  expect(screen.getByRole("button", { name: "Open Plate 1 in Zarr viewer" })).toHaveClass("bp5-outlined", "bp5-intent-primary");
  expect(screen.queryByRole("button", { name: "Open Plate 2 in Zarr viewer" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Show more outputs" }));
  const signal = fetchWorkflowHistoryOutputs.mock.calls[0][2];
  view.unmount();
  expect(signal.aborted).toBe(true);
});
