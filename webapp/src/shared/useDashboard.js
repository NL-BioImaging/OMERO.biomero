import { useEffect, useState } from "react";

// Renew before Metabase's 30-minute token expires; never reload the OMERO page.
export const DASHBOARD_REFRESH_MS = 20 * 60 * 1000;

export default function useDashboard(initialUrl, endpoint, active) {
  const [iframeUrl, setIframeUrl] = useState(initialUrl);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!active || !endpoint) return undefined;
    const controller = new AbortController();
    let refreshing = false;
    let lastRefresh = 0;
    const refresh = async () => {
      if (refreshing) return;
      refreshing = true;
      try {
        const response = await fetch(endpoint, {
          credentials: "same-origin", cache: "no-store", redirect: "error",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Monitor unavailable");
        const data = await response.json();
        if (typeof data.url !== "string" || !data.url) throw new Error("Invalid monitor response");
        if (!controller.signal.aborted) {
          setIframeUrl(data.url + (initialUrl.includes("#") ? "#" + initialUrl.split("#")[1] : ""));
          setError("");
          lastRefresh = Date.now();
        }
      } catch (_) {
        if (!controller.signal.aborted) setError("Could not refresh the monitor. Check your connection and OMERO login, then retry.");
      } finally {
        refreshing = false;
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible" && Date.now() - lastRefresh >= DASHBOARD_REFRESH_MS) refresh();
    };
    refresh();
    const timer = setInterval(refresh, DASHBOARD_REFRESH_MS);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      controller.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [active, endpoint, initialUrl, attempt]);
  return { iframeUrl, error, retry: () => setAttempt(value => value + 1) };
}
