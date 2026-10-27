import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import AnalysisLaunchOptions from "./AnalysisLaunchOptions";
import { fetchAnalysisLaunchContext } from "../analysisIntegration";

jest.mock("../analysisIntegration", () => {
  return {
    fetchAnalysisLaunchContext: jest.fn(),
    sourceFromLaunchContext: (_payload, fallback) => ({
      source: fallback,
      error: "",
      managed: false,
    }),
    uploadAnalysisAttachment: jest.fn(),
  };
});

beforeEach(() => { Object.defineProperty(global, "crypto", {configurable: true, value: {randomUUID: () => "new-image-workspace"}}); });

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

  await waitFor(() => expect(screen.getByText(/worker is unavailable/i)).toBeInTheDocument());
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


test("chooses only checked dataset images and keeps resume inputs unchanged", async () => {
  Object.defineProperty(global.crypto, "randomUUID", {configurable: true, value: () => "new-image-workspace"});
  fetchAnalysisLaunchContext.mockResolvedValue({panel_kind: "source", supported_attachments: [],
    image_input_candidates: [11,12,13].map(id => ({type: "Image", id, name: `Field ${id}`})),
    analysis_workspaces: [{workspaceId: "existing", workspaceName: "Saved"}]});
  const onOpen = jest.fn();
  render(<AnalysisLaunchOptions baseUrl="/omero_analysis/" source={{type: "Dataset", id: 8}} onOpen={onOpen} />);
  const choice = await screen.findByRole("checkbox", {name: "Field 12 (Image 12)"});
  expect(choice).not.toBeChecked();
  fireEvent.click(choice);
  fireEvent.click(screen.getByRole("button", {name: "New workspace"}));
  expect(onOpen).toHaveBeenLastCalledWith(expect.objectContaining({type: "Dataset", id: 8,
    newWorkspace: "new-image-workspace", imageInputs: [{type: "Image", id: 12, name: "Field 12"}]}));
  fireEvent.click(screen.getByRole("button", {name: "Clear selection"}));
  fireEvent.click(screen.getByRole("button", {name: "New workspace"}));
  expect(onOpen).toHaveBeenLastCalledWith(expect.objectContaining({imageInputs: []}));
  fireEvent.click(screen.getByRole("button", {name: "Open Saved"}));
  expect(onOpen).toHaveBeenLastCalledWith(expect.objectContaining({workspaceId: "existing", newWorkspace: null}));
});
