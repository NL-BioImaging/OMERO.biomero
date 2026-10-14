import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  Callout,
  Card,
  Checkbox,
  Divider,
  H5,
  InputGroup,
  HTMLSelect,
  Spinner,
  Tag,
} from "@blueprintjs/core";

import {
  fetchAnalysisLaunchContext,
  sourceFromLaunchContext,
  uploadAnalysisAttachment,
} from "../analysisIntegration";

const sourceKey = (source) => source
  ? `${source.type}:${source.id}:${(source.selectionIds || []).join(",")}`
  : "";

const AnalysisLaunchOptions = ({ baseUrl, source, selectionError, onOpen }) => {
  const [launch, setLaunch] = useState({ loading: false, data: null, error: "" });
  const [attachmentIds, setAttachmentIds] = useState(new Set());
  const [bindingModes, setBindingModes] = useState({});
  const [libraryIds, setLibraryIds] = useState(new Set());
  const [libraryQuery, setLibraryQuery] = useState("");
  const [uploading, setUploading] = useState(false);
  const uploadInput = useRef(null);
  const key = sourceKey(source);

  const load = async (signal) => {
    if (!source) return;
    setLaunch({ loading: true, data: null, error: "" });
    try {
      const data = await fetchAnalysisLaunchContext(baseUrl, source, { signal });
      setLaunch({ loading: false, data, error: "" });
    } catch (error) {
      if (error.name !== "AbortError") {
        setLaunch({ loading: false, data: null, error: error.message });
      }
    }
  };

  useEffect(() => {
    setAttachmentIds(new Set());
    setBindingModes({});
    setLibraryIds(new Set());
    setLibraryQuery("");
    if (!source) {
      setLaunch({ loading: false, data: null, error: "" });
      return undefined;
    }
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
    // The stable source key and base URL fully identify the launch contract.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, baseUrl]);

  const attachments = launch.data?.supported_attachments || [];
  const resolution = sourceFromLaunchContext(launch.data, source);
  const resolvedSource = resolution.source
    ? {
        ...resolution.source,
        dataAnnotationIds: [...attachmentIds],
        dataBindings: Object.fromEntries(
          [...attachmentIds]
            .filter((id) => bindingModes[id])
            .map((id) => [id, bindingModes[id]])
        ),
        attachmentPolicies: Object.fromEntries(
          attachments.map((item) => [item.annotation_id, item])
        ),
        libraryItemIds: [...libraryIds],
        openLibrary: libraryIds.size > 0,
      }
    : null;
  const contextError = launch.error || resolution.error || selectionError;
  const panelKind = launch.data?.panel_kind;
  const library = launch.data?.analysis_library_datasets || [];
  const filteredLibrary = useMemo(() => {
    const query = libraryQuery.trim().toLowerCase();
    if (!query) return library;
    return library.map((dataset) => ({
      ...dataset,
      groups: (dataset.groups || []).map((group) => ({
        ...group,
        items: (group.items || []).filter((item) =>
          `${dataset.datasetName} ${dataset.sourceObjectName} ${item.name}`
            .toLowerCase().includes(query)
        ),
      })).filter((group) => group.items.length),
    })).filter((dataset) => dataset.groups.length);
  }, [library, libraryQuery]);

  const toggle = (setter, value) => setter((current) => {
    const next = new Set(current);
    if (next.has(value)) next.delete(value); else next.add(value);
    return next;
  });

  const toggleAttachment = (attachment) => {
    const id = attachment.annotation_id;
    setAttachmentIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
        setBindingModes((modes) => {
          const copy = { ...modes };
          delete copy[id];
          return copy;
        });
      } else {
        if (!attachment.query_format) {
          next.add(id);
          return next;
        }
        const allowed = attachment.allowed_modes || ["local"];
        const mode = allowed.includes(attachment.default_mode)
          ? attachment.default_mode : allowed[0];
        if (mode) {
          next.add(id);
          setBindingModes((modes) => ({ ...modes, [id]: mode }));
        }
      }
      return next;
    });
  };

  const upload = async (file) => {
    if (!file || !source) return;
    setUploading(true);
    try {
      const attachment = await uploadAnalysisAttachment(baseUrl, source, file);
      const data = await fetchAnalysisLaunchContext(baseUrl, source);
      setLaunch({ loading: false, data, error: "" });
      setAttachmentIds((current) => new Set([...current, attachment.annotation_id]));
    } catch (error) {
      setLaunch((current) => ({ ...current, error: error.message }));
    } finally {
      setUploading(false);
      if (uploadInput.current) uploadInput.current.value = "";
    }
  };

  if (!source) return <Callout intent="warning">{selectionError}</Callout>;
  if (launch.loading) return <Callout icon={<Spinner size={16} />}>Loading Analysis launch options…</Callout>;

  return (
    <div className="analysis-launch-options">
      {panelKind === "workspace" && launch.data?.workspace_summary && (
        <Card className="analysis-launch-section" elevation={1}>
          <div className="analysis-launch-heading">
            <H5>Resume {launch.data.workspace_summary.workspace_name}</H5>
            <Tag intent="primary">Revision {launch.data.workspace_summary.revision}</Tag>
          </div>
          <p>
            Continue with the reusable Methods, Pipelines, and Notebooks synchronized
            from {launch.data.workspace_summary.source_type} {launch.data.workspace_summary.source_id}.
          </p>
          <div className="analysis-launch-counts">
            {Object.entries(launch.data.workspace_summary.counts || {}).map(([kind, count]) => (
              <Tag key={kind} minimal>{count} {kind}{count === 1 ? "" : "s"}</Tag>
            ))}
          </div>
        </Card>
      )}

      {panelKind === "source" && (
        <Card className="analysis-launch-section" elevation={1}>
          <H5>Analysis Workspaces</H5>
          <p>Open an existing analysis or create a separate workspace. Names can be changed in Analysis.</p>
          {(launch.data?.analysis_workspaces || []).map(item => (
            <div key={item.workspaceId} className="analysis-upload-row">
              <Button onClick={() => onOpen({ ...resolvedSource, workspaceId: item.workspaceId,
                workspaceAnnotationId: null, newWorkspace: null })}>Open {item.workspaceName}</Button>
              <span>Revision {item.revision} · {item.syncStatus?.syncState || "saved"}</span>
            </div>
          ))}
          <Button icon="add" onClick={() => onOpen({ ...resolvedSource,
            workspaceId: null, workspaceAnnotationId: null, newWorkspace: crypto.randomUUID() })}>
            New workspace
          </Button>
        </Card>
      )}

      {panelKind === "source" && !(source.selectionIds || []).length && (
        <>
          <Card className="analysis-launch-section" elevation={1}>
            <div className="analysis-launch-heading">
              <H5>Select data attachments</H5>
              <Tag>{attachmentIds.size} selected</Tag>
            </div>
            <p>Choose directly attached data, or data attached to child Images or Plates.</p>
            {launch.data?.can_annotate && (
              <div className="analysis-upload-row">
                <Button icon="upload" loading={uploading} onClick={() => uploadInput.current?.click()}>
                  Upload Attachment
                </Button>
                <input ref={uploadInput} hidden type="file" onChange={(event) => void upload(event.target.files?.[0])} />
                <span>Attach a supported data or result file to this OMERO object.</span>
              </div>
            )}
            <Divider />
            <div className="analysis-option-list">
              {attachments.map((attachment) => (
                <div className="analysis-attachment-choice" key={attachment.annotation_id}>
                  <Checkbox
                    checked={attachmentIds.has(attachment.annotation_id)}
                    disabled={Array.isArray(attachment.allowed_modes) && !attachment.allowed_modes.length}
                    onChange={() => toggleAttachment(attachment)}
                    labelElement={(
                    <span className="analysis-option-label">
                      <strong>{attachment.name}</strong>
                      <small>
                        {attachment.mimetype} · {attachment.size} bytes
                        {!attachment.direct && ` · from ${attachment.object_type} ${attachment.object_id} — ${attachment.object_name}`}
                        {attachment.query_format && ` · ${attachment.query_format.toUpperCase()}`}
                      </small>
                    </span>
                    )}
                  />
                  {attachment.query_format && attachmentIds.has(attachment.annotation_id) && (
                    <HTMLSelect
                      aria-label={`Query mode for ${attachment.name}`}
                      value={bindingModes[attachment.annotation_id] || ""}
                      onChange={(event) => setBindingModes((current) => ({
                        ...current,
                        [attachment.annotation_id]: event.target.value,
                      }))}
                      options={(attachment.allowed_modes || []).map((mode) => ({
                        label: mode === "remote" ? "Remote" : "Local",
                        value: mode,
                      }))}
                    />
                  )}
                  {attachment.query_format && (
                    <small>
                      {attachment.threshold_reason === "remote-required-by-policy"
                        ? "Server policy requires remote queries."
                        : attachment.threshold_reason === "size-at-or-above-threshold"
                          ? "Remote is recommended because this source meets the size threshold."
                          : "Local is the default; remote remains available."}
                      {!attachment.worker_ready && " The remote query worker is unavailable."}
                    </small>
                  )}
                </div>
              ))}
              {!attachments.length && <p className="analysis-empty">No supported data attachments yet.</p>}
            </div>
          </Card>

          <Card className="analysis-launch-section" elevation={1}>
            <div className="analysis-launch-heading">
              <H5>Reuse from +AnalysisWorkspaces</H5>
              <Tag>{libraryIds.size} selected</Tag>
            </div>
            <p>Select synchronized Methods, Pipelines, or Notebooks to import when Analysis opens.</p>
            <InputGroup
              leftIcon="filter"
              placeholder="Filter reusable items"
              value={libraryQuery}
              onChange={(event) => setLibraryQuery(event.target.value)}
            />
            <div className="analysis-library-list">
              {filteredLibrary.map((dataset) => (
                <details key={dataset.datasetId} open={Boolean(libraryQuery)}>
                  <summary>{dataset.datasetName} <Tag minimal>{dataset.items.length}</Tag></summary>
                  {(dataset.groups || []).map((group) => (
                    <section key={group.kind}>
                      <strong>{group.label}</strong>
                      {group.items.map((item) => (
                        <Checkbox
                          key={item.annotationId}
                          checked={libraryIds.has(item.annotationId)}
                          onChange={() => toggle(setLibraryIds, item.annotationId)}
                          label={`${item.name} · ${item.kind}`}
                        />
                      ))}
                    </section>
                  ))}
                </details>
              ))}
              {!filteredLibrary.length && <p className="analysis-empty">No matching reusable items.</p>}
            </div>
          </Card>
        </>
      )}

      <Callout intent={resolvedSource ? "primary" : "warning"}>
        {resolvedSource?.resumeWorkspaceName
          ? `Resume ${resolvedSource.resumeWorkspaceName} — original source ${resolvedSource.type} ${resolvedSource.id}`
          : resolvedSource
            ? `${resolvedSource.title} — ${resolvedSource.type}`
            : contextError}
      </Callout>
      <Button
        className="analysis-open-button"
        intent="primary"
        icon={resolvedSource?.resumeWorkspaceName ? "history" : "applications"}
        disabled={!resolvedSource}
        onClick={() => resolvedSource && onOpen(resolvedSource)}
      >
        {resolvedSource?.resumeWorkspaceName
          ? `Resume ${resolvedSource.resumeWorkspaceName}`
          : attachmentIds.size
            ? `Open with ${attachmentIds.size} attachment${attachmentIds.size === 1 ? "" : "s"}`
            : libraryIds.size
              ? "Open with library selection"
              : "Open Data Analysis"}
      </Button>
    </div>
  );
};

export default AnalysisLaunchOptions;
