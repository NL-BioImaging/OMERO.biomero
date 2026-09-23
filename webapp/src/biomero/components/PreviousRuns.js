import React, { useEffect, useState, useRef } from "react";
import { Breadcrumb, Breadcrumbs, Button, ButtonGroup, Callout, Card, Collapse, Divider, HTMLTable, Icon, InputGroup, NonIdealState, Spinner, Tab, Tabs, Tag, Tooltip } from "@blueprintjs/core";
import { fetchWorkflowHistory, fetchWorkflowHistoryDetail } from "../../apiService";
import { workflowSearchUrl } from "./HistoryDataPreview";
import HistoryObjectList from "./HistoryObjectList";

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

function RunDataTabs({ detail }) {
  const [outputCount, setOutputCount] = useState(`${detail.outputs?.length || 0}${detail.outputs_more ? "+" : ""}`);
  return <Tabs id="history-data" defaultSelectedTabId={detail.form.IDs.length ? "inputs" : "outputs"}>
    {detail.form.IDs.length > 0 && <Tab id="inputs" title={<>Input data <Tag minimal round>{detail.form.IDs.length}</Tag></>}
      panel={<HistoryObjectList objects={detail.inputs} type={detail.form.Data_Type} hideHeading total={detail.form.IDs.length} />} />}
    {detail.outputs?.length > 0 && <Tab id="outputs" title={<>Output data <Tag minimal round>{outputCount}</Tag></>}
      panel={<HistoryObjectList objects={detail.outputs} output hideHeading hasMore={detail.outputs_more}
        workflowId={detail.workflow_id} onCount={setOutputCount} />} />}
  </Tabs>;
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

export default function PreviousRuns({ isOpen = true, onApply, selection, embedded = false, workflowName = "", searchQuery, onTotal, onWorkflowFilter, workflows = [] }) {
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
  const workflowDescription = workflows?.find(workflow => workflow.name === detail?.workflow_name)?.description;
  const timing = detail && <div>
    <div>Started: {startedLabel(detail.started)}</div>
    <div>Ended: {detail.ended ? startedLabel(detail.ended) : "Not recorded"}</div>
    <div>Duration: {durationLabel(detail.started, detail.ended) || "Not available"}</div>
    <div className="text-xs">Times shown in your local timezone.</div>
  </div>;
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
                </div>
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
      <header className="min-w-0 mb-3">
      <nav aria-label="Workflow and run">
        <Breadcrumbs minVisibleItems={1} items={[
          { text: detail.workflow_name, icon: "lab-test", href: "#", onClick: event => {
            event.preventDefault();
            if (onWorkflowFilter) onWorkflowFilter(detail.workflow_name);
            else { setQuery(detail.workflow_name); setOffset(0); }
          } },
          { text: detail.workflow_id.slice(0, 8), current: true, href: workflowSearchUrl(detail.workflow_id), target: "_blank", rel: "noopener noreferrer" },
        ]} breadcrumbRenderer={props => <Tooltip content={props.current ? `Workflow run ${detail.workflow_id}` : <div className="max-w-sm">
          <strong>{detail.workflow_name} · {detail.form.version || "Version not recorded"}</strong>
          {workflowDescription && <p className="mt-2 mb-0">{workflowDescription}</p>}
          <p className="mt-2 mb-0">Show runs of this workflow</p>
        </div>}>
          <Breadcrumb {...props} className={props.current ? "font-mono" : "!text-lg font-semibold"} />
        </Tooltip>} />
      </nav>
      {[{ ...page.runs.find(run => run.workflow_id === selectedId), ...detail }].map(run => <div key={run.workflow_id} className="flex flex-wrap items-center gap-3 mt-2 text-xs bp5-text-muted">
        <Tag minimal intent={statusIntent(run.status)}>{run.status}</Tag>
        <Tooltip content={timing}><span tabIndex={0}><Icon icon="time" size={12} /> {startedLabel(run.started)}</span></Tooltip>
        {durationLabel(detail.started, detail.ended) && <Tooltip content={timing}>
          <span tabIndex={0}><Icon icon="stopwatch" size={12} /> {durationLabel(detail.started, detail.ended)}</span>
        </Tooltip>}
      </div>)}
      </header>
      <Divider className="!mx-0 !mb-3" />
      {embedded && !!selection?.IDs?.length && <div className="sticky top-0 z-10 bg-white py-2 mb-2">
        <Tooltip content="Keep your selected data and output choices, and load this run's settings for review.">
          <Button intent="primary" disabled={!!detail.rerun_error} icon="import" onClick={() => apply(true)}>Use settings on selected data</Button>
        </Tooltip>
      </div>}
      {detail.rerun_error && <Callout compact intent="warning" className="my-2">{detail.rerun_error}</Callout>}
      {detail.batch && <BatchNavigation key={selectedId} batch={detail.batch} selectedId={selectedId} onSelect={setSelectedId} />}
      <RunDataTabs key={selectedId} detail={detail} />
      <div className="flex flex-wrap items-center justify-end gap-2 my-2 text-xs">
        {!detail.outputs?.length && (detail.status || page.runs.find(run => run.workflow_id === selectedId)?.status) !== "FAILED" &&
          <span className="bp5-text-muted">{detail.outputs_unavailable ? "Result links are unavailable." : "No output objects found in recorded metadata."}</span>}
        <ButtonGroup minimal>
          <Tooltip content="Inspect the recorded settings">
            <span><Button minimal icon="properties" aria-label="Recorded settings" active={settingsOpen}
              aria-expanded={settingsOpen} aria-controls="history-recorded-settings" onClick={() => setSettingsOpen(value => !value)} /></span>
          </Tooltip>
          <Tooltip content={detail.outputs_more ? "View all results in OMERO" : "Search workflow results in OMERO"}>
            <a className="bp5-button bp5-minimal" aria-label={detail.outputs_more ? "View all results in OMERO" : "Search workflow results in OMERO"}
              href={workflowSearchUrl(detail.workflow_id)} target="_blank" rel="noopener noreferrer"><Icon icon="search" /></a>
          </Tooltip>
        </ButtonGroup>
      </div>
      {!detail.inputs_available && <Callout intent="warning" compact className="mb-2">Some original inputs are missing or inaccessible.</Callout>}
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
