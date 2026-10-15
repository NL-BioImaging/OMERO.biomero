import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import AnalysisLaunchOptions from "./AnalysisLaunchOptions";
import { fetchAnalysisLaunchContext, uploadAnalysisAttachment } from "../analysisApi";

jest.mock("../analysisApi", () => ({ fetchAnalysisLaunchContext: jest.fn(), uploadAnalysisAttachment: jest.fn() }));
beforeEach(() => { fetchAnalysisLaunchContext.mockReset(); uploadAnalysisAttachment.mockReset(); global.crypto = require("crypto"); });
const context = { panel_kind: "source", can_annotate: true, supported_attachments: [], analysis_library_datasets: [] };
const sourceA = { type: "Image", id: 1, title: "Source A" };
const sourceB = { type: "Image", id: 2, title: "Source B" };
const props = { baseUrl: "/omero_analysis/", source: sourceA, selectionError: "", onOpen: jest.fn() };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

test("staged uploads are selected and carried to the workspace launch", async () => {
  const staged = { staging_id: "12345678-1234-1234-1234-123456789012", name: "review.csv", size: 12 };
  fetchAnalysisLaunchContext.mockResolvedValueOnce({ ...context, attachment_upload_mode: "inplace" })
    .mockResolvedValueOnce({ ...context, staged_attachments: [staged] });
  uploadAnalysisAttachment.mockResolvedValue(staged);
  const onOpen = jest.fn();
  render(<AnalysisLaunchOptions {...props} onOpen={onOpen} />);
  await screen.findByRole("button", { name: "Upload Attachment" });
  fireEvent.change(screen.getByLabelText("Upload Analysis attachment"), { target: { files: [new File(["x"], "review.csv")] } });
  expect(await screen.findByRole("checkbox", { name: /review.csv/ })).toBeChecked();
  fireEvent.click(screen.getByRole("button", { name: "Open with 1 attachment" }));
  expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ stagedAttachmentIds: [staged.staging_id], dataAnnotationIds: [], newWorkspace: expect.any(String) }));
});

test("presents worker policy and sends bindings only for query attachments", async () => {
  fetchAnalysisLaunchContext.mockResolvedValue({
    panel_kind: "source",
    supported_attachments: [
      {
        annotation_id: 11,
        name: "measurements.duckdb",
        mimetype: "application/octet-stream",
        size: 120000000,
        direct: true,
        query_format: "duckdb",
        default_mode: "remote",
        allowed_modes: ["local", "remote"],
        threshold_reason: "size-at-or-above-threshold",
        worker_ready: true,
      },
      {
        annotation_id: 12,
        name: "forced.csv",
        mimetype: "text/csv",
        size: 100,
        direct: true,
        query_format: "csv",
        default_mode: "remote",
        allowed_modes: [],
        threshold_reason: "remote-required-by-policy",
        worker_ready: false,
      },
      {
        annotation_id: 13,
        name: "notes.txt",
        mimetype: "text/plain",
        size: 20,
        direct: true,
      },
    ],
    analysis_library_datasets: [],
  });
  const onOpen = jest.fn();
  render(
    <AnalysisLaunchOptions
      baseUrl="/omero_analysis/"
      source={{ type: "Image", id: 5, selectionIds: [] }}
      selectionError=""
      onOpen={onOpen}
    />
  );

  await screen.findByText(/worker is unavailable/i);
  expect(screen.getByRole("checkbox", { name: /forced.csv/i })).toBeDisabled();

  fireEvent.click(screen.getByRole("checkbox", { name: /measurements.duckdb/i }));
  fireEvent.change(screen.getByLabelText("Query mode for measurements.duckdb"), {
    target: { value: "local" },
  });
  fireEvent.click(screen.getByRole("checkbox", { name: /notes.txt/i }));
  fireEvent.click(screen.getByRole("button", { name: /Open with 2 attachments/i }));

  expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({
    dataAnnotationIds: expect.arrayContaining([11, 13]),
    dataBindings: { 11: "local" },
  }));
});

test("launch failure is visible, blocks opening, and can be retried", async () => {
  fetchAnalysisLaunchContext.mockRejectedValueOnce(new Error("Access denied"))
    .mockResolvedValueOnce(context);
  render(<AnalysisLaunchOptions {...props} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Access denied");
  expect(screen.getByRole("button", { name: "Open Data Analysis" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Open Data Analysis" })).toBeEnabled());
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

test("a late initial context cannot overwrite the new source", async () => {
  const old = deferred();
  fetchAnalysisLaunchContext.mockReturnValueOnce(old.promise).mockResolvedValueOnce(context);
  const view = render(<AnalysisLaunchOptions {...props} />);
  const signal = fetchAnalysisLaunchContext.mock.calls[0][2].signal;
  view.rerender(<AnalysisLaunchOptions {...props} source={sourceB} />);
  await screen.findByText(/Source B/);
  await act(async () => old.resolve({ ...context, supported_attachments: [{ annotation_id: 99, name: "old.csv" }] }));
  expect(signal.aborted).toBe(true);
  expect(screen.queryByText("old.csv")).not.toBeInTheDocument();
  expect(screen.getByText(/Source B/)).toBeInTheDocument();
});

test.each(["upload", "refresh"])("source switch ignores an obsolete %s completion", async phase => {
  const old = deferred();
  let aRequests = 0;
  fetchAnalysisLaunchContext.mockImplementation((_url, source) => {
    if (source.id === 1 && ++aRequests > 1 && phase === "refresh") return old.promise;
    return Promise.resolve(context);
  });
  uploadAnalysisAttachment.mockImplementation(() => phase === "upload" ? old.promise : Promise.resolve({ annotation_id: 99 }));
  const view = render(<AnalysisLaunchOptions {...props} />);
  await screen.findByRole("button", { name: "Upload Attachment" });
  fireEvent.change(screen.getByLabelText("Upload Analysis attachment"), { target: { files: [new File(["a"], "a.csv")] } });
  const expectedRequests = phase === "refresh" ? 2 : 1;
  await waitFor(() => expect(aRequests).toBe(expectedRequests));
  const signal = uploadAnalysisAttachment.mock.calls[0][3].signal;
  view.rerender(<AnalysisLaunchOptions {...props} source={sourceB} />);
  await screen.findByText(/Source B/);
  await act(async () => old.resolve(phase === "upload" ? { annotation_id: 99 } : { ...context, supported_attachments: [{ annotation_id: 99, name: "old.csv" }] }));
  expect(signal.aborted).toBe(true);
  expect(screen.queryByText("old.csv")).not.toBeInTheDocument();
  expect(screen.queryByText("Open with 1 attachment")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Open Data Analysis" })).toBeEnabled();
});

test("upload errors remain visible alongside a valid source", async () => {
  fetchAnalysisLaunchContext.mockResolvedValue(context);
  uploadAnalysisAttachment.mockRejectedValue(new Error("Upload refused"));
  render(<AnalysisLaunchOptions {...props} />);
  await screen.findByRole("button", { name: "Upload Attachment" });
  fireEvent.change(screen.getByLabelText("Upload Analysis attachment"), { target: { files: [new File(["a"], "a.csv")] } });
  expect(await screen.findByRole("alert")).toHaveTextContent("Upload refused");
  expect(screen.getByRole("button", { name: "Open Data Analysis" })).toBeDisabled();
});
