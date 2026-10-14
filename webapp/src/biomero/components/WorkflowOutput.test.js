import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import WorkflowOutput, {
  getSuggestedDatasetDestination,
} from "./WorkflowOutput";
import { useAppContext } from "../../AppContext";

jest.mock("../../AppContext", () => ({
  useAppContext: jest.fn(),
}));
jest.mock("@blueprintjs/core", () => {
  const Container = ({ children }) => <div>{children}</div>;
  const MockFormGroup = ({ children, helperText, label, labelFor }) => (
    <div>
      {label && <label htmlFor={labelFor}>{label}</label>}
      {children}
      {helperText && <span>{helperText}</span>}
    </div>
  );
  return {
    Alignment: { END: "end" },
    Card: Container,
    FormGroup: MockFormGroup,
    HTMLSelect: ({ options = [], ...props }) => (
      <select {...props}>
        {options.map((option) => {
          const value = typeof option === "string" ? option : option.value;
          const label = typeof option === "string" ? option : option.label;
          return <option key={value} value={value}>{label}</option>;
        })}
      </select>
    ),
    InputGroup: (props) => <input {...props} />,
    Switch: ({ children, label, ...props }) => (
      <label>
        {label}
        <input type="checkbox" aria-label={label} {...props} />
        {children}
      </label>
    ),
    SwitchCard: Container,
    Callout: Container,
    Tooltip: Container,
    Icon: () => null,
    Divider: () => <hr />,
    Tag: Container,
  };
});

jest.mock("./DatasetSelectWithPopover.js", () => () => (
  <div data-testid="dataset-select" />
));

const baseFormData = {
  importAsZip: false,
  uploadCsv: false,
  attachToOriginalImages: false,
  attachFileOutputs: false,
  selectedDatasets: [],
  selectedDatasetId: null,
  enableRename: false,
  createRois: false,
  roiLabelPattern: "",
  roiShape: "Polygon",
  roiColor: "",
  clearExistingRois: false,
  clearRoiFilter: "",
};

