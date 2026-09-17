import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { useAppContext } from "../../AppContext";
import { HistoryDialogTitle, WorkflowStepIntro, HistoryFieldCue, HistoryOutputCue, HistoryWarnings, HistoryDestructiveWarning } from "./HistoryFeedback";

jest.mock("../../AppContext", () => ({ useAppContext: jest.fn() }));
let state;
beforeEach(() => {
  state = { formData: { diameter: 12, uploadCsv: false, clearExistingRois: false }, historyRun: {
    id: "old-uuid", mode: "rerun", values: { diameter: 12 },
    sourceOptions: { uploadCsv: true, clearExistingRois: true }, warnings: ["Removed parameter: old"] } };
  useAppContext.mockImplementation(() => ({ state }));
});

test("dialog title identifies source; field cue changes after editing", () => {
  const view = render(<><HistoryDialogTitle title="Plate Workflow: segment" /><HistoryFieldCue field="diameter" /></>);
  expect(screen.getByText("Rerun: Plate Workflow: segment")).toBeInTheDocument();
  expect(screen.queryByText("old-uuid")).not.toBeInTheDocument();
  expect(view.container.querySelector(".bp5-callout")).toBeNull();
  expect(screen.getByText("From previous run")).toBeInTheDocument();
  state.formData.diameter = 15;
  view.rerender(<HistoryFieldCue field="diameter" />);
  expect(screen.getByText("Modified")).toBeInTheDocument();
  expect(screen.queryByText("From previous run")).not.toBeInTheDocument();
});

test("step banner replaces normal guidance in the existing body location", () => {
  const view = render(<WorkflowStepIntro step="the selected input plates">Normal plate guidance</WorkflowStepIntro>);
  expect(screen.getByText("old-uuid")).toBeInTheDocument();
  expect(screen.queryByText("Normal plate guidance")).not.toBeInTheDocument();
  expect(view.container.querySelectorAll(".bp5-callout")).toHaveLength(1);
  state.historyRun = null;
  view.rerender(<WorkflowStepIntro>Normal plate guidance</WorkflowStepIntro>);
  expect(screen.getByText("Normal plate guidance")).toBeInTheDocument();
  expect(screen.queryByText("old-uuid")).not.toBeInTheDocument();
});

test("warnings and disabled source suggestions are orange, not informational", () => {
  render(<><HistoryWarnings /><HistoryOutputCue field="uploadCsv" /></>);
  expect(screen.getByText("Removed parameter: old").closest(".bp5-callout")).toHaveClass("bp5-intent-warning");
  expect(screen.getByText("Suggested (off)").closest(".bp5-tag")).toHaveClass("bp5-intent-warning");
});

test("destructive warning appears only for an originally enabled option that is still off", () => {
  const view = render(<HistoryDestructiveWarning field="clearExistingRois" label="ROI clearing" />);
  expect(screen.getByText(/was enabled in run/)).toBeInTheDocument();
  state.formData.clearExistingRois = true;
  view.rerender(<HistoryDestructiveWarning field="clearExistingRois" label="ROI clearing" />);
  expect(screen.queryByText(/was enabled in run/)).not.toBeInTheDocument();
  state.formData.clearExistingRois = false;
  state.historyRun.sourceOptions.clearExistingRois = false;
  view.rerender(<HistoryDestructiveWarning field="clearExistingRois" label="ROI clearing" />);
  expect(screen.queryByText(/was enabled in run/)).not.toBeInTheDocument();
});
