import React, { useEffect, useState } from "react";
import { Button, Callout, Card, Dialog, DialogBody, InputGroup, Spinner, Tag } from "@blueprintjs/core";
import { fetchWorkflowHistory, fetchWorkflowHistoryDetail } from "../../apiService";

export default function PreviousRuns({ isOpen, onClose, onApply, selection }) {
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState({ runs: [], has_more: false });
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!isOpen) return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setSelectedId(null);
    setDetail(null);
    setDetailLoading(false);
    const timer = setTimeout(() => {
      fetchWorkflowHistory(query, offset, controller.signal).then(result => {
        if (!controller.signal.aborted) {
          setPage(result);
          setSelectedId(result.runs[0]?.workflow_id || null);
        }
      }).catch(() => {
        if (!controller.signal.aborted) setError("Could not load previous runs. Try again.");
      }).finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [isOpen, query, offset, retry]);

  useEffect(() => {
    if (!isOpen || !selectedId) return;
    const controller = new AbortController();
    setDetail(null);
    setDetailLoading(true);
    setError("");
    fetchWorkflowHistoryDetail(selectedId, controller.signal).then(result => {
      if (!controller.signal.aborted) setDetail(result);
    }).catch(error => {
      if (!controller.signal.aborted) setError(error.response?.data?.error || "Could not load this run.");
    }).finally(() => {
      if (!controller.signal.aborted) setDetailLoading(false);
    });
    return () => controller.abort();
  }, [isOpen, selectedId]);

  const apply = useSelection => {
    try { onApply(detail, useSelection ? selection : null); }
    catch (error) { setError(error.message); }
  };
  return <Dialog isOpen={isOpen} onClose={onClose} title="Previous runs" icon="history" style={{ width: 760 }}>
    <DialogBody>
      <p>Your runs in the active group. Loading settings does not start a workflow.</p>
      <InputGroup aria-label="Search previous runs" placeholder="Search workflow or paste workflow UUID"
        value={query} maxLength={128} onChange={e => { setQuery(e.target.value); setOffset(0); }} />
      {error && <Callout intent="danger" className="my-2">{error}
        <Button minimal onClick={() => setRetry(value => value + 1)}>Retry</Button>
      </Callout>}
      {loading ? <Spinner size={24} /> : <div className="max-h-64 overflow-auto my-3">
        {!page.runs.length && <p>No previous runs found.</p>}
        {page.runs.map(run => <Card key={run.workflow_id} className="mb-2">
          <Button minimal active={selectedId === run.workflow_id} onClick={() => setSelectedId(run.workflow_id)}>
            {run.workflow_name} — {new Date(run.started).toLocaleString()}
          </Button> <Tag>{run.status}</Tag>
          <div className="text-xs text-gray-500">{run.workflow_id}</div>
        </Card>)}
      </div>}
      <div className="flex gap-2">
        <Button disabled={loading || offset === 0} onClick={() => setOffset(offset - 20)}>Previous page</Button>
        <Button disabled={loading || !page.has_more} onClick={() => setOffset(offset + 20)}>Next page</Button>
      </div>
      {detailLoading && <Spinner size={24} />}
      {detail && <div className="mt-4">
        <h4>{detail.workflow_name} — {detail.form.version}</h4>
        <p>{detail.form.Data_Type}: {detail.inputs.map(input => `${input.name} (${input.id})`).join(", ")}</p>
        {!detail.inputs_available && <Callout intent="warning">Some original inputs are missing or inaccessible.</Callout>}
        <details><summary>Recorded settings</summary><pre className="max-h-48 overflow-auto">{JSON.stringify(detail.form, null, 2)}</pre></details>
        <div className="flex gap-2 mt-3">
          <Button intent="primary" disabled={!detail.inputs_available} onClick={() => apply(false)}>Run again</Button>
          <Button disabled={!selection?.IDs?.length} onClick={() => apply(true)}>Use settings on selected data</Button>
        </div>
      </div>}
    </DialogBody>
  </Dialog>;
}
