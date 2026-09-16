import React, { useState } from "react";
import { Callout, Tab, Tabs } from "@blueprintjs/core";
import { useAppContext } from "../../AppContext";
import PreviousRuns from "./PreviousRuns";
import WorkflowForm from "./WorkflowForm";
import { prepareHistoryRun } from "../runHistory";

export default function WorkflowConfiguration() {
  const { state, updateState } = useAppContext();
  const [tab, setTab] = useState("parameters");
  const [revision, setRevision] = useState(0);
  const [review, setReview] = useState(null);
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
    updateState({ formData: { ...state.formData, ...parameters } });
    setReview({ id: detail.workflow_id, warnings });
    setRevision(value => value + 1);
    setTab("parameters");
  };
  return <>
    {review && <Callout intent="primary" className="mb-3">
      Parameters loaded from {review.id}. Input data, batching and output options are unchanged. Review before running.
      {review.warnings.map(warning => <p key={warning}>{warning}</p>)}
    </Callout>}
    <Tabs id="workflow-configuration" large selectedTabId={tab} onChange={setTab} renderActiveTabPanelOnly>
      <Tab id="parameters" title="Parameters" panel={<WorkflowForm key={revision} />} />
      <Tab id="previous-runs" title="Previous runs" panel={
        <PreviousRuns embedded isOpen={tab === "previous-runs"} workflowName={workflow.name}
          selection={selection} onApply={apply} />
      } />
    </Tabs>
  </>;
}
