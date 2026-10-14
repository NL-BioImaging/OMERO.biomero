// Shared browser children are keys; older workflow caches contain objects.
export function workflowImages(tree, children = []) {
  return children.flatMap((child) => {
    const image = typeof child === 'string' ? tree[child] : child;
    if (!image || typeof image !== 'object' || typeof image.id === 'boolean') return [];
    const id = Number(image.id);
    if (!Number.isSafeInteger(id) || id <= 0) return [];
    return [{ ...image, id, name: image.name ?? image.data ?? `Image ${id}` }];
  });
}

export function reconcileImageSelection(selected, available) {
  const valid = selected.filter(id => available.includes(id));
  return selected.length && !valid.length ? available : valid;
}
