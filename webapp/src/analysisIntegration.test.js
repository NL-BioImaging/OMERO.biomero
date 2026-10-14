import {
  ANALYSIS_MESSAGE_SCHEMA,
  buildAnalysisUrl,
  isAnalysisMessage,
  launchContextUrl,
  parseAnalysisLaunch,
  postAnalysisTheme,
  sourceFromLaunchContext,
  sourceFromWorkspaceDataset,
  sourceFromTreeItems,
  workspaceDatasetResolutionUrl,
} from "./analysisIntegration";

test("workspace identity and new-workspace launches survive the BIOMERO frame", () => {
  const source = parseAnalysisLaunch("?analysis_type=Screen&analysis_id=152&analysis_workspace_id=workspace-2");
  expect(source.workspaceId).toBe("workspace-2");
  const resume = new URL(buildAnalysisUrl("/omero_analysis/", {
    ...source, workspaceAnnotationId: 901,
  }));
  expect(resume.searchParams.get("workspace_id")).toBe("workspace-2");
  expect(resume.searchParams.has("workspace_annotation")).toBe(false);
  const fresh = new URL(buildAnalysisUrl("/omero_analysis/", {
    type: "Screen", id: 152, newWorkspace: "new-3", workspaceAnnotationId: 901,
  }));
  expect(fresh.searchParams.get("new_workspace")).toBe("new-3");
  expect(fresh.searchParams.has("workspace_annotation")).toBe(false);
});

test("explicit Analysis parameters are parsed through the supported whitelist", () => {
  const source = parseAnalysisLaunch(
    "?tab=data-analysis&analysis_type=Plate&analysis_id=12" +
      "&analysis_selection_id=12&analysis_selection_id=13" +
      "&analysis_workspace_annotation=99&ignored=https://evil.example"
  );
  expect(source).toMatchObject({
    type: "Plate",
    id: 12,
    selectionIds: [12, 13],
    workspaceAnnotationId: 99,
  });
  const url = new URL(buildAnalysisUrl("/omero_analysis/", source));
  expect(url.origin).toBe(window.location.origin);
  expect(url.searchParams.get("embedded")).toBe("biomero");
  expect(url.searchParams.getAll("selection_id")).toEqual(["12", "13"]);
  expect(url.searchParams.has("ignored")).toBe(false);
});

test("invalid and mixed source selections are rejected", () => {
  expect(parseAnalysisLaunch("?analysis_type=Project&analysis_id=4")).toBeNull();
  expect(
    sourceFromTreeItems([
      { category: "plates", id: 1, data: "P1" },
      { category: "images", id: 2, data: "I2" },
    ]).error
  ).toMatch(/same type/);
});

test("data query bindings are strictly parsed and preserved", () => {
  const source = parseAnalysisLaunch(
    "?type=Image&id=5&data_annotation=11&data_annotation=12" +
      "&data_binding=11:remote&data_binding=12:local"
  );
  expect(source.dataBindings).toEqual({ 11: "remote", 12: "local" });
  const url = new URL(buildAnalysisUrl("/omero_analysis/", {
    ...source,
    attachmentPolicies: {
      11: { allowed_modes: ["remote"] },
      12: { allowed_modes: ["local", "remote"] },
    },
  }));
  expect(url.searchParams.getAll("data_binding")).toEqual([
    "11:remote",
    "12:local",
  ]);
});

test("malformed, duplicate, unselected, and forbidden bindings are rejected", () => {
  expect(parseAnalysisLaunch("?type=Image&id=5&data_annotation=11&data_binding=bad")).toBeNull();
  expect(parseAnalysisLaunch(
    "?type=Image&id=5&data_annotation=11&data_binding=11:local&data_binding=11:remote"
  )).toBeNull();
  expect(parseAnalysisLaunch(
    "?type=Image&id=5&data_annotation=11&data_binding=12:remote"
  )).toBeNull();
  expect(buildAnalysisUrl("/omero_analysis/", {
    type: "Image",
    id: 5,
    dataAnnotationIds: [11],
    dataBindings: { 11: "local" },
    attachmentPolicies: { 11: { allowed_modes: ["remote"] } },
  })).toBe("");
});

