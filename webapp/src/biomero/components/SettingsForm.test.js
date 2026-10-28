import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import SettingsForm from "./SettingsForm";
import { useAppContext } from "../../AppContext";
import { fetchWorkflowMetadata } from "../../apiService";

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
jest.mock("./ConfigSection", () => ({ onAddItem, title, items, onItemChange, onDeleteItem, onResetItem, onRepoBlur }) => (
  <div>
    <button onClick={onAddItem}>Add {title}</button>
    {items.filter(item => item.name).map((item, index) => <div key={index}>
      <input aria-label={`${item.name} Zarr required`} type="checkbox" checked={!!item.isZarrWorkflow}
        onChange={event => onItemChange(index, "isZarrWorkflow", event.target.checked)} />
      <input aria-label={`${item.name} Zarr v3`} type="checkbox" checked={!!item.useZarrV3}
        onChange={event => onItemChange(index, "useZarrV3", event.target.checked)} />
      <input aria-label={`${item.name} name`} value={item.name}
        onChange={event => onItemChange(index, "name", event.target.value)} />
      <button onClick={() => onResetItem(index)}>Reset {item.name}</button>
      <button onClick={() => onDeleteItem(index)}>Delete {item.name}</button>
      <button onClick={() => onRepoBlur(index)}>Read descriptor {item.name}</button>
    </div>)}
  </div>
));
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

test('opens the installed admin scripts from the guidance without saving settings', async () => {
  const view = renderShallower(false);
  const context = useAppContext();
  context.state.scripts = [{ name: 'biomero', ul: [{ name: 'admin', ul: [
    { id: 123, name: 'Slurm Init (Admin Only)' },
    { id: 456, name: 'Slurm Check Setup (Admin Only)' },
  ] }] }];
  context.openScriptWindow = jest.fn();
  context.markSlurmInitExecuted = jest.fn();
  context.markSlurmCheckExecuted = jest.fn();
  view.rerender(<SettingsForm />);
  const init = await screen.findByRole('link', { name: 'Open Slurm Init script' });
  expect(init).toHaveAttribute('href', '/webclient/script_ui/123');
  fireEvent.click(init);
  expect(context.openScriptWindow).toHaveBeenLastCalledWith('/webclient/script_ui/123');
  expect(context.markSlurmInitExecuted).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('link', { name: 'Open Slurm Check Setup script' }));
  expect(context.openScriptWindow).toHaveBeenLastCalledWith('/webclient/script_ui/456');
  expect(context.markSlurmCheckExecuted).toHaveBeenCalledTimes(1);
  expect(context.openScriptWindow).toHaveBeenCalledTimes(2);
  expect(context.saveConfigData).not.toHaveBeenCalled();
});

