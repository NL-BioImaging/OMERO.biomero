import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import ModelCard from "./ModelCard";

jest.mock("./SettingsForm", () => ({ RuntimeIcon: () => null, SlurmInitIcon: () => null }));
jest.mock("../../apiService", () => ({ fetchContainerImage: jest.fn() }));

const item = { name: "seg", repo: "", job: "jobs/seg.sh", isZarrWorkflow: true };

test('offers an explicit v3 switch, off by default', () => {
  const change = jest.fn();
  render(<ModelCard item={item} index={0} editable onChange={change}
    descriptorMeta={{ isBilayers: true }} />);
  const toggle = screen.getByRole('checkbox', { name: 'Zarr v3 input (OME-Zarr 0.5)' });
  expect(toggle).not.toBeChecked();
  fireEvent.click(toggle);
  expect(change).toHaveBeenCalledWith(0, 'useZarrV3', true);
});

test('places v3 below the Zarr parent and explains why it is disabled without Zarr', async () => {
  render(<ModelCard item={{ ...item, isZarrWorkflow: false, useZarrV3: true }} index={0} editable
    descriptorMeta={{ isBilayers: true }} />);
  const parent = screen.getByRole('checkbox', { name: 'Zarr Format Required' });
  const toggle = screen.getByRole('checkbox', { name: 'Zarr v3 input (OME-Zarr 0.5)' });
  expect(parent.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(toggle).toBeDisabled();
  expect(toggle).not.toBeChecked();
  fireEvent.mouseOver(toggle.closest('[tabindex]'));
  expect(await screen.findByText('Enable Zarr Format Required first, or use a descriptor that requires Zarr or plate input.')).toBeVisible();
});

test.each([{ requiresZarr: true }, { requiresPlate: true }, {}])(
  'allows a manual v3 choice for effective Zarr input: %j', (metadata) => {
    render(<ModelCard item={{ ...item, isZarrWorkflow: !Object.keys(metadata).length }} index={0} editable
      descriptorMeta={{ isBilayers: true, ...metadata }} />);
    expect(screen.getByRole('checkbox', { name: 'Zarr Format Required' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Zarr v3 input (OME-Zarr 0.5)' })).toBeEnabled();
  }
);

test.each([
  [false, { isBilayers: true }, 'Click Edit Model to change the workflow input format.'],
])('explains a disabled v3 switch', async (editable, metadata, reason) => {
  render(<ModelCard item={item} index={0} editable={editable} descriptorMeta={metadata} />);
  const toggle = screen.getByRole('checkbox', { name: 'Zarr v3 input (OME-Zarr 0.5)' });
  fireEvent.mouseOver(toggle.closest('[tabindex]'));
  expect(await screen.findByText(reason)).toBeVisible();
});

test('a manually enabled native Zarr BIAFLOWS workflow can select v3', () => {
  render(<ModelCard item={{ ...item, useZarrV3: true }} index={0} editable
    descriptorMeta={{ isBilayers: false }} />);
  const toggle = screen.getByRole('checkbox', { name: 'Zarr v3 input (OME-Zarr 0.5)' });
  expect(toggle).toBeEnabled();
  expect(toggle).toBeChecked();
});

test('locked workflow cards cannot change format', () => {
  render(<ModelCard item={{ ...item, useZarrV3: true }} index={0} editable={false}
    descriptorMeta={{ isBilayers: true }} />);
  expect(screen.getByRole('checkbox', { name: 'Zarr v3 input (OME-Zarr 0.5)' })).toBeDisabled();
});
