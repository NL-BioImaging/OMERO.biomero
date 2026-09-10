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
