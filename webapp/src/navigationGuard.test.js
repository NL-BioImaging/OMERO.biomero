import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AppRouter } from "./index";

jest.mock("./AppContext", () => ({ AppProvider: ({ children }) => <>{children}</> }));
jest.mock("./importer/ImporterApp", () => () => <div>Importer test screen</div>);
jest.mock("./biomero/BiomeroApp", () => () => <div>Analyzer test screen</div>);
jest.mock("./data-analysis/DataAnalysisApp", () => ({ onDirtyChange }) =>
  <button onClick={() => onDirtyChange(true)}>Unsaved editor test</button>);

beforeEach(() => {
  window.WEBCLIENT = { UI: { IMPORTER_ENABLED: true, ANALYZER_ENABLED: true, DATA_ANALYSIS_ENABLED: true } };
});

test.each([["Import", "Importer test screen"], ["Analyze", "Analyzer test screen"]])(
  "protects dirty Analysis from the %s navigation button", (button, destination) => {
    render(<MemoryRouter initialEntries={["/?tab=data-analysis"]}><AppRouter /></MemoryRouter>);
    fireEvent.click(screen.getByText("Unsaved editor test"));
    fireEvent.click(screen.getByRole("button", { name: button, exact: true }));
    expect(screen.getByText(/Discard them and continue/)).toBeInTheDocument();
    expect(screen.queryByText(destination)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(screen.getByText("Unsaved editor test")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: button, exact: true }));
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(screen.getByText(destination)).toBeInTheDocument();
  }
);