describe("WorkflowOutput image-pathway destination suggestions", () => {
  test("does not replace an unresolved historical destination with a suggested new dataset", () => {
    const updateState = jest.fn();
    useAppContext.mockReturnValue({ state: {
      formData: baseFormData,
      historyRun: { id: "previous", sourceOptions: {}, values: {} },
      inputDatasets: [{ id: 42, data: "Plate A", category: "plates" }],
      selectedWorkflow: { name: "cellpose", metadata: { outputs: [] } },
      omeroFileTreeData: {},
    }, updateState });
    render(<WorkflowOutput onSelectionChange={jest.fn()} />);
    expect(updateState.mock.calls.some(([update]) => update.formData?.selectedDatasets?.length)).toBe(false);
  });

  test("suggests a new dataset named after a single input plate", async () => {
    const updateState = jest.fn();
    useAppContext.mockReturnValue({
      state: {
        formData: baseFormData,
        inputDatasets: [{
          index: "plate-42",
          id: 42,
          data: "Screening Plate A",
          category: "plates",
        }],
        selectedWorkflow: {
          name: "cellpose",
          metadata: {
            outputs: [{ id: "mask", name: "Mask", type: "image" }],
          },
        },
        omeroFileTreeData: {},
      },
      updateState,
    });

    render(<WorkflowOutput onSelectionChange={jest.fn()} />);

    await waitFor(() => {
      expect(updateState).toHaveBeenCalledWith({
        formData: expect.objectContaining({
          selectedDatasets: [expect.stringMatching(/^Screening_Plate_A_cellpose_\d{8}_\d{6}$/)],
          selectedDatasetId: null,
        }),
      });
    });
  });

  test("suggests one compact new dataset for mixed inputs", async () => {
    const updateState = jest.fn();
    useAppContext.mockReturnValue({
      state: {
        formData: baseFormData,
        inputDatasets: [
          {
            index: "dataset-7",
            id: 7,
            data: "Primary Images",
            category: "datasets",
          },
          {
            index: "plate-42",
            id: 42,
            data: "Screening Plate A",
            category: "plates",
          },
        ],
        selectedWorkflow: {
          name: "nuclei_segmentation",
          metadata: {
            outputs: [{ id: "mask", name: "Mask", type: "image" }],
          },
        },
        omeroFileTreeData: {},
      },
      updateState,
    });

    render(<WorkflowOutput onSelectionChange={jest.fn()} />);

    await waitFor(() => {
      expect(updateState).toHaveBeenCalledWith({
        formData: expect.objectContaining({
          selectedDatasets: [expect.stringMatching(/^Primary_Images_nuclei_segmentation_\d{8}_\d{6}$/)],
          selectedDatasetId: null,
        }),
      });
    });
  });

  test("reuses one existing dataset instead of creating another", () => {
    expect(getSuggestedDatasetDestination(
      [{
        index: "dataset-7",
        id: 7,
        data: "Primary Images",
        category: "datasets",
      }],
      "nuclei_segmentation"
    )).toEqual({ name: "Primary Images", id: 7 });
  });

  test("caps generated destination names without listing every input", () => {
    const destination = getSuggestedDatasetDestination(
      [
        {
          data: "A very long primary input container name that should be shortened for display",
          category: "plates",
        },
        { data: "Second input", category: "datasets" },
        { data: "Third input", category: "plates" },
      ],
      "an_extremely_long_workflow_name_that_also_needs_shortening",
      new Date(2026, 6, 29, 14, 35, 22)
    );

    expect(destination.id).toBeNull();
    expect(destination.name.length).toBeLessThanOrEqual(64);
    expect(destination.name).not.toMatch(/\s/);
    expect(destination.name).not.toContain("+");
    expect(destination.name).toMatch(/_20260729_143522$/);
    expect(destination.name).not.toContain("Second input");
    expect(destination.name).not.toContain("Third input");
  });

  test("accepts automatic ROI selection for descriptor label outputs", async () => {
    const onSelectionChange = jest.fn();
    useAppContext.mockReturnValue({
      state: {
        formData: {
          ...baseFormData,
          selectedDatasets: ["Results"],
          createRois: true,
          roiLabelPattern: "*",
        },
        inputDatasets: [],
        selectedWorkflow: {
          name: "bilayers-cellpose",
          metadata: {
            outputs: [{ id: "mask", type: "image", "sub-type": ["label"] }],
          },
        },
        capabilities: { roi_postprocessing: { available: true } },
        omeroFileTreeData: {},
      },
      updateState: jest.fn(),
    });

    render(<WorkflowOutput onSelectionChange={onSelectionChange} />);

    await waitFor(() => expect(onSelectionChange).toHaveBeenLastCalledWith(true));
  });

  test("uses best-effort ROI selection without label descriptors", async () => {
    const onSelectionChange = jest.fn();
    useAppContext.mockReturnValue({
      state: {
        formData: {
          ...baseFormData,
          selectedDatasets: ["Results"],
          createRois: true,
          roiLabelPattern: "",
        },
        inputDatasets: [],
        selectedWorkflow: { name: "biaflows-cellpose", metadata: { outputs: [] } },
        capabilities: { roi_postprocessing: { available: true } },
        omeroFileTreeData: {},
      },
      updateState: jest.fn(),
    });

    render(<WorkflowOutput onSelectionChange={onSelectionChange} />);

    await waitFor(() => expect(onSelectionChange).toHaveBeenLastCalledWith(true));
    expect(screen.getByText(/match imported results to each original image/i)).toBeInTheDocument();
  });

  test("offers OMERO label-image cleanup inside the active ROI card", () => {
    const updateState = jest.fn();
    useAppContext.mockReturnValue({
      state: {
        formData: {
          ...baseFormData,
          selectedDatasets: ["Results"],
          createRois: true,
        },
        inputDatasets: [],
        selectedWorkflow: { name: "cellpose", metadata: { outputs: [] } },
        capabilities: { roi_postprocessing: { available: true } },
        omeroFileTreeData: {},
      },
      updateState,
    });

    render(
      <WorkflowOutput onSelectionChange={jest.fn()} />
    );

    const retentionSelect = screen.getByLabelText("Imported label images");
    expect(retentionSelect).toHaveValue("keep");
    expect(screen.getByText(/workflow files in \.analyzed are preserved/i)).toBeInTheDocument();

    fireEvent.change(retentionSelect, { target: { value: "delete" } });

    expect(updateState).toHaveBeenCalledWith({
      formData: expect.objectContaining({ deleteLabelImagesAfterRois: true }),
    });
  });

  test("defaults ROI color to Auto and offers a custom color picker", () => {
    const updateState = jest.fn();
    useAppContext.mockReturnValue({
      state: {
        formData: {
          ...baseFormData,
          selectedDatasets: ["Results"],
          createRois: true,
        },
        inputDatasets: [],
        selectedWorkflow: { name: "cellpose", metadata: { outputs: [] } },
        capabilities: { roi_postprocessing: { available: true } },
        omeroFileTreeData: {},
      },
      updateState,
    });

    render(<WorkflowOutput onSelectionChange={jest.fn()} />);

    const colorMode = screen.getByLabelText("ROI color");
    expect(colorMode).toHaveValue("auto");
    expect(screen.getByText(/stable color from the workflow run UUID/i)).toBeInTheDocument();

    fireEvent.change(colorMode, { target: { value: "custom" } });

    expect(updateState).toHaveBeenCalledWith({
      formData: expect.objectContaining({ roiColor: "#147EB3" }),
    });
  });

  test("updates a custom ROI color", () => {
    const updateState = jest.fn();
    useAppContext.mockReturnValue({
      state: {
        formData: {
          ...baseFormData,
          selectedDatasets: ["Results"],
          createRois: true,
          roiColor: "#E15759",
        },
        inputDatasets: [],
        selectedWorkflow: { name: "cellpose", metadata: { outputs: [] } },
        capabilities: { roi_postprocessing: { available: true } },
        omeroFileTreeData: {},
      },
      updateState,
    });

    render(<WorkflowOutput onSelectionChange={jest.fn()} />);

    fireEvent.change(screen.getByLabelText("ROI color picker"), {
      target: { value: "#4e79a7" },
    });

    expect(updateState).toHaveBeenCalledWith({
      formData: expect.objectContaining({ roiColor: "#4E79A7" }),
    });
  });

  test("offers opt-in filtered ROI clearing on original images", () => {
    const updateState = jest.fn();
    useAppContext.mockReturnValue({
      state: {
        formData: {
          ...baseFormData,
          selectedDatasets: ["Results"],
          createRois: true,
          clearExistingRois: true,
          clearRoiFilter: "cellpose__run-uuid",
        },
        inputDatasets: [],
        selectedWorkflow: { name: "cellpose", metadata: { outputs: [] } },
        capabilities: { roi_postprocessing: { available: true } },
        omeroFileTreeData: {},
      },
      updateState,
    });

    render(<WorkflowOutput onSelectionChange={jest.fn()} />);

    const clearSwitch = screen.getByLabelText("Clear existing ROIs on original images");
    expect(clearSwitch).toBeChecked();
    expect(screen.getByText(/workflow name and run UUID for provenance/i)).toBeInTheDocument();
    expect(screen.getByText(/leaving the filter empty removes every existing ROI/i)).toBeInTheDocument();
    expect(screen.getByLabelText("Only clear ROI names containing (optional)")).toHaveValue(
      "cellpose__run-uuid"
    );

    fireEvent.change(
      screen.getByLabelText("Only clear ROI names containing (optional)"),
      { target: { value: "stardist" } }
    );

    expect(updateState).toHaveBeenCalledWith({
      formData: expect.objectContaining({ clearRoiFilter: "stardist" }),
    });
  });

  test("hides ROI postprocessing for Plate workflows", async () => {
    const onSelectionChange = jest.fn();
    useAppContext.mockReturnValue({
      state: {
        formData: {
          selectedScreens: ["screen_demo"],
          selectedScreenId: 51,
          createRois: true,
          roiLabelPattern: "*",
        },
        selectedWorkflow: {
          name: "plate-labels",
          metadata: { outputs: [{ type: "image", subtype: ["label"] }] },
        },
        capabilities: { roi_postprocessing: { available: true } },
        omeroFileTreeData: {},
      },
      updateState: jest.fn(),
    });

    render(<WorkflowOutput plateMode onSelectionChange={onSelectionChange} />);

    expect(screen.queryByLabelText("Create ROIs on original images"))
      .not.toBeInTheDocument();
    expect(screen.queryByText(/ROI conversion for Plate workflows is not yet supported/i))
      .not.toBeInTheDocument();
    await waitFor(() => expect(onSelectionChange).toHaveBeenLastCalledWith(true));
  });

  test("offers a label-backed Plate preview only with a Plate Screen destination", () => {
    const updateState = jest.fn();
    const originalWebclient = window.WEBCLIENT;
    window.WEBCLIENT = {
      UI: {
        IMPORTER_ENABLED: true,
        BIOMERO_SHALLOW_ZARR_ENABLED: true,
      },
    };
    const context = {
      state: {
        config: { UI: { allow_plate_label_preview: "true" } },
        formData: {
          ...baseFormData,
          plateMode: true,
          selectedScreens: ["Results"],
          selectedScreenId: 12,
          importPlateLabelPreview: false,
          plateLabelPreviewName: "",
        },
        selectedWorkflow: {
          name: "plate-labels",
          metadata: { outputs: [{ type: "image", subtype: ["label"] }] },
        },
        capabilities: {},
        omeroFileTreeData: {},
      },
      updateState,
    };
    useAppContext.mockReturnValue(context);

    const { rerender } = render(
      <WorkflowOutput plateMode onSelectionChange={jest.fn()} />
    );

    expect(screen.getByText("Create a Plate mask preview")).toBeInTheDocument();
    expect(screen.getByText(/adds a second Plate to the selected Screen/i))
      .toBeInTheDocument();
    expect(screen.queryByText(/authoritative shallow Plate/i))
      .not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Create a Plate mask preview"));
    expect(updateState).toHaveBeenCalledWith({
      formData: expect.objectContaining({ importPlateLabelPreview: true }),
    });

    context.state.formData.importPlateLabelPreview = true;
    useAppContext.mockReturnValue(context);
    rerender(<WorkflowOutput plateMode onSelectionChange={jest.fn()} />);
    fireEvent.change(screen.getByLabelText("Segmentation label name (optional)"), {
      target: { value: "nuclei" },
    });
    expect(updateState).toHaveBeenCalledWith({
      formData: expect.objectContaining({ plateLabelPreviewName: "nuclei" }),
    });

    window.WEBCLIENT = originalWebclient;
  });

  test("hides the Plate mask preview when shallow Zarr is disabled", () => {
    const originalWebclient = window.WEBCLIENT;
    window.WEBCLIENT = {
      UI: {
        IMPORTER_ENABLED: true,
        BIOMERO_SHALLOW_ZARR_ENABLED: false,
      },
    };
    useAppContext.mockReturnValue({
      state: {
        formData: {
          ...baseFormData,
          plateMode: true,
          selectedScreens: ["Results"],
          selectedScreenId: 12,
        },
        selectedWorkflow: {
          name: "plate-labels",
          metadata: { outputs: [{ type: "image", subtype: ["label"] }] },
        },
        capabilities: {},
        omeroFileTreeData: {},
      },
      updateState: jest.fn(),
    });

    render(<WorkflowOutput plateMode onSelectionChange={jest.fn()} />);

    expect(screen.queryByText("Create a Plate mask preview"))
      .not.toBeInTheDocument();
    window.WEBCLIENT = originalWebclient;
  });

  test("offers contextual file annotation destinations for Plate workflows", () => {
    const updateState = jest.fn();
    useAppContext.mockReturnValue({
      state: {
        formData: {
          ...baseFormData,
          plateMode: true,
          IDs: [301],
          attachFileOutputs: true,
          fileOutputTarget: "auto",
          selectedScreens: ["screen_demo"],
          selectedScreenId: 51,
        },
        selectedWorkflow: {
          name: "plate-analysis",
          metadata: { outputs: [{ type: "file", format: "duckdb" }] },
        },
        capabilities: {},
        omeroFileTreeData: {
          "screen-40": {
            id: 40,
            data: "input_screen",
            category: "screens",
            children: ["plate-301"],
          },
        },
      },
      updateState,
    });

    render(<WorkflowOutput plateMode onSelectionChange={jest.fn()} />);

    const target = screen.getByLabelText("File annotation destination");
    expect(target).toHaveValue("auto");
    expect(screen.getByRole("option", { name: /Result destination \(screen_demo\)/i }))
      .toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Input Plate/i })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Input Screen \(input_screen\)/i }))
      .toBeInTheDocument();

    fireEvent.change(target, { target: { value: "input_parent" } });
    expect(updateState).toHaveBeenCalledWith({
      formData: expect.objectContaining({ fileOutputTarget: "input_parent" }),
    });
  });

  test("offers typed Dataset and Project file annotation destinations", () => {
    useAppContext.mockReturnValue({
      state: {
        formData: {
          ...baseFormData,
          IDs: [1],
          attachFileOutputs: true,
          fileOutputTarget: "input_parent",
          selectedDatasets: ["results"],
          selectedDatasetId: 55,
        },
        selectedWorkflow: {
          name: "image-analysis",
          metadata: { outputs: [{ type: "file", format: "duckdb" }] },
        },
        capabilities: {},
        omeroFileTreeData: {
          "project-7": {
            id: 7,
            data: "input_project",
            category: "projects",
            children: ["dataset-1"],
          },
        },
      },
      updateState: jest.fn(),
    });

    render(<WorkflowOutput onSelectionChange={jest.fn()} />);

    expect(screen.getByRole("option", { name: /Result destination \(results\)/i }))
      .toBeInTheDocument();
    expect(screen.getByRole("option", { name: /^Input Dataset$/i }))
      .toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Input Project \(input_project\)/i }))
      .toBeInTheDocument();
  });
});
