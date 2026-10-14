import React from "react";
import { fireEvent, render, waitFor } from "@testing-library/react";

import { useAppContext } from "../../AppContext";
import { fetchProjectData } from "../../apiService";
import OmeroDataBrowser from "./OmeroDataBrowser";

jest.mock("../../AppContext", () => ({ useAppContext: jest.fn() }));
jest.mock("../../apiService", () => ({
  fetchImages: jest.fn(),
  fetchPlateImages: jest.fn(),
  fetchPlatesData: jest.fn(),
  fetchProjectData: jest.fn(),
}));
jest.mock("./FileTree", () => (props) => (
  <button
    type="button"
    onClick={() =>
      props.fetchData({
        id: 2,
        index: "project-2",
        category: "projects",
        isFolder: true,
      })
    }
  >
    Expand project
  </button>
));

test("merges asynchronously loaded project datasets into the latest tree", async () => {
  const updateState = jest.fn();
  useAppContext.mockReturnValue({
    state: {
      user: { active_group_id: 0 },
      omeroFileTreeData: {
        "project-2": { index: "project-2", children: [] },
      },
      omeroFileTreeSelection: [],
    },
    updateState,
  });
  fetchProjectData.mockResolvedValue({
    datasets: [{ id: 355, name: "Saved workspace", childCount: 2 }],
  });

  const { getByRole } = render(<OmeroDataBrowser onSelectCallback={jest.fn()} />);
  fireEvent.click(getByRole("button", { name: "Expand project" }));

  await waitFor(() => expect(updateState).toHaveBeenCalledTimes(1));
  const mergeTree = updateState.mock.calls[0][0];
  const patch = mergeTree({
    omeroFileTreeData: {
      "project-2": { index: "project-2", children: [] },
      "dataset-999": { index: "dataset-999", data: "Concurrent dataset" },
    },
  });

  expect(patch.omeroFileTreeData["project-2"].children).toEqual([
    "dataset-355",
  ]);
  expect(patch.omeroFileTreeData["dataset-355"].data).toBe(
    "Saved workspace"
  );
  expect(patch.omeroFileTreeData["dataset-999"].data).toBe(
    "Concurrent dataset"
  );
});
