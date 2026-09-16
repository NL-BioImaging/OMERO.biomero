import React, { useEffect, useState } from "react";
import { Spinner, Tooltip } from "@blueprintjs/core";
import { fetchPlateGridData } from "../../apiService";

export const objectUrl = (type, id) => `/webclient/?show=${type.toLowerCase()}-${encodeURIComponent(id)}`;
export const workflowSearchUrl = id => `/webclient/search/?search_query=${encodeURIComponent(id)}`;

// Only the selected run's first object is previewed. Plate cells reuse the
// webgateway grid used by PlateWorkflowInput, with at most six thumbnails.
export default function HistoryDataPreview({ type, id }) {
  const [cells, setCells] = useState([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setCells([]);
    setFailed(false);
    if (type !== "Plate") return;
    const controller = new AbortController();
    setLoading(true);
    fetchPlateGridData(id, controller.signal).then(data => {
      if (!controller.signal.aborted) setCells((data.grid || []).flatMap((row, r) =>
        row.map((cell, c) => cell && ({ ...cell, well: `${data.rowlabels[r]}${data.collabels[c]}` }))
      ).filter(Boolean).slice(0, 6));
    }).catch(() => { if (!controller.signal.aborted) setFailed(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [type, id]);
  if (type === "Image") return <a href={objectUrl(type, id)} target="_blank" rel="noopener noreferrer">
    <img loading="lazy" src={`/webgateway/render_thumbnail/${encodeURIComponent(id)}/`} alt={`Image ${id} preview`}
      className="w-24 h-24 object-contain" onError={e => { e.currentTarget.hidden = true; }} />
  </a>;
  if (type !== "Plate") return null;
  if (loading) return <Spinner size={20} aria-label="Loading plate preview" />;
  if (failed) return <span className="bp5-text-muted text-xs">Preview unavailable. Open the plate to inspect it.</span>;
  return <div className="my-2">
    <div className="flex flex-wrap gap-2">{cells.map(cell => <Tooltip key={cell.well} content={`${cell.well}: ${cell.name}`}>
      <a href={objectUrl(type, id)} target="_blank" rel="noopener noreferrer" className="text-center text-xs">
        <img loading="lazy" src={cell.thumb_url} alt={`Well ${cell.well}`} className="w-16 h-16 object-cover rounded" />
        {cell.well}
      </a>
    </Tooltip>)}</div>
  </div>;
}
