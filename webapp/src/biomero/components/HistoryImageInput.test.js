import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import WorkflowInput from "./WorkflowInput";
import { useAppContext } from "../../AppContext";

jest.mock("../../AppContext", () => ({ useAppContext: jest.fn() }));
jest.mock("../../apiService", () => ({ fetchPlateImages: jest.fn() }));
jest.mock("./DatasetSelectWithPopover", () => ({ label }) => <div>{label}</div>);

test.each([[1338, 1341, 1402, 1403, 4551], [1403, 4551]])("restores exact historical image selection without selecting parent containers: %j", (...ids) => {
  const images = ids.map(id => ({ id, name: `Source ${id}` }));
  const updateState = jest.fn();
  useAppContext.mockReturnValue({ updateState, loadThumbnails: jest.fn(), loadImagesForDataset: jest.fn(), apiLoading: false,
    state: { images, historicalInputImages: images, inputDatasets: [], omeroFileTreeData: {},
      thumbnails: Object.fromEntries(ids.map(id => [id, `/thumb/${id}`])),
      workflowInputState: { selectedImageIds: ids, activeTab: "list" },
      formData: { IDs: ids, Data_Type: "Image", workflowMode: "images" },
      selectedWorkflow: { name: "cisegmentation" }, config: {}, user: { active_group_id: 0 } } });
  render(<WorkflowInput />);
  expect(screen.getByRole("tab", { name: /Image List/ })).toBeInTheDocument();
  expect(screen.getAllByRole("checkbox").filter(box => box.checked)).toHaveLength(ids.length);
  expect(screen.getByText("Add images from dataset(s) or plate(s) (optional)")).toBeInTheDocument();
  expect(updateState).toHaveBeenCalledWith({ formData: expect.objectContaining({ IDs: ids, Data_Type: "Image" }) });
});
