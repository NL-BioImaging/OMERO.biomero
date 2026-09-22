import React from "react";
import { Callout, Tag, Tooltip } from "@blueprintjs/core";
import { useAppContext } from "../../AppContext";
import { sameHistoryValue } from "../runHistory";

export function HistoryDialogTitle({ title }) {
  const { state } = useAppContext();
  const history = state.historyRun;
  if (!history) return title;
  return `${history.mode === "rerun" ? "Rerun" : "Reuse settings"}: ${title}`;
}

export function WorkflowStepIntro({ children, step = "settings" }) {
  const { state } = useAppContext();
  const history = state.historyRun;
  return <Callout intent="primary" icon={history ? "history" : "info-sign"} className="mb-4">
    {history ? <>
      {history.mode === "rerun" ? "Rerunning workflow from " : "Reusing settings from "}
      <Tooltip content={`Workflow ${history.id}`}><span>{history.sourceLabel || "a previous run"}</span></Tooltip>. Review {step} before submitting.
    </> : children}
  </Callout>;
}

export function HistoryWarnings() {
  const { state } = useAppContext();
  const warnings = state.historyRun?.warnings || [];
  return warnings.length > 0 && <Callout intent="warning" className="mb-3">
    {warnings.map(warning => <p key={warning}>{warning}</p>)}
  </Callout>;
}

export function HistoryFieldCue({ field }) {
  const { state } = useAppContext();
  const history = state.historyRun;
  if (!history || !Object.prototype.hasOwnProperty.call(history.values, field)) return null;
  const unchanged = sameHistoryValue(history.values[field], state.formData[field]);
  return <Tooltip content={`From run ${history.id}${unchanged ? "" : "; changed since loading"}`}>
    <Tag minimal round icon={unchanged ? "tick" : "edit"} intent={unchanged ? "success" : "warning"}>
      {unchanged ? "From previous run" : "Modified"}
    </Tag>
  </Tooltip>;
}

export function HistoryOutputCue({ field }) {
  const { state } = useAppContext();
  const history = state.historyRun;
  const enabled = value => Array.isArray(value) ? value.length > 0 : value === true;
  if (!history || !enabled(history.sourceOptions[field])) return null;
  const off = !enabled(state.formData[field]);
  return <Tooltip content={`Run ${history.id} had this option on.${off ? " It is currently off." : ""}`}>
    <Tag minimal round intent={off ? "warning" : "primary"}>{off ? "Suggested (off)" : "Suggested"}</Tag>
  </Tooltip>;
}

export function HistoryDestructiveWarning({ field, label }) {
  const { state } = useAppContext();
  const history = state.historyRun;
  if (!history?.sourceOptions[field] || state.formData[field]) return null;
  return <Callout intent="warning" compact className="mt-2">
    {label} was enabled in the previous run. It was left off for review; enable it explicitly if needed.
  </Callout>;
}
