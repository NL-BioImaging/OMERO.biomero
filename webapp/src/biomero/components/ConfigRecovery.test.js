import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ConfigRecovery from "./ConfigRecovery";
import { fetchConfigHistory, restoreConfigSnapshot } from "../../apiService";

jest.mock("../../apiService", () => ({
  fetchConfigHistory: jest.fn(), restoreConfigSnapshot: jest.fn(),
}));
jest.mock("@blueprintjs/core", () => ({
  Button: ({ children, minimal, icon, intent, ...props }) => <button {...props}>{children}</button>,
  H5: ({ children }) => <h3>{children}</h3>,
}));

beforeEach(() => jest.clearAllMocks());

test("recovery loads without parsed configuration or workflow discovery", async () => {
  fetchConfigHistory.mockResolvedValue({ revision: "revision-1", snapshots: [] });
  render(<ConfigRecovery />);
  fireEvent.click(screen.getByRole("button", { name: "Configuration recovery" }));
  expect(await screen.findByText(/No snapshots yet/)).toBeInTheDocument();
  expect(fetchConfigHistory).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "Restore snapshot" })).toBeDisabled();
});

test("a concurrent edit blocks restore and leaves the panel available", async () => {
  fetchConfigHistory.mockResolvedValue({ revision: "revision-1", snapshots: [{
    id: "snapshot-1", timestamp: "2026-10-14T12:00:00Z", editor: { username: "admin" },
  }] });
  restoreConfigSnapshot.mockRejectedValue({ response: { data: { error: "Configuration changed. Refresh recovery before restoring." } } });
  jest.spyOn(window, "confirm").mockReturnValue(true);
  render(<ConfigRecovery />);
  fireEvent.click(screen.getByRole("button", { name: "Configuration recovery" }));
  fireEvent.change(await screen.findByLabelText("Previous configuration"), { target: { value: "snapshot-1" } });
  fireEvent.click(screen.getByRole("button", { name: "Restore snapshot" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Configuration changed");
  expect(restoreConfigSnapshot).toHaveBeenCalledWith("snapshot-1", "revision-1");
  await waitFor(() => expect(screen.getByRole("button", { name: "Refresh history" })).not.toBeDisabled());
  window.confirm.mockRestore();
});

test("recovery reports errors without losing the download control", async () => {
  fetchConfigHistory.mockRejectedValue(new Error("offline"));
  render(<ConfigRecovery />);
  fireEvent.click(screen.getByRole("button", { name: "Configuration recovery" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Configuration recovery failed");
  expect(screen.getByRole("button", { name: "Download current files" })).toBeInTheDocument();
});
