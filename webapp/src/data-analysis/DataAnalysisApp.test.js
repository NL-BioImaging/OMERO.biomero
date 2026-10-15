import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import DataAnalysisApp from "./DataAnalysisApp";
import { ANALYSIS_MESSAGE_SCHEMA } from "../analysisIntegration";

const mockUpdateState = jest.fn();
jest.mock("../AppContext", () => ({ useAppContext: () => ({
  state: { ui: { data_analysis_available: true }, urls: { data_analysis: "/omero_analysis/" } },
  updateState: mockUpdateState, loadOmeroTreeData: jest.fn(),
}) }));
jest.mock("../shared/components/OmeroDataBrowser", () => () => <div>Source browser</div>);
jest.mock("./AnalysisLaunchOptions", () => () => <div>Launch options</div>);

beforeEach(() => { window.history.replaceState(null, "", "/?analysis_type=Image&analysis_id=1"); });
afterEach(() => { window.history.replaceState(null, "", "/"); });
const dirtyMessage = (iframe, origin = window.location.origin) => fireEvent(window, new MessageEvent("message", {
  origin, source: iframe.contentWindow,
  data: { schema: ANALYSIS_MESSAGE_SCHEMA, source: "omero-analysis", type: "dirty-state-changed", payload: { dirty: true } },
}));

test.each(["Change source", "Reload"])("%s asks before discarding and cancellation preserves the iframe", async action => {
  const onDirtyChange = jest.fn();
  render(<DataAnalysisApp onDirtyChange={onDirtyChange} />);
  const iframe = screen.getByTitle("OMERO Data Analysis");
  dirtyMessage(iframe);
  expect(onDirtyChange).toHaveBeenLastCalledWith(true);
  fireEvent.click(screen.getByRole("button", { name: action, exact: true }));
  expect(screen.getByText(/Discard them and continue/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  expect(screen.getByTitle("OMERO Data Analysis")).toBe(iframe);
  fireEvent.click(screen.getByRole("button", { name: action, exact: true }));
  fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
  await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false));
  expect(iframe.isConnected).toBe(false);
});

test("untrusted frame messages do not mark the editor dirty", () => {
  render(<DataAnalysisApp />);
  dirtyMessage(screen.getByTitle("OMERO Data Analysis"), "https://other.example");
  fireEvent.click(screen.getByRole("button", { name: "Change source" }));
  expect(screen.queryByText(/Discard them and continue/)).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Choose data for Analysis" })).toBeInTheDocument();
});