test('does not link to an unavailable admin script', async () => {
  renderShallower(false);
  await screen.findByLabelText('Pull Images via sbatch');
  expect(screen.queryByRole('link', { name: 'Open Slurm Init script' })).not.toBeInTheDocument();
  expect(screen.getByText('Slurm Check Setup')).toHaveAttribute('aria-disabled', 'true');
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

test("an added empty workflow disables saving", async () => {
  renderShallower(false);
  await screen.findByLabelText("Pull Images via sbatch");
  fireEvent.click(screen.getByRole("button", { name: /Add.*Workflow/i }));
  expect(screen.getByRole("button", { name: "Save Settings" })).toBeDisabled();
  expect(useAppContext().saveConfigData).not.toHaveBeenCalled();
});

function renderZarrPolicy(ui = {}, metadata = { "schema-version": "bilayers:0.1.0" }) {
  useAppContext.mockReturnValue({
    state: { config: { ...config, UI: { zarr_workflows: '["seg"]', ...ui }, WORKFLOWS: {
      seg: "seg", seg_repo: "https://github.com/org/seg/tree/v1", seg_job: "jobs/seg.sh",
    } }, workflows: [{ name: "seg", githubUrl: "https://github.com/org/seg/tree/v1", metadata }] },
    updateState: jest.fn(), loadBiomeroConfig: jest.fn(), saveConfigData: jest.fn(),
  });
  render(<SettingsForm />);
}

test('defaults to v2 and saves an explicit per-workflow v3 opt-in', async () => {
  renderZarrPolicy();
  const toggle = await screen.findByLabelText('seg Zarr v3');
  expect(toggle).not.toBeChecked();
  fireEvent.click(toggle);
  fireEvent.click(screen.getByRole('button', { name: 'Save Settings' }));
  await waitFor(() => expect(useAppContext().saveConfigData).toHaveBeenCalledWith(
    expect.objectContaining({ UI: expect.objectContaining({ zarr_v3_workflows: '["seg"]' }) }),
    expect.anything()));
});

test('turning off Zarr clears its v3 suboption and persists both lists', async () => {
  renderZarrPolicy({ zarr_v3_workflows: '["seg"]' });
  fireEvent.click(await screen.findByLabelText('seg Zarr required'));
  expect(screen.getByLabelText('seg Zarr v3')).not.toBeChecked();
  fireEvent.click(screen.getByRole('button', { name: 'Save Settings' }));
  await waitFor(() => expect(useAppContext().saveConfigData).toHaveBeenLastCalledWith(
    expect.objectContaining({ UI: expect.objectContaining({ zarr_workflows: '[]', zarr_v3_workflows: '[]' }) }),
    expect.anything()));
});

test.each(['requires-zarr', 'requires-plate'])(
  'descriptor-required input permits v3 and preserves the choice through a rename: %s', async (requirement) => {
    renderZarrPolicy({ zarr_workflows: '[]' }, { 'schema-version': 'bilayers:0.1.0', [requirement]: true });
    fireEvent.click(await screen.findByLabelText('seg Zarr v3'));
    fireEvent.change(screen.getByLabelText('seg name'), { target: { value: 'renamed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Settings' }));
    await waitFor(() => expect(useAppContext().saveConfigData).toHaveBeenLastCalledWith(
      expect.objectContaining({ UI: expect.objectContaining({ zarr_workflows: '["renamed"]', zarr_v3_workflows: '["renamed"]' }) }), expect.anything()));
  }
);

test('descriptor refresh retains a manual version choice without inferring v3 from Zarr support', async () => {
  renderZarrPolicy({ zarr_v3_workflows: '["seg"]' });
  await screen.findByLabelText('seg Zarr v3');
  fetchWorkflowMetadata.mockResolvedValue({ 'schema-version': 'bilayers:0.1.0', 'requires-zarr': true });
  fireEvent.click(screen.getByRole('button', { name: 'Read descriptor seg' }));
  await waitFor(() => expect(fetchWorkflowMetadata).toHaveBeenCalled());
  expect(screen.getByLabelText('seg Zarr v3')).toBeChecked();
  fireEvent.click(screen.getByLabelText('seg Zarr v3'));
  fireEvent.click(screen.getByRole('button', { name: 'Read descriptor seg' }));
  await waitFor(() => expect(fetchWorkflowMetadata).toHaveBeenCalledTimes(2));
  expect(screen.getByLabelText('seg Zarr v3')).not.toBeChecked();
});

test('rejects an orphaned v3 opt-in until Zarr input is enabled', async () => {
  renderZarrPolicy({ zarr_workflows: '[]', zarr_v3_workflows: '["seg"]' }, { 'schema-version': 'cytomine-0.1' });
  await screen.findByLabelText('seg Zarr v3');
  expect(screen.getByRole('button', { name: 'Save Settings' })).toBeDisabled();
  expect(screen.getByRole('alert')).toHaveTextContent('Zarr Format Required');
  expect(useAppContext().saveConfigData).not.toHaveBeenCalled();
  fireEvent.click(screen.getByLabelText('seg Zarr required'));
  expect(screen.getByRole('button', { name: 'Save Settings' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'Save Settings' }));
  await waitFor(() => expect(useAppContext().saveConfigData).toHaveBeenLastCalledWith(
    expect.objectContaining({ UI: expect.objectContaining({ zarr_workflows: '["seg"]', zarr_v3_workflows: '["seg"]' }) }), expect.anything()));
});

test('an unavailable descriptor preserves the saved choice but blocks an invalid save', async () => {
  renderZarrPolicy({ zarr_workflows: '[]', zarr_v3_workflows: '["seg"]' }, null);
  await screen.findByLabelText('seg Zarr v3');
  expect(screen.getByLabelText('seg Zarr v3')).toBeChecked();
  expect(screen.getByRole('button', { name: 'Save Settings' })).toBeDisabled();
  fireEvent.click(screen.getByLabelText('seg Zarr required'));
  fireEvent.click(screen.getByRole('button', { name: 'Save Settings' }));
  await waitFor(() => expect(useAppContext().saveConfigData).toHaveBeenLastCalledWith(
    expect.objectContaining({ UI: expect.objectContaining({ zarr_v3_workflows: '["seg"]' }) }), expect.anything()));
});

test('loads, resets, renames and deletes the v3 workflow selection', async () => {
  renderZarrPolicy({ zarr_v3_workflows: '["seg"]', custom_setting: 'keep' });
  const toggle = await screen.findByLabelText('seg Zarr v3');
  expect(toggle).toBeChecked();
  fireEvent.click(toggle);
  fireEvent.click(screen.getByRole('button', { name: 'Reset seg' }));
  expect(toggle).toBeChecked();
  fireEvent.change(screen.getByLabelText('seg name'), { target: { value: 'renamed' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save Settings' }));
  await waitFor(() => expect(useAppContext().saveConfigData).toHaveBeenLastCalledWith(
    expect.objectContaining({ UI: expect.objectContaining({
      zarr_v3_workflows: '["renamed"]', custom_setting: 'keep',
    }) }), expect.anything()));
  fireEvent.click(screen.getByRole('button', { name: 'Delete renamed' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save Settings' }));
  await waitFor(() => expect(useAppContext().saveConfigData).toHaveBeenLastCalledWith(
    expect.objectContaining({ UI: expect.objectContaining({ zarr_v3_workflows: '[]' }) }),
    expect.anything()));
});
