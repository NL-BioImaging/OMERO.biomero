import React from 'react';
import { render, screen } from '@testing-library/react';
import ConfigSection from './ConfigSection';

const props = { items: [], CardComponent: () => null, onAddItem: jest.fn() };

test('replaces the existing Zarr icon with the current edited format, not a second icon', () => {
  const { container, rerender } = render(<ConfigSection {...props}
    items={[{ name: 'seg', isZarrWorkflow: true }]} />);
  expect(screen.getByRole('img', { name: /Zarr v2 \/ OME-Zarr 0.4/ })).toBeInTheDocument();
  expect(container.querySelectorAll('[data-icon="cube"]')).toHaveLength(1);
  rerender(<ConfigSection {...props} items={[{ name: 'renamed', isZarrWorkflow: true, useZarrV3: true }]}
    config={{ UI: { zarr_v3_workflows: '[]' } }} />);
  expect(screen.getByRole('img', { name: /Zarr v3 \/ OME-Zarr 0.5/ })).toBeInTheDocument();
  expect(container.querySelectorAll('[data-icon="cube"]')).toHaveLength(1);
  expect(container.querySelector('[data-icon="cube"]')).toHaveClass('bp5-intent-success');
});

test('plate overview keeps one type icon with the format in its tooltip and accessible label', () => {
  const { container } = render(<ConfigSection {...props}
    items={[{ name: 'plate', useZarrV3: true }]}
    descriptorMetadata={{ 0: { requiresPlate: true, isBilayers: true } }} />);
  expect(screen.getByRole('img', { name: /Plate workflow.*Zarr v3 \/ OME-Zarr 0.5/ })).toBeInTheDocument();
  expect(container.querySelectorAll('[data-icon="grid-view"]')).toHaveLength(1);
  expect(container.querySelectorAll('[data-icon="cube"]')).toHaveLength(0);
});

test('a native Zarr BIAFLOWS workflow shows its selected v3 format', () => {
  render(<ConfigSection {...props} items={[{ name: 'seg', isZarrWorkflow: true, useZarrV3: true }]}
    descriptorMetadata={{ 0: { isBilayers: false } }} />);
  expect(screen.getByRole('img', { name: /Zarr v3 \/ OME-Zarr 0.5/ })).toBeInTheDocument();
});
