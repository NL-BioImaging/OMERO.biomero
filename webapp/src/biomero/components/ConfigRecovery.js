import React, { useEffect, useRef, useState } from "react";
import { Button, H5 } from "@blueprintjs/core";
import { fetchConfigHistory, restoreConfigSnapshot } from "../../apiService";

// Kept independent of workflow discovery and parsed configuration state.
export default function ConfigRecovery() {
  const [open, setOpen] = useState(false);
  const [history, setHistory] = useState(null);
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const perform = async (action) => {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (err) {
      if (mounted.current) setError(err.response?.data?.error || "Configuration recovery failed.");
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  const refresh = () => perform(async () => {
    const result = await fetchConfigHistory();
    if (mounted.current) {
      setHistory(result);
      setSelected("");
    }
  });

  const download = (snapshot) => perform(async () => {
    const data = await fetchConfigHistory(snapshot);
    if (!mounted.current) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `biomero-config-${snapshot}.json`;
    link.click();
    URL.revokeObjectURL(url);
  });

  const restore = () => {
    if (!window.confirm("Restore both configuration files from this snapshot? Current files will be saved in history. The page will reload and discard unsaved edits.")) return;
    perform(async () => {
      await restoreConfigSnapshot(selected, history.revision);
      if (mounted.current) window.location.reload();
    });
  };

  return <div className="mb-4">
    <Button minimal icon="history" disabled={busy} onClick={() => {
      setOpen(!open);
      if (!open) refresh();
    }}>Configuration recovery</Button>
    {open && <div className="mt-2">
      <H5>Private configuration history</H5>
      <p>Snapshots contain both files and may include secrets. Store downloads privately. Restoring replaces both files.</p>
      {error && <div role="alert">{error}</div>}
      <div className="flex gap-2 mb-2">
        <Button disabled={busy} onClick={() => download("current")}>Download current files</Button>
        <Button disabled={busy} onClick={refresh}>Refresh history</Button>
      </div>
      {history && <>
        <label htmlFor="config-snapshot">Previous configuration</label>{" "}
        <select id="config-snapshot" value={selected} disabled={busy} onChange={event => setSelected(event.target.value)}>
          <option value="">Select a snapshot</option>
          {history.snapshots.map(snapshot => <option key={snapshot.id} value={snapshot.id}>
            {new Date(snapshot.timestamp).toLocaleString()} — before the change by {snapshot.editor.username}
          </option>)}
        </select>
        {history.snapshots.length === 0 && <p>No snapshots yet. The first successful save preserves the current files.</p>}
        <div className="flex gap-2 mt-2">
          <Button disabled={busy || !selected} onClick={() => download(selected)}>Download snapshot</Button>
          <Button intent="warning" disabled={busy || !selected} onClick={restore}>Restore snapshot</Button>
        </div>
      </>}
    </div>}
  </div>;
}
