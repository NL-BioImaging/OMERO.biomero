import React from "react";
import { act, render, screen, fireEvent } from "@testing-library/react";
import useDashboard, { DASHBOARD_REFRESH_MS } from "./useDashboard";
import { refreshDashboard } from "../apiService";
jest.mock("../apiService", () => ({ refreshDashboard: jest.fn() }));

function Monitor({ active = true }) {
  const { iframeUrl, error, retry } = useDashboard("https://mb/embed/dashboard/old#refresh=20", "/dashboard/workflows/", active);
  return <><span>{iframeUrl}</span><span>{error}</span><button onClick={retry}>Retry</button></>;
}
const success = url => ({ url });
const settle = async () => { await act(async () => { await Promise.resolve(); }); };

beforeEach(() => { jest.useFakeTimers(); refreshDashboard.mockReset(); Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" }); });
afterEach(() => { jest.useRealTimers(); });

test("renews on opening and before expiry without reloading the OMERO page", async () => {
  refreshDashboard.mockResolvedValueOnce(success("https://mb/embed/dashboard/first"))
    .mockResolvedValueOnce(success("https://mb/embed/dashboard/second"));
  render(<Monitor />);
  await settle();
  expect(screen.getByText("https://mb/embed/dashboard/first#refresh=20")).toBeInTheDocument();
  await act(async () => { jest.advanceTimersByTime(DASHBOARD_REFRESH_MS); });
  expect(screen.getByText("https://mb/embed/dashboard/second#refresh=20")).toBeInTheDocument();
  expect(refreshDashboard).toHaveBeenCalledWith("/dashboard/workflows/", expect.any(AbortSignal));
});

test("session/network failure is recoverable and retains the current monitor", async () => {
  refreshDashboard.mockRejectedValueOnce(new Error("logged out")).mockResolvedValueOnce(success("https://mb/embed/dashboard/recovered"));
  render(<Monitor />);
  await settle();
  expect(screen.getByText(/Check your connection and OMERO login/)).toBeInTheDocument();
  expect(screen.getByText("https://mb/embed/dashboard/old#refresh=20")).toBeInTheDocument();
  fireEvent.click(screen.getByText("Retry"));
  await settle();
  expect(screen.queryByText(/Check your connection/)).not.toBeInTheDocument();
  expect(screen.getByText("https://mb/embed/dashboard/recovered#refresh=20")).toBeInTheDocument();
});

test("hidden panels do not renew and unmount aborts pending requests", async () => {
  refreshDashboard.mockImplementation(() => new Promise(() => {}));
  const view = render(<Monitor active={false} />);
  expect(refreshDashboard).not.toHaveBeenCalled();
  view.rerender(<Monitor />);
  const signal = refreshDashboard.mock.calls[0][1];
  view.unmount();
  expect(signal.aborted).toBe(true);
  act(() => { jest.advanceTimersByTime(DASHBOARD_REFRESH_MS); });
  expect(refreshDashboard).toHaveBeenCalledTimes(1);
});

test("returning from a suspended browser renews an overdue token", async () => {
  refreshDashboard.mockResolvedValue(success("https://mb/embed/dashboard/new"));
  render(<Monitor />);
  await settle();
  jest.setSystemTime(Date.now() + DASHBOARD_REFRESH_MS + 1);
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  fireEvent(document, new Event("visibilitychange"));
  await settle();
  expect(refreshDashboard).toHaveBeenCalledTimes(2);
});

test("hidden documents pause polling and return triggers one refresh", async () => {
  refreshDashboard.mockResolvedValue(success("https://mb/embed/current"));
  render(<Monitor />);
  await settle();
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
  fireEvent(document, new Event("visibilitychange"));
  await act(async () => { jest.advanceTimersByTime(DASHBOARD_REFRESH_MS * 3); });
  expect(refreshDashboard).toHaveBeenCalledTimes(1);
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  fireEvent(document, new Event("visibilitychange"));
  await settle();
  expect(refreshDashboard).toHaveBeenCalledTimes(2);
});

test("slow requests never overlap and timers start after completion", async () => {
  let resolve;
  refreshDashboard.mockReturnValue(new Promise(r => { resolve = r; }));
  render(<Monitor />);
  await act(async () => { jest.advanceTimersByTime(DASHBOARD_REFRESH_MS * 3); });
  fireEvent(document, new Event("visibilitychange"));
  expect(refreshDashboard).toHaveBeenCalledTimes(1);
  await act(async () => { resolve(success("https://mb/embed/current")); });
  await act(async () => { jest.advanceTimersByTime(DASHBOARD_REFRESH_MS); });
  expect(refreshDashboard).toHaveBeenCalledTimes(2);
});
