import { useEffect, useState } from "react";
import { refreshDashboard } from "../apiService";

export const DASHBOARD_REFRESH_MS = 20 * 60 * 1000;

export default function useDashboard(initialUrl, endpoint, active) {
  const [iframeUrl, setIframeUrl] = useState(initialUrl);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!active || !endpoint) return undefined;
    const controller = new AbortController();
    let timer;
    let refreshing = false;
    const visible = () => document.visibilityState !== "hidden";
    const refresh = async () => {
      if (refreshing || !visible() || controller.signal.aborted) return;
      refreshing = true;
      clearTimeout(timer);
      try {
        const data = await refreshDashboard(endpoint, controller.signal);
        if (!controller.signal.aborted) {
          setIframeUrl(data.url + (initialUrl.includes("#") ? "#" + initialUrl.split("#")[1] : ""));
          setError("");
        }
      } catch (_) {
        if (!controller.signal.aborted) setError("Could not refresh the monitor. Check your connection and OMERO login, then retry.");
      } finally {
        refreshing = false;
        if (!controller.signal.aborted && visible()) timer = setTimeout(refresh, DASHBOARD_REFRESH_MS);
      }
    };
    const onVisibility = () => {
      clearTimeout(timer);
      if (visible()) void refresh();
    };
    void refresh();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      controller.abort();
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [active, endpoint, initialUrl, attempt]);
  return { iframeUrl, error, retry: () => setAttempt(value => value + 1) };
}
