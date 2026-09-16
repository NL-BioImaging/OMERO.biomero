import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import HistoryDataPreview from "./HistoryDataPreview";
import { fetchPlateGridData } from "../../apiService";

jest.mock("../../apiService", () => ({ fetchPlateGridData: jest.fn() }));

test("plate preview is bounded and cancels its request when leaving the run", async () => {
  fetchPlateGridData.mockResolvedValue({ rowlabels: ["A"], collabels: Array.from({ length: 20 }, (_, i) => i + 1),
    grid: [Array.from({ length: 20 }, (_, i) => ({ name: `image ${i}`, thumb_url: `/thumb/${i}` }))] });
  const view = render(<HistoryDataPreview type="Plate" id={15} />);
  await waitFor(() => expect(screen.getAllByRole("img")).toHaveLength(6));
  expect(screen.queryByRole("button", { name: "Open full plate" })).not.toBeInTheDocument();
  const signal = fetchPlateGridData.mock.calls[0][1];
  view.unmount();
  expect(signal.aborted).toBe(true);
});
