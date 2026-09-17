import React, { useEffect, useState, useRef } from "react";
import { Button, Callout, Card, Collapse, HTMLTable, Icon, InputGroup, NonIdealState, Spinner, Tag, Tooltip } from "@blueprintjs/core";
import { fetchWorkflowHistory, fetchWorkflowHistoryDetail } from "../../apiService";
import HistoryDataPreview, { objectUrl, workflowSearchUrl } from "./HistoryDataPreview";

const statusIntent = status => ({ DONE: "success", FAILED: "danger", CANCELLED: "warning" }[status] || "primary");
const startedLabel = value => {
  const date = new Date(value);
  return value && !Number.isNaN(date.getTime()) ? date.toLocaleString() : "Start time unavailable";
};
export const durationLabel = (started, ended) => {
  if (!started || !ended) return null;
  const seconds = Math.floor((new Date(ended) - new Date(started)) / 1000);
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
};

function DataLinks({ objects, type, preview = false }) {
  const [expanded, setExpanded] = useState(false);
  return <div className="mt-2">
    <div className="flex flex-wrap gap-1 max-h-32 overflow-auto">
      {(expanded ? objects : objects.slice(0, 1)).map(object => {
        const kind = object.type || type;
        return <a key={`${kind}-${object.id}`} className="max-w-full" title={`Open full ${kind.toLowerCase()}: ${object.name} (${object.id})`}
          href={objectUrl(kind, object.id)} target="_blank" rel="noopener noreferrer">
          <Tag minimal intent="primary" className="max-w-full" icon={kind === "Plate" ? "grid-view" : "media"}>
            <span className="inline-block max-w-full truncate align-middle">{object.name} ({object.id})</span>
          </Tag>
        </a>;
      })}
    </div>
    {objects.length > 1 && <Button minimal small intent="primary" icon={expanded ? "chevron-up" : "chevron-down"}
      aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>
      {expanded ? "Show fewer" : preview ? `Show preview (${objects.length})` : `+${objects.length - 1} more`}
    </Button>}
  </div>;
}

export function batchListLabel(name) {
  const child = name?.match(/\(batch (\d+)\/(\d+)\)$/i);
  return child ? `Batch ${child[1]}/${child[2]}` : name?.endsWith("(Batched)") ? "Whole run" : null;
}

function BatchNavigation({ batch, selectedId, onSelect }) {
  const [expanded, setExpanded] = useState(false);
  const children = batch.children || [];
  return <Callout compact icon="layers" intent="primary" className="my-2">
    <div className="flex flex-wrap items-center gap-2">
      <strong>{batch.role === "child" ? `Batch ${batch.index} of ${batch.total}` : `Whole run · ${batch.total} batches`}</strong>
      {batch.role === "child" && <Button outlined small intent="primary" icon="layers" onClick={() => onSelect(batch.parent_id)}>View whole run</Button>}
    </div>
    {batch.role === "child" && <div className="text-xs mt-1">Rerun all original images, or only the images in this batch.</div>}
    <div className="flex flex-wrap gap-2 mt-2 max-h-40 overflow-auto">
      {(expanded ? children : children.slice(0, 4)).map(child => <Tooltip key={child.workflow_id} content={`Open batch ${child.index} · ${child.workflow_id}`}>
        <Button small outlined={child.workflow_id !== selectedId} active={child.workflow_id === selectedId}
          intent={statusIntent(child.status)} onClick={() => onSelect(child.workflow_id)}>
          Batch {child.index} · {child.status}
        </Button>
      </Tooltip>)}
    </div>
    {children.length > 4 && <Button minimal small intent="primary" icon={expanded ? "chevron-up" : "chevron-down"}
      aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? "Show fewer batches" : `Show all ${children.length} batches`}</Button>}
  </Callout>;
}

