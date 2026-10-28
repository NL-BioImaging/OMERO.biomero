import React from 'react';
import { render } from '@testing-library/react';
import WorkflowForm from './WorkflowForm';
import { useAppContext } from '../../AppContext';

jest.mock('../../AppContext', () => ({ useAppContext: jest.fn() }));
jest.mock('./HistoryFeedback', () => ({
  HistoryFieldCue: () => null, WorkflowStepIntro: () => null,
}));

test.each([
  [{ zarr_workflows: '["seg"]' }, {}, '0.4', true],
  [{ zarr_workflows: '["seg"]', zarr_v3_workflows: '["seg"]' }, {}, '0.5', true],
  [{ plate_workflows: '["seg"]', zarr_v3_workflows: '["seg"]' }, {}, '0.5', true],
  [{ zarr_v3_workflows: '["seg"]' }, { 'requires-zarr': true }, '0.5', true],
  [{ zarr_v3_workflows: '["seg"]' }, {}, '0.4', false],
])('passes the UI format choice through form data: %j', (ui, metadata, expected, zarr) => {
  const updateState = jest.fn();
  useAppContext.mockReturnValue({ updateState, state: {
    selectedWorkflow: { name: 'seg', metadata: { inputs: [], ...metadata } },
    config: { UI: ui }, formData: { omeZarrVersion: '0.5', useZarrFormat: false },
  } });
  render(<WorkflowForm />);
  expect(updateState).toHaveBeenCalledWith({ formData: expect.objectContaining({
    omeZarrVersion: expected, useZarrFormat: zarr,
  }) });
});
