import React from "react";
import { render, screen } from "@testing-library/react";

import { WorkflowSubmitToast } from "./AppContext";


const props = {
  workflowName: "cisegmentation",
  params: { IDs: [1], Data_Type: "Image" },
  metadata: { inputs: [] },
};


test("warns inline workflows to keep the OMERO session active", () => {
  render(<WorkflowSubmitToast {...props} executionMode="inline" />);

  expect(screen.getByText(/Do not log out or close this browser tab/)).toBeInTheDocument();
  expect(screen.queryByText(/runs in the background/)).not.toBeInTheDocument();
});


test("allows the browser tab to close for detached workflows", () => {
  render(<WorkflowSubmitToast {...props} executionMode="detached" />);

  expect(screen.getByText(/runs in the background/)).toBeInTheDocument();
  expect(screen.getByText(/You may close this tab or browser window/)).toBeInTheDocument();
  expect(screen.queryByText(/You may .*log out/)).not.toBeInTheDocument();
  expect(screen.queryByText(/Do not log out/)).not.toBeInTheDocument();
});

test("submission names the source only when parameters and version are unchanged", () => {
  const params = { IDs: [1], Data_Type: "Image", version: "v1", diameter: 12 };
  const metadata = { inputs: [{ id: "diameter" }] };
  const historyRun = { id: "old-uuid", values: { version: "v1", diameter: 12 } };
  const view = render(<WorkflowSubmitToast {...props} params={params} metadata={metadata} historyRun={historyRun} />);
  expect(screen.getByText("Parameters (2) — unchanged from old-uuid")).toBeInTheDocument();
  view.rerender(<WorkflowSubmitToast {...props} params={{ ...params, diameter: 13 }} metadata={metadata} historyRun={historyRun} />);
  expect(screen.queryByText(/unchanged from old-uuid/)).not.toBeInTheDocument();
});