test("same-type image selection becomes one Analysis source", () => {
  const result = sourceFromTreeItems([
    { category: "images", id: 5, data: "I5" },
    { category: "images", id: 6, data: "I6" },
  ]);
  expect(result.error).toBe("");
  expect(result.source).toMatchObject({
    type: "Image",
    id: 5,
    selectionIds: [5, 6],
  });
});

test("iframe messages require the same origin, source window, and schema", () => {
  const iframeWindow = {};
  const message = {
    origin: window.location.origin,
    source: iframeWindow,
    data: {
      schema: ANALYSIS_MESSAGE_SCHEMA,
      source: "omero-analysis",
      type: "ready",
      payload: {},
    },
  };
  expect(isAnalysisMessage(message, iframeWindow)).toBe(true);
  expect(isAnalysisMessage({ ...message, origin: "https://evil.example" }, iframeWindow)).toBe(false);
  expect(
    isAnalysisMessage(
      { ...message, data: { ...message.data, type: "arbitrary-command" } },
      iframeWindow
    )
  ).toBe(false);
});

test("managed Dataset resolution stays on the Analysis base URL", () => {
  expect(workspaceDatasetResolutionUrl("/omero_analysis/", 303)).toBe(
    "http://localhost/omero_analysis/api/workspace-dataset/303/"
  );
  expect(workspaceDatasetResolutionUrl("https://evil.example/", 0)).toBe("");
  expect(workspaceDatasetResolutionUrl("https://evil.example/", 303)).toBe("");
});

test("managed Dataset metadata becomes a saved Workspace launch", () => {
  const result = sourceFromWorkspaceDataset({
    managed: true,
    resumable: true,
    datasetName: "Screen-152 — SolHunt",
    workspaceName: "SolHunt analysis",
    sourceObjectType: "Screen",
    sourceObjectId: 152,
    sourceObjectName: "SolHunt",
    workspaceAnnotationId: 901,
  });

  expect(result.source).toMatchObject({
    type: "Screen",
    id: 152,
    title: "SolHunt",
    resumeWorkspaceName: "SolHunt analysis",
    workspaceAnnotationId: 901,
  });
});

test("managed Dataset metadata provides guidance when it cannot resume", () => {
  const result = sourceFromWorkspaceDataset({
    managed: true,
    resumable: false,
    error: "The original source is unavailable.",
  });

  expect(result.source).toBeNull();
  expect(result.error).toBe("The original source is unavailable.");
});

test("managed workspace launch matches the middle pane without requiring a snapshot", () => {
  const result = sourceFromLaunchContext({
    panel_kind: "workspace",
    workspace_summary: {
      can_resume: true,
      workspace_name: "SolHunt analysis",
      source_type: "Screen",
      source_id: 152,
      source_name: "SolHunt",
    },
  }, { type: "Dataset", id: 303, title: "Managed Dataset" });

  expect(result.source).toMatchObject({
    type: "Screen",
    id: 152,
    workspaceAnnotationId: null,
    resumeWorkspaceName: "SolHunt analysis",
  });
});

test("launch context preserves a same-type multi-selection", () => {
  const url = new URL(launchContextUrl("/omero_analysis/", {
    type: "Image",
    id: 5,
    selectionIds: [5, 6],
  }));
  expect(url.pathname).toBe("/omero_analysis/api/launch-context/Image/5/");
  expect(url.searchParams.getAll("selection_id")).toEqual(["5", "6"]);
});

test("BIOMERO sends only whitelisted light and dark theme messages", () => {
  const iframeWindow = { postMessage: jest.fn() };
  expect(postAnalysisTheme(iframeWindow, "dark")).toBe(true);
  expect(iframeWindow.postMessage).toHaveBeenCalledWith(
    expect.objectContaining({ source: "omero-biomero", type: "theme-changed", payload: { theme: "dark" } }),
    window.location.origin
  );
  expect(postAnalysisTheme(iframeWindow, "sepia")).toBe(false);
});