export default function PreviousRuns({ isOpen = true, onApply, selection, embedded = false, workflowName = "", searchQuery, onTotal }) {
  const [localQuery, setQuery] = useState(workflowName);
  const query = searchQuery ?? localQuery;
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState({ runs: [], has_more: false });
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const scrollRoot = useRef(null);
  const sentinel = useRef(null);
  useEffect(() => { onTotal?.(null); }, [query, onTotal]);
  useEffect(() => {
    if (!isOpen) return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    if (offset === 0) {
      setSelectedId(null);
      setDetail(null);
      setDetailLoading(false);
    }
    const timer = setTimeout(() => {
      fetchWorkflowHistory(query, offset, controller.signal).then(result => {
        if (!controller.signal.aborted) {
          onTotal?.(result.total);
          setPage(previous => ({ ...result, runs: offset === 0 ? result.runs :
            [...new Map([...previous.runs, ...result.runs].map(run => [run.workflow_id, run])).values()] }));
          setSelectedId(previous => offset === 0 ? result.runs[0]?.workflow_id || null : previous);
        }
      }).catch(() => {
        if (!controller.signal.aborted) setError("Could not load previous runs. Try again.");
      }).finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [isOpen, query, offset, retry, onTotal]);

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
  }, [isOpen, selectedId, retry]);

  useEffect(() => {
    if (!isOpen || loading || error || !page.has_more || !sentinel.current || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        observer.disconnect();
        setOffset(value => value + 20);
      }
    }, { root: scrollRoot.current });
    observer.observe(sentinel.current);
    return () => observer.disconnect();
  }, [isOpen, loading, error, page.has_more, page.runs.length]);

  const apply = (useSelection, differentData = false, wholeRun = false) => {
    const source = wholeRun ? detail.parent_run : detail;
    try { onApply(source, differentData ? { Data_Type: source.form.Data_Type, IDs: [], batchEnabled: false, batchSize: 1 } : useSelection ? selection : null); }
    catch (error) { setError(error.message); }
  };
  const content = <div className="flex flex-col gap-3">
    {searchQuery === undefined && <div className="flex items-center gap-2">
      <InputGroup fill leftIcon="search" aria-label="Search previous runs" placeholder="Search workflow or paste workflow UUID"
        value={query} maxLength={128} onChange={e => { setQuery(e.target.value); setOffset(0); }}
        rightElement={query ? <Button minimal icon="cross" aria-label="Clear history search" onClick={() => { setQuery(""); setOffset(0); }} /> : undefined} />
      <Tooltip content="Your runs in the active group. Select a run to inspect it. Loading settings never submits a workflow." hoverOpenDelay={250}>
        <Button minimal icon="help" aria-label="About previous runs" />
      </Tooltip>
    </div>}
    {error && <Callout intent="danger" icon="error" title="History unavailable">
      {error} <Button minimal intent="danger" icon="refresh" onClick={() => setRetry(value => value + 1)}>Retry</Button>
    </Callout>}
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
    <section aria-label="Workflow run history" className="min-w-0">
    <div className="flex items-center justify-between mb-2"><strong>Recent runs</strong><Tag minimal round>{page.runs.length} of {page.total ?? "…"}</Tag></div>
    {loading && offset === 0 ? <Spinner size={24} aria-label="Loading previous runs" /> : <div ref={scrollRoot} className={`${embedded ? "max-h-48 lg:max-h-[55vh]" : "max-h-[65vh]"} overflow-auto flex flex-col gap-1`}>
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
                <div className="text-xs">{startedLabel(run.started)}</div>
                {!embedded && <div className="text-xs font-mono break-all">{run.workflow_id}</div>}</div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                {batchListLabel(run.name) && <Tag minimal round icon="layers">{batchListLabel(run.name)}</Tag>}
                <Tag round intent={statusIntent(run.status)}>{run.status}</Tag>
              </div>
            </div>
          </Button>
        </Tooltip>;
      })}
    {page.has_more && <div ref={sentinel}><Button className="mt-2" fill outlined icon="more" loading={loading} disabled={loading || !!error}
      onClick={() => setOffset(offset + 20)}>Load more runs</Button></div>}
    </div>}
    </section>
    <section aria-label="Selected run details" className="min-w-0">
    {detailLoading && <Spinner size={24} aria-label="Loading run details" />}
    {detail && <Card compact className={embedded ? "max-h-[55vh] overflow-auto" : undefined}>
      <div className="flex flex-wrap items-center gap-2 mb-2"><Icon icon="lab-test" intent="primary" />
        <strong>{detail.workflow_name}</strong><Tag minimal round intent="primary">{detail.form.version}</Tag>
        <Tooltip className="ml-auto" content="Search this workflow UUID in OMERO">
          <a className="text-xs font-mono break-all" href={workflowSearchUrl(detail.workflow_id)}
            target="_blank" rel="noopener noreferrer">{detail.workflow_id}</a>
        </Tooltip>
      </div>
      {embedded && !!selection?.IDs?.length && <div className="sticky top-0 z-10 bg-white py-2 mb-2">
        <Tooltip content="Keep your selected data and output choices, and load this run's settings for review.">
          <Button intent="primary" disabled={!!detail.rerun_error} icon="import" onClick={() => apply(true)}>Use settings on selected data</Button>
        </Tooltip>
      </div>}
      {[{ ...page.runs.find(run => run.workflow_id === selectedId), ...detail }].map(run => <div key={run.workflow_id} className="flex flex-wrap items-center gap-2 mb-3">
        <Tag round intent={statusIntent(run.status)}>{run.status}</Tag>
        <span className="text-sm"><Icon icon="time" size={12} /> {startedLabel(run.started)}</span>
        {run.name && <span className="bp5-text-muted text-xs">{run.name}</span>}
      </div>)}
      {durationLabel(detail.started, detail.ended) && <Tooltip content={`Ended ${startedLabel(detail.ended)}`}>
        <Tag minimal icon="stopwatch">Duration: {durationLabel(detail.started, detail.ended)}</Tag>
      </Tooltip>}
      {detail.rerun_error && <Callout compact intent="warning" className="my-2">{detail.rerun_error}</Callout>}
      {detail.batch && <BatchNavigation key={selectedId} batch={detail.batch} selectedId={selectedId} onSelect={setSelectedId} />}
      <div className={detail.outputs?.length > 0 ? "grid grid-cols-1 sm:grid-cols-2 gap-4 my-3" : "my-3"}>
      {detail.form.IDs.length > 0 && <section aria-label="Input data" className="min-w-0">
        <strong>Input data</strong> <Tag minimal round>{detail.form.IDs.length} {detail.form.Data_Type}{detail.form.IDs.length === 1 ? "" : "s"}</Tag>
        <DataLinks key={`inputs-${selectedId}`} objects={detail.inputs} type={detail.form.Data_Type} />
        {detail.inputs[0] && <HistoryDataPreview key={`input-${selectedId}`} type={detail.form.Data_Type} id={detail.inputs[0].id} />}
      </section>}
      {detail.outputs?.length > 0 && <section aria-label="Output data" className="min-w-0">
        <strong><Icon icon="arrow-right" /> Output data</strong> <Tag minimal round>{detail.outputs_more ? `Preview: first ${detail.outputs.length}` : `${detail.outputs.length} objects`}</Tag>
        <DataLinks key={`outputs-${selectedId}`} objects={detail.outputs} preview={detail.outputs_more} />
        {detail.outputs?.[0] && <HistoryDataPreview key={`output-${selectedId}`} type={detail.outputs[0].type} id={detail.outputs[0].id} />}
        {detail.outputs_more && <div className="bp5-text-muted text-xs mt-1">More results are available. Open OMERO below for the full list.</div>}
      </section>}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2 my-2 text-xs">
        {!detail.outputs?.length && (detail.status || page.runs.find(run => run.workflow_id === selectedId)?.status) !== "FAILED" &&
          <span className="bp5-text-muted">{detail.outputs_unavailable ? "Result links are unavailable." : "No output objects found in recorded metadata."}</span>}
        <a href={workflowSearchUrl(detail.workflow_id)} target="_blank" rel="noopener noreferrer">
          <Icon icon="search" /> {detail.outputs_more ? "View all results in OMERO" : "Search workflow results in OMERO"}
        </a>
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
        {!embedded && detail.batch?.role === "child" && <Tooltip content="Restore all original inputs and batching settings from the parent run.">
          <span><Button intent="primary" icon="repeat" disabled={!detail.parent_run?.inputs_available} onClick={() => apply(false, false, true)}>Rerun whole run</Button></span>
        </Tooltip>}
        {!embedded && <Tooltip content={detail.inputs_available ? "Restore this run's original inputs and settings for review." : "Original inputs are missing or inaccessible."}>
          <span><Button intent="primary" outlined={detail.batch?.role === "child"} icon="repeat" disabled={!detail.inputs_available || !!detail.rerun_error} onClick={() => apply(false)}>{detail.batch?.role === "child" ? "Rerun this batch only" : detail.batch?.role === "parent" ? "Rerun whole run" : "Run again on same data"}</Button></span>
        </Tooltip>}
        {!embedded && <Tooltip content="Restore the settings, then choose new input data. Nothing is submitted yet.">
          <Button outlined intent="primary" icon="exchange" disabled={!!detail.rerun_error} onClick={() => apply(false, true)}>Run on different data</Button>
        </Tooltip>}
      </div>
    </Card>}
    {!detail && !detailLoading && !error && !loading && page.runs.length > 0 &&
      <NonIdealState icon="history" title="Select a run" description="Inspect its inputs and settings before running again." />}
    </section>
    </div>
  </div>;
  return isOpen ? content : null;
}
