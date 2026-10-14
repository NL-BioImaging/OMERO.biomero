import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import SettingsForm from "./SettingsForm";
import { useAppContext } from "../../AppContext";

// This Jest/jsdom version predates structuredClone; form state is plain data.
beforeAll(() => {
  global.structuredClone = global.structuredClone || ((value) => JSON.parse(JSON.stringify(value)));
});

jest.mock("../../AppContext", () => ({
  useAppContext: jest.fn(),
}));

jest.mock("../../apiService", () => ({
  checkModelVersions: jest.fn(() => Promise.resolve([])),
  clearGitHubCache: jest.fn(),
  slugify: (value) => value,
  fetchWorkflowMetadata: jest.fn(),
}));

jest.mock("@blueprintjs/core", () => {
  const Container = ({ children }) => <div>{children}</div>;
  const Heading = ({ children, ...props }) => <h2 {...props}>{children}</h2>;
  return {
    Card: Container,
    FormGroup: ({ children, helperText, label, labelFor }) => (
      <div>
        {label && <label htmlFor={labelFor}>{label}</label>}
        {children}
        {helperText && <span>{helperText}</span>}
      </div>
    ),
    InputGroup: ({ rightElement: _rightElement, ...props }) => <input {...props} />,
    Button: ({ children, icon: _icon, minimal: _minimal, small: _small, ...props }) => (
      <button {...props}>{children}</button>
    ),
    Switch: ({ label, ...props }) => (
      <label>
        {label}
        <input type="checkbox" aria-label={label} {...props} />
      </label>
    ),
    H3: Heading,
    H5: Heading,
    H6: Heading,
    Tag: Container,
    Icon: () => null,
    ButtonGroup: Container,
    Tooltip: Container,
    Spinner: () => null,
  };
});

jest.mock("./CollapsibleSection", () => ({ children }) => <section>{children}</section>);
jest.mock("./ConfigSection", () => () => null);
jest.mock("./ModelCard.js", () => () => null);
jest.mock("./ConverterCard.js", () => () => null);

const config = {
  SSH: { host: "localslurm" },
  SLURM: {
    slurm_data_path: "/data",
    slurm_images_path: "/images",
    slurm_converters_path: "/converters",
    slurm_script_path: "/scripts",
    slurm_data_bind_path: "/data",
    slurm_script_repo: "",
    slurm_image_pull_via_sbatch: "true",
    image_pull_cpus: "1",
    image_pull_mem: "2G",
    image_pull_time: "",
    image_pull_concurrency: "2",
    image_pull_partition: "",
  },
  UI: {},
  ANALYTICS: {
    track_workflows: false,
    enable_job_accounting: false,
    enable_job_progress: false,
    enable_workflow_analytics: false,
  },
  WORKFLOWS: {},
  CONVERTERS: {},
};

function renderShallower(enabled, slurm = {}) {
  useAppContext.mockReturnValue({
    state: { config: { ...config, SLURM: { ...config.SLURM, ...slurm } },
      workflows: [], ui: { shallow_zarr_enabled: enabled } },
    updateState: jest.fn(), loadBiomeroConfig: jest.fn(), saveConfigData: jest.fn(),
  });
  return render(<SettingsForm />);
}

test('hides shallower settings when shallow Zarr is disabled', async () => {
  renderShallower(false);
  await screen.findByLabelText('Pull Images via sbatch');
  expect(screen.queryByLabelText('Remote shallowing')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Shallower image')).not.toBeInTheDocument();
});

test('defaults remote on and retains helper settings across opt-out', async () => {
  renderShallower(true, { remote_shallower_image: 'registry/helper:custom' });
  const toggle = await screen.findByLabelText('Remote shallowing');
  expect(toggle).toBeChecked();
  expect(screen.getByLabelText('Shallower image')).toHaveValue('registry/helper:custom');
  fireEvent.click(toggle);
  expect(screen.queryByLabelText('Shallower image')).not.toBeInTheDocument();
  fireEvent.click(toggle);
  expect(screen.getByLabelText('Shallower image')).toHaveValue('registry/helper:custom');
});

test('honours saved remote opt-out', async () => {
  renderShallower(true, { remote_shallow_zarr: 'false' });
  expect(await screen.findByLabelText('Remote shallowing')).not.toBeChecked();
  expect(screen.queryByLabelText('Shallower image')).not.toBeInTheDocument();
});

test('saves opt-out without deleting hidden helper values', async () => {
  renderShallower(true, { remote_shallower_workers: '4' });
  fireEvent.click(await screen.findByLabelText('Remote shallowing'));
  fireEvent.click(screen.getByRole('button', { name: 'Save Settings' }));
  await waitFor(() => expect(useAppContext().saveConfigData).toHaveBeenCalledWith(
    expect.objectContaining({ SLURM: expect.objectContaining({
      remote_shallow_zarr: 'false', remote_shallower_workers: '4',
    }) }), expect.anything()));
});

test('rejects non-positive workers only while remote shallowing is enabled', async () => {
  renderShallower(true, { remote_shallower_workers: '0' });
  const toggle = await screen.findByLabelText('Remote shallowing');
  expect(screen.getByRole('alert')).toHaveTextContent('positive integer');
  expect(screen.getByRole('button', { name: 'Save Settings' })).toBeDisabled();
  fireEvent.click(toggle);
  expect(screen.getByRole('button', { name: 'Save Settings' })).not.toBeDisabled();
});

test("shows all scheduler-native image-pull controls and portable partition guidance", async () => {
  useAppContext.mockReturnValue({
    state: { config, workflows: [] },
    updateState: jest.fn(),
    loadBiomeroConfig: jest.fn(),
    saveConfigData: jest.fn(),
  });

  render(<SettingsForm />);

  expect(await screen.findByLabelText("Pull Images via sbatch")).toBeChecked();
  expect(screen.getByText("Pull CPUs")).toBeInTheDocument();
  expect(screen.getByText("Pull Memory")).toBeInTheDocument();
  expect(screen.getByText("Pull Time")).toBeInTheDocument();
  expect(screen.getByText("Pull Concurrency")).toBeInTheDocument();
  expect(screen.getByText("Pull Partition")).toBeInTheDocument();
  expect(screen.getByText("sbatch_cpus-per-task")).toBeInTheDocument();
  expect(screen.getByText("sbatch_mem")).toBeInTheDocument();
  expect(screen.getAllByText(/Leave blank to inherit/)).not.toHaveLength(0);
  expect(screen.getByText("BIOMERO_PULL_PARTITION")).toBeInTheDocument();
});
