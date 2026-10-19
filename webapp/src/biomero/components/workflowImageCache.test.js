import { workflowImages, reconcileImageSelection } from './workflowImageCache';

test('resolves image references produced by the shared OMERO browser', () => {
  const tree = { 'image-26': { id: 26, index: 'image-26', data: 'Tilescan.tif' } };
  expect(workflowImages(tree, ['image-26'])).toEqual([
    { id: 26, index: 'image-26', data: 'Tilescan.tif', name: 'Tilescan.tif' },
  ]);
});
test('preserves loaded image objects and excludes unresolved/invalid nodes', () => {
  expect(workflowImages({}, [{ id: 9, name: 'Field' }, 'missing', null, { id: undefined }, { id: true }]))
    .toEqual([{ id: 9, name: 'Field' }]);
});
test('repairs malformed stored selections while preserving valid choices', () => {
  expect(reconcileImageSelection([undefined], [26, 27])).toEqual([26, 27]);
  expect(reconcileImageSelection([27], [26, 27])).toEqual([27]);
  expect(reconcileImageSelection([], [26, 27])).toEqual([]);
});
