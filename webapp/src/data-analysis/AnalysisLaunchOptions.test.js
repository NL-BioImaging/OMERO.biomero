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
