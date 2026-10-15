import { fetchAnalysisLaunchContext, uploadAnalysisAttachment } from "./analysisApi";
import { refreshDashboard } from "./apiService";

beforeEach(() => { global.fetch = jest.fn(); window.csrftoken = "shared-csrf"; });
afterEach(() => { delete global.fetch; delete window.csrftoken; });
const response = (data, ok = true) => ({ ok, json: async () => data });

test("Analysis uses shared CSRF, cancellation and native multipart headers", async () => {
  fetch.mockResolvedValueOnce(response({ context_token: "context" }))
    .mockResolvedValueOnce(response({ attachment: { annotation_id: 42 } }));
  const controller = new AbortController();
  await expect(uploadAnalysisAttachment("/omero_analysis/", { type: "Image", id: 1 },
    new File(["x"], "test.csv"), { signal: controller.signal })).resolves.toEqual({ annotation_id: 42 });
  const token = fetch.mock.calls[0][1];
  const upload = fetch.mock.calls[1][1];
  expect(token.headers["X-CSRFToken"]).toBe("shared-csrf");
  expect(token.headers["Content-Type"]).toBe("application/json");
  expect(upload.headers["X-CSRFToken"]).toBe("shared-csrf");
  expect(upload.headers["X-OMERO-Analysis-Context"]).toBe("context");
  expect(upload.headers["Content-Type"]).toBeUndefined();
  expect(upload.body).toBeInstanceOf(FormData);
  expect(upload.signal).toBe(controller.signal);
});

test("launch errors and non-JSON login pages cannot appear as a successful context", async () => {
  fetch.mockResolvedValueOnce(response({ error: { message: "Access denied" } }, false));
  await expect(fetchAnalysisLaunchContext("/omero_analysis/", { type: "Image", id: 1 })).rejects.toThrow("Access denied");
  fetch.mockResolvedValueOnce({ ok: true, json: async () => { throw new SyntaxError(); } });
  await expect(fetchAnalysisLaunchContext("/omero_analysis/", { type: "Image", id: 1 })).rejects.toThrow(/could not be loaded/);
});

test("importer-backed uploads return a staged input instead of an annotation", async () => {
  const staged = { staging_id: "12345678-1234-1234-1234-123456789012", name: "test.csv" };
  fetch.mockResolvedValueOnce(response({ context_token: "context" }))
    .mockResolvedValueOnce(response({ mode: "staged", staged_attachment: staged }));
  await expect(uploadAnalysisAttachment("/omero_analysis/", { type: "Image", id: 1 },
    new File(["x"], "test.csv"))).resolves.toEqual(staged);
});

test("monitor transport preserves no-store, redirect rejection and same-origin credentials", async () => {
  fetch.mockResolvedValue(response({ url: "https://monitor.example/embed/token" }));
  await refreshDashboard("/dashboard/workflows/");
  expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/dashboard/workflows/"), expect.objectContaining({
    credentials: "same-origin", cache: "no-store", redirect: "error",
  }));
  await expect(refreshDashboard("https://other.example/dashboard/")).rejects.toThrow(/same-origin/);
  expect(fetch).toHaveBeenCalledTimes(1);
});
