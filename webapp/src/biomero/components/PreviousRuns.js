import React, { useEffect, useState } from "react";
import { Button, ButtonGroup, Callout, Card, Collapse, Dialog, DialogBody, HTMLTable, Icon, InputGroup, NonIdealState, Spinner, Tag, Tooltip } from "@blueprintjs/core";
import { fetchWorkflowHistory, fetchWorkflowHistoryDetail } from "../../apiService";

const statusIntent = status => ({ DONE: "success", FAILED: "danger", CANCELLED: "warning" }[status] || "primary");
const startedLabel = value => {
  const date = new Date(value);
  return value && !Number.isNaN(date.getTime()) ? date.toLocaleString() : "Start time unavailable";
};

export default function PreviousRuns({ isOpen, onClose, onApply, selection, embedded = false, workflowName = "" }) {
  const [query, setQuery] = useState(workflowName);
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState({ runs: [], has_more: false });
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
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
  const content = <div className="flex flex-col gap-3">
    <div className="flex items-center gap-2">
      <InputGroup fill leftIcon="search" aria-label="Search previous runs" placeholder="Search workflow or paste workflow UUID"
        value={query} maxLength={128} onChange={e => { setQuery(e.target.value); setOffset(0); }}
        rightElement={query ? <Button minimal icon="cross" aria-label="Clear history search" onClick={() => { setQuery(""); setOffset(0); }} /> : undefined} />
      <Tooltip content="Your runs in the active group. Select a run to inspect it. Loading settings never submits a workflow." hoverOpenDelay={250}>
        <Button minimal icon="help" aria-label="About previous runs" />
      </Tooltip>
    </div>
    {error && <Callout intent="danger" icon="error" title="History unavailable">
      {error} <Button minimal intent="danger" icon="refresh" onClick={() => setRetry(value => value + 1)}>Retry</Button>
    </Callout>}
    {loading ? <Spinner size={24} aria-label="Loading previous runs" /> : <div className="max-h-64 overflow-auto flex flex-col gap-1">
      {!error && !page.runs.length && <NonIdealState icon="search" title="No previous runs found." description="Try another workflow name or UUID." />}
      {page.runs.map(run => {
        const selected = selectedId === run.workflow_id;
        return <Tooltip key={run.workflow_id} placement="top" hoverOpenDelay={250}
          content={<div className="text-xs max-w-sm"><strong>{run.workflow_name}</strong><div>{startedLabel(run.started)}</div><div className="break-all">{run.workflow_id}</div><div>Select to inspect settings; no job will be submitted.</div></div>}>
          <Button fill alignText="left" outlined={!selected} intent={selected ? "primary" : "none"}
            aria-pressed={selected} onClick={() => setSelectedId(run.workflow_id)}
            icon={selected ? "tick-circle" : "history"} rightIcon="chevron-right">
            <div className="flex items-center justify-between gap-3 py-1">
              <div className="min-w-0"><div className="font-semibold truncate">{run.workflow_name}</div>
                <div className="text-xs">{startedLabel(run.started)}</div></div>
              <Tag round intent={statusIntent(run.status)}>{run.status}</Tag>
            </div>
          </Button>
        </Tooltip>;
      })}
    </div>}
    <div className="flex items-center justify-between">
      <span className="bp5-text-muted text-xs">Page {offset / 20 + 1}</span>
      <ButtonGroup minimal>
        <Button icon="chevron-left" disabled={loading || offset === 0} onClick={() => setOffset(offset - 20)}>Previous page</Button>
        <Button rightIcon="chevron-right" disabled={loading || !page.has_more} onClick={() => setOffset(offset + 20)}>Next page</Button>
      </ButtonGroup>
    </div>
    {detailLoading && <Spinner size={24} aria-label="Loading run details" />}
    {detail && <Card compact>
      <div className="flex items-center gap-2 mb-2"><Icon icon="lab-test" intent="primary" />
        <strong>{detail.workflow_name}</strong><Tag minimal round intent="primary">{detail.form.version}</Tag></div>
      <div className="bp5-text-muted text-xs break-all mb-3">{detail.workflow_id}</div>
      <div className="flex flex-wrap items-center gap-1 mb-3">
        <span className="text-sm">{detail.form.Data_Type}:</span>
        {detail.inputs.map(input => <Tooltip key={input.id} content={`${detail.form.Data_Type} ID: ${input.id}`} hoverOpenDelay={250}>
          <Tag minimal round icon={detail.form.Data_Type === "Plate" ? "grid-view" : "media"} intent="primary">{input.name} ({input.id})</Tag>
        </Tooltip>)}
      </div>
      {!detail.inputs_available && <Callout intent="warning" compact className="mb-2">Some original inputs are missing or inaccessible.</Callout>}
      <Button minimal fill alignText="left" icon="properties" rightIcon={settingsOpen ? "chevron-up" : "chevron-down"}
        aria-expanded={settingsOpen} aria-controls="history-recorded-settings" onClick={() => setSettingsOpen(value => !value)}>Recorded settings</Button>
      <Collapse isOpen={settingsOpen}>
        <div id="history-recorded-settings" className="max-h-64 overflow-auto">
          <HTMLTable compact striped className="w-full text-xs"><thead><tr><th>Setting</th><th>Recorded value</th></tr></thead>
            <tbody>{Object.entries(detail.form).map(([key, value]) => <tr key={key}><th scope="row">{key}</th><td className="break-all">{typeof value === "object" ? JSON.stringify(value) : String(value)}</td></tr>)}</tbody>
          </HTMLTable>
        </div>
      </Collapse>
      <div className="flex flex-wrap gap-2 mt-3">
        {!embedded && <Tooltip content={detail.inputs_available ? "Restore this run's original inputs and settings for review." : "Original inputs are missing or inaccessible."}>
          <span><Button intent="primary" icon="repeat" disabled={!detail.inputs_available} onClick={() => apply(false)}>Run again</Button></span>
        </Tooltip>}
        <Tooltip content={selection?.IDs?.length ? "Keep your selected data and load this run's settings for review." : "Select input data first to reuse settings on another selection."}>
          <span><Button intent={embedded ? "primary" : undefined} icon="import" disabled={!selection?.IDs?.length} onClick={() => apply(true)}>Use settings on selected data</Button></span>
        </Tooltip>
      </div>
    </Card>}
  </div>;
  if (embedded) return isOpen ? content : null;
  return <Dialog isOpen={isOpen} onClose={onClose} title="Previous runs" icon="history" className="w-full max-w-3xl">
    <DialogBody>{content}</DialogBody>
  </Dialog>;
}
