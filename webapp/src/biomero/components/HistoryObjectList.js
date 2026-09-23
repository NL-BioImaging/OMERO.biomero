import React, { useEffect, useRef, useState } from "react";
import { AnchorButton, Button, H6, Icon, Tag, Tooltip } from "@blueprintjs/core";
import { fetchWorkflowHistoryOutputs } from "../../apiService";
import HistoryDataPreview, { objectUrl } from "./HistoryDataPreview";

function ObjectLink({ object, type }) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const previewable = type === "Plate" || type === "Image";
  const link = <a className="block truncate text-sm" href={objectUrl(type, object.id)}
    target="_blank" rel="noopener noreferrer" aria-label={`${object.name} (${object.id})`}>
    {object.name}
  </a>;
  return <li className="flex items-center gap-2 min-h-8 min-w-0 w-full">
    <Icon icon={type === "Plate" ? "grid-view" : type === "Image" ? "media" : "folder-close"} className="bp5-text-muted shrink-0" />
    <div className="min-w-0 flex-1">
      {previewable ? <Tooltip className="!block min-w-0 w-full" hoverOpenDelay={300}
        onOpening={() => setPreviewOpen(true)} onClosed={() => setPreviewOpen(false)}
        content={<div className="max-w-xs">
          <div className="font-semibold break-words">{object.name} ({object.id})</div>
          {previewOpen && <HistoryDataPreview type={type} id={object.id} />}
          <div className="text-xs">OMERO pixel preview · Open the object to inspect all results.</div>
        </div>}>{link}</Tooltip> : link}
    </div>
    {object.viewer_url && <Tooltip className="shrink-0" content="Open in Zarr viewer">
      <AnchorButton outlined small intent="primary" icon="layers" href={object.viewer_url}
        target="_blank" rel="noopener noreferrer" aria-label={`Open ${object.name} in Zarr viewer`} />
    </Tooltip>}
  </li>;
}

export default function HistoryObjectList({ objects, type, output = false, hasMore = false, workflowId, total, hideHeading = false, onCount }) {
  const [items, setItems] = useState(objects);
  const [more, setMore] = useState(hasMore);
  const [visible, setVisible] = useState(5);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const request = useRef(null);
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => { onCount?.(`${items.length}${more ? "+" : ""}`); }, [items.length, more, onCount]);
  const label = output ? "outputs" : "inputs";
  const showMore = async () => {
    if (request.current) return;
    if (visible < items.length) { setVisible(value => value + 20); return; }
    if (!output || !more) return;
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError(false);
    const last = items[items.length - 1];
    try {
      const page = await fetchWorkflowHistoryOutputs(workflowId, last ? `${last.type}:${last.id}` : undefined, controller.signal);
      if (!controller.signal.aborted) {
        setItems(previous => [...new Map([...previous, ...page.objects].map(item => [`${item.type}:${item.id}`, item])).values()]);
        setMore(page.has_more);
        setVisible(value => value + 20);
      }
    } catch (_) {
      if (!controller.signal.aborted) setError(true);
    } finally {
      if (!controller.signal.aborted) { request.current = null; setLoading(false); }
    }
  };
  return <section aria-label={output ? "Output data" : "Input data"} className="min-w-0">
    {!hideHeading && <div className="flex items-center gap-2 mb-2">
      <H6 className="!m-0">{output ? "Output data" : "Input data"}</H6>
      <Tag minimal round>{output ? `${items.length}${more ? "+" : ""}` : total ?? items.length}</Tag>
    </div>}
    <ul className="list-none m-0 p-0 max-h-64 overflow-y-auto overflow-x-hidden">
      {items.slice(0, visible).map(object => <ObjectLink key={`${object.type || type}:${object.id}`} object={object} type={object.type || type} />)}
    </ul>
    {error && <div role="alert" className="bp5-text-muted text-xs">Could not load more results.</div>}
    {(visible < items.length || more) && <Button minimal small intent="primary" icon="more" loading={loading}
      onClick={showMore}>{error ? "Retry outputs" : `Show more ${label}`}</Button>}
    {visible > 5 && <Button minimal small icon="chevron-up" onClick={() => setVisible(5)}>Show fewer {label}</Button>}
  </section>;
}
