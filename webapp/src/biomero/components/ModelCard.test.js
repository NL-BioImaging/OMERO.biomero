import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import ModelCard from "./ModelCard";

jest.mock("./SettingsForm", () => ({ RuntimeIcon: () => null, SlurmInitIcon: () => null }));
jest.mock("../../apiService", () => ({ fetchContainerImage: jest.fn() }));

const item = { name: "seg", repo: "", job: "jobs/seg.sh" };

test('offers an explicit v3 switch, off by default', () => {
  const change = jest.fn();
  render(<ModelCard item={item} index={0} editable onChange={change}
    descriptorMeta={{ isBilayers: true }} />);
  const toggle = screen.getByRole('checkbox', { name: 'Zarr v3 input (OME-Zarr 0.5)' });
  expect(toggle).not.toBeChecked();
  fireEvent.click(toggle);
  expect(change).toHaveBeenCalledWith(0, 'useZarrV3', true);
});

test('BIAFLOWS remains v2 even with a stale saved opt-in', () => {
  render(<ModelCard item={{ ...item, useZarrV3: true }} index={0} editable
    descriptorMeta={{ isBilayers: false }} />);
  const toggle = screen.getByRole('checkbox', { name: 'Zarr v3 input (OME-Zarr 0.5)' });
  expect(toggle).toBeDisabled();
  expect(toggle).not.toBeChecked();
});

test('locked workflow cards cannot change format', () => {
  render(<ModelCard item={{ ...item, useZarrV3: true }} index={0} editable={false}
    descriptorMeta={{ isBilayers: true }} />);
  expect(screen.getByRole('checkbox', { name: 'Zarr v3 input (OME-Zarr 0.5)' })).toBeDisabled();
});
