import React from "react";
import { act, render, screen, fireEvent } from "@testing-library/react";
import useDashboard, { DASHBOARD_REFRESH_MS } from "./useDashboard";

function Monitor({ active = true }) {
  const { iframeUrl, error, retry } = useDashboard("https://mb/embed/dashboard/old#refresh=20", "/dashboard/workflows/", active);
  return <><span>{iframeUrl}</span><span>{error}</span><button onClick={retry}>Retry</button></>;
}
const success = url => ({ ok: true, json: async () => ({ url }) });
const settle = async () => { await act(async () => { await Promise.resolve(); }); };

beforeEach(() => { jest.useFakeTimers(); global.fetch = jest.fn(); });
afterEach(() => { jest.useRealTimers(); delete global.fetch; });

test("renews on opening and before expiry without reloading the OMERO page", async () => {
  fetch.mockResolvedValueOnce(success("https://mb/embed/dashboard/first"))
    .mockResolvedValueOnce(success("https://mb/embed/dashboard/second"));
  render(<Monitor />);
  await settle();
  expect(screen.getByText("https://mb/embed/dashboard/first#refresh=20")).toBeInTheDocument();
  await act(async () => { jest.advanceTimersByTime(DASHBOARD_REFRESH_MS); });
  expect(screen.getByText("https://mb/embed/dashboard/second#refresh=20")).toBeInTheDocument();
  expect(fetch).toHaveBeenCalledWith("/dashboard/workflows/", expect.objectContaining({ credentials: "same-origin", cache: "no-store", redirect: "error" }));
});

test("session/network failure is recoverable and retains the current monitor", async () => {
  fetch.mockRejectedValueOnce(new Error("logged out")).mockResolvedValueOnce(success("https://mb/embed/dashboard/recovered"));
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
  fetch.mockImplementation(() => new Promise(() => {}));
  const view = render(<Monitor active={false} />);
  expect(fetch).not.toHaveBeenCalled();
  view.rerender(<Monitor />);
  const signal = fetch.mock.calls[0][1].signal;
  view.unmount();
  expect(signal.aborted).toBe(true);
  act(() => { jest.advanceTimersByTime(DASHBOARD_REFRESH_MS); });
  expect(fetch).toHaveBeenCalledTimes(1);
});

test("returning from a suspended browser renews an overdue token", async () => {
  fetch.mockResolvedValue(success("https://mb/embed/dashboard/new"));
  render(<Monitor />);
  await settle();
  jest.setSystemTime(Date.now() + DASHBOARD_REFRESH_MS + 1);
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  fireEvent(document, new Event("visibilitychange"));
  await settle();
  expect(fetch).toHaveBeenCalledTimes(2);
});
