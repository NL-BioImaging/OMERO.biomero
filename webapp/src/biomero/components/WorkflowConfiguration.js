import React, { useEffect, useState } from "react";
import { Callout, Tab, Tabs } from "@blueprintjs/core";
import { useAppContext } from "../../AppContext";
import PreviousRuns from "./PreviousRuns";
import WorkflowForm from "./WorkflowForm";
import { prepareHistoryRun, historyContext } from "../runHistory";
import { HistoryWarnings, WorkflowStepIntro } from "./HistoryFeedback";

export default function WorkflowConfiguration({ onNavigationBlockedChange }) {
  const { state, updateState } = useAppContext();
  const [tab, setTab] = useState("parameters");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    onNavigationBlockedChange?.(tab === "previous-runs");
  }, [tab, onNavigationBlockedChange]);
  useEffect(() => () => onNavigationBlockedChange?.(false), [onNavigationBlockedChange]);
  const workflow = state.selectedWorkflow;
  const selection = { IDs: state.formData.IDs, Data_Type: state.formData.Data_Type };
  const apply = detail => {
    if (detail.workflow_name !== workflow.name) {
      throw new Error("Choose a previous run of this workflow.");
    }
    const { form, warnings } = prepareHistoryRun(detail, workflow,
      state.workflowVersions?.[workflow.name], selection);
    const parameters = Object.fromEntries(Object.entries(form).filter(([key]) =>
      key === "version" || workflow.metadata.inputs.some(input => input.id === key)));
    updateState({ formData: { ...state.formData, ...parameters },
      historyRun: historyContext(detail, parameters, warnings, "reuse") });
    setRevision(value => value + 1);
    setTab("parameters");
  };
  return <>
    <HistoryWarnings />
    <Tabs id="workflow-configuration" large selectedTabId={tab} onChange={setTab} renderActiveTabPanelOnly>
      <Tab id="parameters" title="Parameters" panel={<WorkflowForm key={revision} />} />
      <Tab id="previous-runs" title="Reuse previous settings" panel={<>
        <Callout compact icon="info-sign" className="mb-3">
          Select a run and use its settings before continuing. To keep your current settings, return to Parameters.
        </Callout>
        {state.historyRun && <WorkflowStepIntro step="the source run and settings" />}
        <PreviousRuns embedded isOpen={tab === "previous-runs"} workflowName={workflow.name}
          selection={selection} onApply={apply} />
      </>} />
    </Tabs>
  </>;
}
