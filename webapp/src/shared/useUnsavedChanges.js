import React, { useState } from "react";
import { Alert, Intent } from "@blueprintjs/core";

export default function useUnsavedChanges(dirty) {
  const [pending, setPending] = useState(null);
  const request = (action) => {
    if (dirty) setPending(() => action);
    else action();
  };
  const dialog = <Alert
    isOpen={Boolean(pending)} intent={Intent.WARNING} icon="warning-sign"
    cancelButtonText="Keep editing" confirmButtonText="Discard changes"
    canEscapeKeyCancel canOutsideClickCancel
    onCancel={() => setPending(null)}
    onConfirm={() => { const action = pending; setPending(null); action?.(); }}
  >
    <p>Analysis has unsaved editor changes. Discard them and continue?</p>
  </Alert>;
  return { request, dialog };
}
