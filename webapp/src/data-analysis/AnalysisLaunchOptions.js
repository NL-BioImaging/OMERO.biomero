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
  Section,
  SectionCard,
  Tag,
} from "@blueprintjs/core";

import {
  fetchAnalysisLaunchContext,
  uploadAnalysisAttachment,
} from "../analysisApi";
import { sourceFromLaunchContext } from "../analysisIntegration";

const sourceKey = (source) => source
  ? `${source.type}:${source.id}:${(source.selectionIds || []).join(",")}`
  : "";

const AnalysisLaunchOptions = ({ baseUrl, source, selectionError, onOpen }) => {
  const [launch, setLaunch] = useState({ key: "", loading: false, data: null, error: "" });
  const [attachmentIds, setAttachmentIds] = useState(new Set());
  const [stagedIds, setStagedIds] = useState(new Set());
  const [bindingModes, setBindingModes] = useState({});
  const [libraryIds, setLibraryIds] = useState(new Set());
  const [libraryQuery, setLibraryQuery] = useState("");
  const [uploading, setUploading] = useState(false);
  const uploadInput = useRef(null);
  const key = sourceKey(source);

  const [attempt, setAttempt] = useState(0);
  const [openLibraryDatasets, setOpenLibraryDatasets] = useState({});
  const generation = useRef(0);
  const uploadController = useRef(null);
  const sourceType = source?.type;
  const sourceId = source?.id;
  const selectionKey = JSON.stringify(source?.selectionIds || []);
  const requestSource = useMemo(() => sourceType && sourceId ? {
    type: sourceType, id: sourceId, selectionIds: JSON.parse(selectionKey),
  } : null, [sourceType, sourceId, selectionKey]);

  useEffect(() => {
    const requestGeneration = ++generation.current;
    const controller = new AbortController();
    setAttachmentIds(new Set());
    setStagedIds(new Set());
    setBindingModes({});
    setLibraryIds(new Set());
    setLibraryQuery("");
    setOpenLibraryDatasets({});
    setUploading(false);
    setLaunch({ key, loading: Boolean(requestSource), data: null, error: "" });
    if (requestSource) {
      fetchAnalysisLaunchContext(baseUrl, requestSource, { signal: controller.signal }).then(data => {
        if (!controller.signal.aborted && generation.current === requestGeneration) {
          setLaunch({ key, loading: false, data, error: "" });
        }
      }).catch(error => {
        if (!controller.signal.aborted && generation.current === requestGeneration) {
          setLaunch({ key, loading: false, data: null, error: error.message });
        }
      });
    }
    return () => {
      generation.current = requestGeneration + 1;
      controller.abort();
      uploadController.current?.abort();
    };
  }, [key, baseUrl, requestSource, attempt]);

  const launchData = launch.key === key ? launch.data : null;
  const attachments = launchData?.supported_attachments || [];
  const stagedAttachments = launchData?.staged_attachments || [];
  const openWorkspace = (selectedSource) => onOpen({ ...selectedSource,
    ...(selectedSource.stagedAttachmentIds?.length && !selectedSource.workspaceId && !selectedSource.newWorkspace
      ? { newWorkspace: crypto.randomUUID(), workspaceAnnotationId: null } : {}),
  });
  const resolution = sourceFromLaunchContext(launchData, source);
  const resolvedSource = resolution.source
    ? {
        ...resolution.source,
        dataAnnotationIds: [...attachmentIds],
        stagedAttachmentIds: [...stagedIds],
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
  const contextError = (launch.key === key ? launch.error : "") || resolution.error || selectionError;
  const canOpen = Boolean(resolvedSource && launchData && !launch.loading && !contextError && !uploading);
  const panelKind = launchData?.panel_kind;
  const library = launchData?.analysis_library_datasets;
  const filteredLibrary = useMemo(() => {
    const query = libraryQuery.trim().toLowerCase();
    const datasets = library || [];
    if (!query) return datasets;
    return datasets.map((dataset) => ({
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
    if (!file || !requestSource || uploading) return;
    const requestGeneration = generation.current;
    const controller = new AbortController();
    uploadController.current = controller;
    const isCurrent = () => !controller.signal.aborted && generation.current === requestGeneration;
    setUploading(true);
    try {
      const attachment = await uploadAnalysisAttachment(baseUrl, requestSource, file, { signal: controller.signal });
      // The server may finish attaching to A even after the user selects B.
      // Never refresh B with A's context or select A's annotation in B.
      if (!isCurrent()) return;
      const data = await fetchAnalysisLaunchContext(baseUrl, requestSource, { signal: controller.signal });
      if (!isCurrent()) return;
      setLaunch({ key, loading: false, data, error: "" });
      if (attachment.staging_id) setStagedIds(current => new Set([...current, attachment.staging_id]));
      else setAttachmentIds(current => new Set([...current, attachment.annotation_id]));
    } catch (error) {
      if (isCurrent()) setLaunch(current => ({ ...current, error: error.message }));
    } finally {
      if (isCurrent()) {
        setUploading(false);
        if (uploadInput.current) uploadInput.current.value = "";
      }
    }
  };

  if (!source) return <Callout intent="warning">{selectionError}</Callout>;
  if (launch.loading || launch.key !== key) return <Callout icon={<Spinner size={16} />}>Loading Analysis launch options…</Callout>;

  return (
    <div className="grid gap-3 mt-4">
      {contextError && <Callout intent="danger" title="Analysis launch failed" role="alert">
        <p className="m-0">{contextError}</p>
        <Button icon="refresh" className="mt-2" disabled={uploading} onClick={() => setAttempt(value => value + 1)}>Retry</Button>
      </Callout>}
      {panelKind === "workspace" && launchData?.workspace_summary && (
        <Card className="grid gap-2.5" elevation={1}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <H5 className="m-0">Resume {launchData.workspace_summary.workspace_name}</H5>
            <Tag intent="primary">Revision {launchData.workspace_summary.revision}</Tag>
          </div>
          <p className="m-0 bp5-text-muted">
            Continue with the reusable Methods, Pipelines, and Notebooks synchronized
            from {launchData.workspace_summary.source_type} {launchData.workspace_summary.source_id}.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {Object.entries(launchData.workspace_summary.counts || {}).map(([kind, count]) => (
              <Tag key={kind} minimal>{count} {kind}{count === 1 ? "" : "s"}</Tag>
            ))}
          </div>
        </Card>
      )}

      {panelKind === "source" && (
        <Card className="grid gap-2.5" elevation={1}>
          <H5 className="m-0">Analysis Workspaces</H5>
          <p className="m-0 bp5-text-muted">Open an existing analysis or create a separate workspace. Names can be changed in Analysis.</p>
          {(launchData?.analysis_workspaces || []).map(item => (
            <div key={item.workspaceId} className="flex flex-wrap items-center gap-2">
              <Button disabled={!canOpen} onClick={() => openWorkspace({ ...resolvedSource, workspaceId: item.workspaceId,
                workspaceAnnotationId: null, newWorkspace: null })}>Open {item.workspaceName}</Button>
              <span className="bp5-text-small bp5-text-muted">Revision {item.revision} · {item.syncStatus?.syncState || "saved"}</span>
            </div>
          ))}
          <Button icon="add" disabled={!canOpen} onClick={() => openWorkspace({ ...resolvedSource,
            workspaceId: null, workspaceAnnotationId: null, newWorkspace: crypto.randomUUID() })}>
            New workspace
          </Button>
        </Card>
      )}

      {panelKind === "source" && !(source.selectionIds || []).length && (
        <>
          <Card className="grid gap-2.5" elevation={1}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <H5 className="m-0">Select data attachments</H5>
              <Tag>{attachmentIds.size + stagedIds.size} selected</Tag>
            </div>
            <p className="m-0 bp5-text-muted">Choose directly attached data, or data attached to child Images or Plates.</p>
            {launchData?.can_annotate && launchData?.attachment_upload_mode !== "blocked" && (
              <div className="flex flex-wrap items-center gap-2">
                <Button icon="upload" loading={uploading} onClick={() => uploadInput.current?.click()}>
                  Upload Attachment
                </Button>
                <input ref={uploadInput} hidden type="file" aria-label="Upload Analysis attachment" onChange={(event) => void upload(event.target.files?.[0])} />
                <span className="bp5-text-small bp5-text-muted">{launchData?.attachment_upload_mode === "inplace"
                  ? "Upload a supported file for the Analysis workspace you open next."
                  : "Attach a supported data or result file to this OMERO object."}</span>
              </div>
            )}
            <Divider />
            {launchData?.attachment_upload_mode === "blocked" && <Callout intent="warning">
              {launchData.attachment_upload_error || "Attachment uploads are currently unavailable."}
            </Callout>}
            <div className="grid gap-1.5 max-h-60 overflow-auto">
              {stagedAttachments.map(attachment => <Checkbox key={attachment.staging_id}
                checked={stagedIds.has(attachment.staging_id)} onChange={() => toggle(setStagedIds, attachment.staging_id)}
                labelElement={<span className="grid gap-0.5"><strong>{attachment.name}</strong>
                  <small className="bp5-text-muted">Ready to attach to the selected workspace · {attachment.size} bytes</small>
                </span>} />)}
              {attachments.map((attachment) => (
                <div className="analysis-attachment-choice" key={attachment.annotation_id}>
                  <Checkbox
                    checked={attachmentIds.has(attachment.annotation_id)}
                    disabled={Array.isArray(attachment.allowed_modes) && !attachment.allowed_modes.length}
                    onChange={() => toggleAttachment(attachment)}
                    labelElement={(
                    <span className="grid gap-0.5">
                      <strong>{attachment.name}</strong>
                      <small className="bp5-text-muted">
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
                    <small className="bp5-text-muted">
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
              {!attachments.length && !stagedAttachments.length && <p className="m-0 p-3 text-center bp5-text-muted">No supported data attachments yet.</p>}
            </div>
          </Card>

          <Card className="grid gap-2.5" elevation={1}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <H5 className="m-0">Reuse from +AnalysisWorkspaces</H5>
              <Tag>{libraryIds.size} selected</Tag>
            </div>
            <p className="m-0 bp5-text-muted">Select synchronized Methods, Pipelines, or Notebooks to import when Analysis opens.</p>
            <InputGroup
              leftIcon="filter"
              placeholder="Filter reusable items"
              value={libraryQuery}
              onChange={(event) => setLibraryQuery(event.target.value)}
            />
            <div className="grid gap-1.5 max-h-60 overflow-auto">
              {filteredLibrary.map((dataset) => (
                <Section key={dataset.datasetId} title={dataset.datasetName}
                  rightElement={<Tag minimal>{dataset.items.length}</Tag>} collapsible
                  collapseProps={{ isOpen: Boolean(libraryQuery) || Boolean(openLibraryDatasets[dataset.datasetId]),
                    keepChildrenMounted: true,
                    onToggle: () => setOpenLibraryDatasets(current => ({ ...current, [dataset.datasetId]: !current[dataset.datasetId] })),
                  }}>
                  <SectionCard padded={false} className="p-2">
                  {(dataset.groups || []).map((group) => (
                    <div key={group.kind} className="grid gap-1 px-2 pt-2">
                      <strong>{group.label}</strong>
                      {group.items.map((item) => (
                        <Checkbox
                          key={item.annotationId}
                          checked={libraryIds.has(item.annotationId)}
                          onChange={() => toggle(setLibraryIds, item.annotationId)}
                          label={`${item.name} · ${item.kind}`}
                        />
                      ))}
                    </div>
                  ))}
                </SectionCard>
                </Section>
              ))}
              {!filteredLibrary.length && <p className="m-0 p-3 text-center bp5-text-muted">No matching reusable items.</p>}
            </div>
          </Card>
        </>
      )}

      {!contextError && <Callout intent={resolvedSource ? "primary" : "warning"}>
        {resolvedSource?.resumeWorkspaceName
          ? `Resume ${resolvedSource.resumeWorkspaceName} — original source ${resolvedSource.type} ${resolvedSource.id}`
          : resolvedSource
            ? `${resolvedSource.title} — ${resolvedSource.type}`
            : "Select a source to continue."}
      </Callout>}
      <Button
        className="justify-self-start"
        intent="primary"
        icon={resolvedSource?.resumeWorkspaceName ? "history" : "applications"}
        disabled={!canOpen}
        onClick={() => resolvedSource && openWorkspace(resolvedSource)}
      >
        {resolvedSource?.resumeWorkspaceName
          ? `Resume ${resolvedSource.resumeWorkspaceName}`
          : attachmentIds.size + stagedIds.size
            ? `Open with ${attachmentIds.size + stagedIds.size} attachment${attachmentIds.size + stagedIds.size === 1 ? "" : "s"}`
            : libraryIds.size
              ? "Open with library selection"
              : "Open Data Analysis"}
      </Button>
    </div>
  );
};

export default AnalysisLaunchOptions;
