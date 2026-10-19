import { requestJson } from "./apiService";
import { ANALYSIS_API_PATHS } from "./constants";
import {
  analysisObjectUrl, launchContextUrl, sameOriginAnalysisBase,
  workspaceDatasetResolutionUrl,
} from "./analysisIntegration";

export const fetchAnalysisLaunchContext = (baseUrl, source, options = {}) => {
  const url = launchContextUrl(baseUrl, source);
  if (!url) throw new Error("The selected Analysis source is invalid.");
  return requestJson(url, { signal: options.signal }, "The Analysis launch options could not be loaded.");
};

export const uploadAnalysisAttachment = async (baseUrl, source, file, options = {}) => {
  const base = sameOriginAnalysisBase(baseUrl);
  const uploadUrl = analysisObjectUrl(baseUrl, ANALYSIS_API_PATHS.attachments, source);
  if (!base || !uploadUrl || !file) throw new Error("The Analysis upload is invalid.");
  const token = await requestJson(new URL(ANALYSIS_API_PATHS.contextToken, base).toString(), {
    method: "POST", signal: options.signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ object_type: source.type, object_id: source.id }),
  }, "The Analysis upload could not be authorized.");
  if (!token.context_token) throw new Error("The Analysis upload could not be authorized.");
  const form = new FormData();
  form.append("file", file, file.name);
  const payload = await requestJson(`${uploadUrl}upload/`, {
    method: "POST", signal: options.signal,
    headers: { "X-OMERO-Analysis-Context": token.context_token }, body: form,
  }, "The attachment upload failed.");
  if (payload.mode === "staged" && payload.staged_attachment?.staging_id) return payload.staged_attachment;
  if (payload.attachment?.annotation_id) return payload.attachment;
  throw new Error("The attachment upload returned no attachment.");
};

export const fetchWorkspaceDatasetResolution = (baseUrl, datasetId, options = {}) => {
  const url = workspaceDatasetResolutionUrl(baseUrl, datasetId);
  if (!url) throw new Error("The Analysis Workspace Dataset is invalid.");
  return requestJson(url, { signal: options.signal }, "The Analysis Workspace metadata could not be resolved.");
};
