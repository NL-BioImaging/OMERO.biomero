import React, { createContext, useContext, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  fetchomeroFileTreeData,
  fetchFolderData,
  fetchGroups,
  fetchScripts,
  fetchScriptData,
  fetchWorkflows,
  fetchConfig,
  fetchWorkflowMetadata,
  runWorkflow,
  postConfig,
  postUpload,
  fetchThumbnails,
  fetchImages,
  fetchPlateImages,
  fetchPlateGridData,
  createContainer,
  fetchGroupMappings,
  postGroupMappings,
  fetchSlurmStatus,
} from "./apiService";
import { getDjangoConstants } from "./constants";
import { transformStructure, extractGroups } from "./utils";
import { OverlayToaster, Position, Callout, Collapse, Divider, Icon } from "@blueprintjs/core";

// Fields that are infrastructure/output config, not workflow-specific parameters
const INFRA_PARAMS = new Set([
  'IDs', 'Data_Type', 'workflowMode', 'plateMode', 'useZarrFormat', 'Format',
  'active_group_id', 'receiveEmail', 'importAsZip', 'uploadCsv', 'attachFileOutputs',
  'attachToOriginalImages', 'selectedDatasets', 'selectedDatasetId', 'selectedScreens', 'selectedScreenId', 'renamePattern', 'enableRename',
  'importPlateLabelPreview', 'plateLabelPreviewName',
  'createRois', 'roiLabelPattern', 'roiShape', 'deleteLabelImagesAfterRois',
  'clearExistingRois', 'clearRoiFilter', 'roiColor',
  'batchEnabled', 'batchCount', 'batchSize', 'version',
  'cytomine_host', 'cytomine_public_key', 'cytomine_private_key',
  'cytomine_id_project', 'cytomine_id_software',
]);

const MAX_INPUT_IDS_SHOWN = 20;


export const WorkflowSubmitToast = ({
  workflowName,
  startedAt,
  params,
  metadata,
  warnings = [],
  executionMode = "inline",
}) => {
  const [openSection, setOpenSection] = React.useState(null);
  const toggle = (key) => setOpenSection((prev) => (prev === key ? null : key));

  const outputLines = [];
  if (params.selectedDatasets?.length) {
    const pattern = params.enableRename && params.renamePattern ? ` as "${params.renamePattern}"` : "";
    outputLines.push(`Dataset: ${params.selectedDatasets.join(", ")}${pattern}`);
  }
  if (params.selectedScreens?.length) {
    outputLines.push(`Screen: ${params.selectedScreens.join(", ")}`);
  }
  if (params.importPlateLabelPreview) {
    const label = params.plateLabelPreviewName
      ? ` (${params.plateLabelPreviewName})`
      : " (automatic label selection)";
    outputLines.push(`Plate label preview${label}`);
  }
  if (params.importAsZip) outputLines.push("Zip archive");
  if (params.uploadCsv) outputLines.push("OMERO tables (CSV)");
  if (params.attachFileOutputs) outputLines.push("File annotations");
  if (params.attachToOriginalImages) outputLines.push("Attached to input images");
  if (params.createRois) {
    const cleanup = params.deleteLabelImagesAfterRois ? "; imported labels removed from OMERO" : "";
    const clearing = params.clearExistingRois
      ? `; existing ROIs cleared${params.clearRoiFilter ? ` matching "${params.clearRoiFilter}"` : ""}`
      : "";
    const color = params.roiColor ? `; color ${params.roiColor}` : "; automatic run color";
    outputLines.push(`ROIs on original images (${params.roiShape || "Polygon"}${color}${cleanup}${clearing})`);
  }
  if (params.receiveEmail) outputLines.push("E-mail on completion");

  // Build lookup from descriptor so we can classify each param
  const inputById = {};
  (metadata?.inputs || []).forEach((inp) => { inputById[inp.id] = inp; });

  // File attachment params (file-attachment flag) → shown in Input section
  const fileAttachmentEntries = Object.entries(params).filter(([k]) => {
    const inp = inputById[k];
    return inp && inp["file-attachment"] === true;
  });

  // True workflow params: not infra, not set-by-server, not output-dir-set.
  // Falls back to old behaviour (show everything non-infra) when metadata is absent.
  const wfParams = Object.entries(params).filter(([k]) => {
    if (INFRA_PARAMS.has(k)) return false;
    if (!metadata) return true;
    const inp = inputById[k];
    if (!inp) return false;            // not in descriptor — skip
    if (inp["set-by-server"]) return false;  // handled elsewhere
    if (inp["output-dir-set"]) return false; // internal dir — not user-facing
    return true;
  });

  const inputCount = params.IDs?.length || 0;
  const dataType = params.Data_Type || "Image";
  // Count non-empty file attachment slots for the Input section label
  const attachmentCount = fileAttachmentEntries.reduce((sum, [, v]) => {
    const ids = Array.isArray(v) ? v.filter((x) => x != null && x !== "") : (v != null && v !== "" ? [v] : []);
    return sum + ids.length;
  }, 0);
  const batchInfo = params.batchEnabled
    ? `${params.batchCount} jobs × ${params.batchSize} ${dataType}s`
    : null;

  const SectionRow = ({ label, sectionKey, children }) => (
    <div className="mt-1">
      <div
        className="flex items-center gap-1 cursor-pointer select-none"
        onClick={() => toggle(sectionKey)}
      >
        <Icon icon={openSection === sectionKey ? "chevron-down" : "chevron-right"} size={11} />
        <span className="bp5-text-small font-semibold">{label}</span>
      </div>
      <Collapse isOpen={openSection === sectionKey}>
        <div className="ml-3 mt-0.5 bp5-text-small opacity-80">{children}</div>
      </Collapse>
    </div>
  );

  return (
    <div className="min-w-64">
      <div><strong>{workflowName}</strong> submitted successfully</div>
      {startedAt && <div className="bp5-text-small mt-0.5 opacity-80">Started at {startedAt}</div>}
      {warnings.map((warning, index) => (
        <Callout key={`${warning.code || "warning"}-${index}`} intent="warning" compact className="mt-1">
          {warning.message || String(warning)}
        </Callout>
      ))}

      {outputLines.length > 0 && (
        <SectionRow label={`Output (${outputLines.length})`} sectionKey="output">
          {outputLines.map((l, i) => <div key={i}>• {l}</div>)}
        </SectionRow>
      )}

      <SectionRow label={`Input: ${inputCount} ${dataType}${inputCount !== 1 ? "s" : ""}${attachmentCount > 0 ? ` + ${attachmentCount} file${attachmentCount !== 1 ? "s" : ""}` : ""}`} sectionKey="input">
        {params.IDs?.slice(0, MAX_INPUT_IDS_SHOWN).map((id) => <div key={id}>• {dataType} #{id}</div>)}
        {inputCount > MAX_INPUT_IDS_SHOWN && <div className="opacity-60">…and {inputCount - MAX_INPUT_IDS_SHOWN} more</div>}
        {params.useZarrFormat && <div>• Format: ZARR</div>}
        {batchInfo && <div>• Batch: {batchInfo}</div>}
        {fileAttachmentEntries.flatMap(([k, v]) => {
          const ids = Array.isArray(v) ? v.filter((x) => x != null && x !== "") : (v != null && v !== "" ? [v] : []);
          if (!ids.length) return [];
          const label = inputById[k]?.name || k;
          return ids.map((id) => <div key={`${k}-${id}`}>• {label}: Attachment #{id}</div>);
        })}
      </SectionRow>

      {(wfParams.length > 0 || params.version) && (
        <SectionRow label={`Parameters (${wfParams.length + (params.version ? 1 : 0)})`} sectionKey="params">
          {params.version && <div>• version: <strong>{params.version}</strong></div>}
          {wfParams.map(([k, v]) => (
            <div key={k}>• {k}: <strong>{String(v)}</strong></div>
          ))}
        </SectionRow>
      )}

      <Divider className="my-1" />
      {executionMode === "detached" ? (
        <div className="bp5-text-small">
          <strong>Your workflow runs in the background.</strong> You may close this tab or log out. Results will be imported into OMERO automatically, and progress is shown in the BIOMERO workflow overview.
        </div>
      ) : (
        <div className="bp5-text-small">
          <strong>⚠ Do not log out or close this browser tab.</strong> Your OMERO session must stay active for results to be automatically imported. Logging out risks data loss and wastes compute time.
        </div>
      )}
    </div>
  );
};

// Create the context
const AppContext = createContext();

export const AppProvider = ({ children }) => {
  const { user, urls, ui } = getDjangoConstants();
  const [state, setState] = useState({
    user,
    urls,
    ui,
    scripts: [],
    workflows: null,
    workflowMetadata: null,
    capabilities: {},
    workflowStatusTooltipShown: false,
    inputDatasets: [],
    omeroFileTreeData: null,
    omeroAttachmentTreeCache: {},
    localFileTreeData: null,
    omeroFileTreeSelection: [],
    localFileTreeSelection: [],
    groupFolderMappings: {},
    // Persisted UI state for the workflow input step (survives Back/Next navigation)
    workflowInputState: {
      selectedImageIds: [],
      searchQuery: "",
      activeTab: "grid",
      zoom: 7,
      selectedPlates: [],
    },
    // Admin state tracking
    hasUnsavedSettingsChanges: false,
    lastSettingsSaveTime: null,
    lastSlurmInitTime: null,
    lastSlurmCheckTime: null,
  });
  const [apiLoading, setLoading] = useState(false);
  const [apiError, setError] = useState(null);
  const [toaster, setToaster] = useState(null);

  const updateState = (newState) => {
    setState((prevState) => {
      return { ...prevState, ...newState };
    });
  };

  // Admin state management functions
  const markSettingsChanged = () => {
    setState(prev => ({
      ...prev,
      hasUnsavedSettingsChanges: true
    }));
  };

  const markSettingsSaved = () => {
    setState(prev => ({
      ...prev,
      hasUnsavedSettingsChanges: false,
      lastSettingsSaveTime: Date.now()
    }));
  };

  const markSlurmInitExecuted = () => {
    setState(prev => ({
      ...prev,
      lastSlurmInitTime: Date.now()
    }));
  };

  const markSlurmCheckExecuted = () => {
    setState(prev => ({
      ...prev,
      lastSlurmCheckTime: Date.now()
    }));
  };

  // Check if SLURM Init is needed (settings were saved but init hasn't been run since)
  const needsSlurmInit = () => {
    return state.lastSettingsSaveTime && 
           (!state.lastSlurmInitTime || state.lastSettingsSaveTime > state.lastSlurmInitTime);
  };

  // Check if SLURM Check is recommended (init was run but not checked)
  const needsSlurmCheck = () => {
    return state.lastSlurmInitTime && 
           (!state.lastSlurmCheckTime || state.lastSlurmInitTime > state.lastSlurmCheckTime);
  };

  // Initialize toaster asynchronously
  React.useEffect(() => {
    async function initializeToaster() {
      const toaster = await OverlayToaster.createAsync(
        {
          position: Position.TOP,
          className: "text-base",
        },
        {
          domRenderer: (toaster, containerElement) =>
            createRoot(containerElement).render(toaster),
        }
      );
      setToaster(toaster);
    }
    initializeToaster();
  }, []);

  const loadThumbnails = async (imageIds) => {
    setError(null);

    try {
      const batchSize = 50;
      const thumbnailsMap = {};

      // Process imageIds in batches of 50
      for (let i = 0; i < imageIds.length; i += batchSize) {
        const chunk = imageIds.slice(i, i + batchSize);
        const fetchedThumbnails = await fetchThumbnails(chunk); // Returns an object mapping imageId -> thumbnail
        Object.assign(thumbnailsMap, fetchedThumbnails); // Merge batch results into the thumbnailsMap
      }

      // Update state with the merged thumbnails map (functional update to avoid race condition)
      setState(prev => ({
        ...prev,
        thumbnails: { ...prev.thumbnails, ...thumbnailsMap },
      }));
    } catch (err) {
      setError(err.message);
    }
  };

  const loadImagesForDataset = async ({
    dataset,
    page = 1,
    sizeXYZ = false,
    date = false,
    group = -1,
  }) => {
    setLoading(true);
    setError(null);

    try {
      const { index, childCount } = dataset;
      const [type, id] = index.split("-"); // Split the index into type and ID

      if (type === "dataset") {
        const datasetId = parseInt(id, 10);
        let allImages = [];
        let currentPage = page;
        let keepFetching = true;

        while (keepFetching) {
          const images = await fetchImages(
            datasetId,
            currentPage,
            sizeXYZ,
            date,
            group
          );

          // Add source key to each image
          const imagesWithSource = images.map((image) => ({
            ...image,
            source: "omero",
          }));

          if (images.length > 0) {
            allImages = [...allImages, ...imagesWithSource];

            // Flush each page into state immediately so thumbnails can start loading
            // for the first page while remaining pages are still in flight.
            setState(prev => ({
              ...prev,
              omeroFileTreeData: {
                ...prev.omeroFileTreeData,
                [index]: {
                  ...dataset,
                  children: allImages,
                },
              },
              images: [
                ...new Map(
                  [...(prev.images || []), ...allImages].map((img) => [img.id, img])
                ).values(),
              ],
            }));

            // Check if we have fetched enough images
            if (allImages.length >= childCount) {
              keepFetching = false; // We fetched enough images
            } else {
              currentPage++; // Fetch the next page
            }
          } else {
            keepFetching = false; // No more images to fetch
          }
        }
      } else if (type === "plate") {
        const plateId = parseInt(id, 10);
        // Use our existing API service functions
        const images = await fetchPlateImages(plateId);

        // Format images the same way as dataset images
        const imagesWithSource = images.map((image) => ({
          ...image,
          source: "omero",
        }));

        // Store images in state the same way as datasets
        setState(prev => ({
          ...prev,
          omeroFileTreeData: {
            ...prev.omeroFileTreeData,
            [index]: {
              ...dataset,
              children: imagesWithSource,
            },
          },
          images: [
            ...new Map(
              [...(prev.images || []), ...imagesWithSource].map((img) => [img.id, img])
            ).values(),
          ],
        }));

        // Load thumbnails for these images
        const imageIds = imagesWithSource.map((img) => img.id);
        loadThumbnails(imageIds);
      } else {
        console.log(`Skipping non-dataset/plate index: ${index}:`, dataset);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const runWorkflowData = async (workflowName, params = {}, onWorkflowError) => {
    setLoading(true);
    setError(null);
    try {
      // Include the active group ID in the params to ensure workflows run in the correct group
      const paramsWithGroup = {
        ...params,
        active_group_id: state.user.active_group_id,
      };
      
      const response = await runWorkflow(workflowName, paramsWithGroup);

      // Use local browser time with timezone label (server time is UTC, browser clock may differ)
      const startedAt = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", timeZoneName: "short" });

      const warnings = response?.warnings || [];
      const effectiveParams = { ...params, ...(response?.effectiveOptions || {}) };
      toaster.show({
        intent: warnings.length ? "warning" : "success",
        icon: warnings.length ? "warning-sign" : "tick-circle",
        message: <WorkflowSubmitToast workflowName={workflowName} startedAt={startedAt} params={effectiveParams} metadata={state.selectedWorkflow?.metadata} warnings={warnings} executionMode={response?.executionMode} />,
        timeout: 0,
      });
    } catch (err) {
      toaster.show({
        intent: "danger",
        icon: "error",
        message: `${workflowName}: ${err.message}: ${
          err.response?.data?.error
        } (Params: ${JSON.stringify(params, null, 2)})`,
        timeout: 0,
      });
      setError(err.message);
      
      // Trigger SLURM status refresh on workflow errors
      if (onWorkflowError) {
        onWorkflowError();
      }
    } finally {
      setLoading(false);
    }
  };

  const saveConfigData = async (config, deleted = []) => {
    setLoading(true);
    setError(null);
    try {
      const response = await postConfig(config, deleted);

      const message = response?.message || "Config saved successfully.";

      toaster.show({
        intent: "success",
        icon: "tick-circle",
        message: `${message}`,
        timeout: 0,
      });
      
      // Mark settings as saved for admin state tracking
      markSettingsSaved();
    } catch (err) {
      toaster.show({
        intent: "danger",
        icon: "error",
        message: `Config response: ${err.message}: ${
          err.response?.data?.error
        } (Params: ${JSON.stringify(config, null, 2)})`,
        timeout: 0,
      });
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const uploadSelectedData = async (upload) => {
    setLoading(true);
    setError(null);
    try {
      const response = await postUpload(upload);

      const message =
        response?.message ||
        "Files upload started successfully. Follow the progress on the Monitor tab!";

      toaster.show({
        intent: "success",
        icon: "tick-circle",
        message: `${message}`,
        timeout: 0,
      });
    } catch (err) {
      toaster.show({
        intent: "danger",
        icon: "error",
        message: `Upload response: ${err.message}: ${
          err.response?.data?.error
        } (Params: ${JSON.stringify(upload, null, 2)})`,
        timeout: 0,
      });
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const loadWorkflows = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetchWorkflows(); // Fetch workflows (list of names)
      const workflows = response?.workflows || [];

      // Fetch metadata for each workflow (includes githubUrl)
      const metadata = await Promise.all(
        workflows.map((workflow) => fetchWorkflowMetadata(workflow))
      );

      // Prepare the metadata including GitHub URL per workflow
      const workflowsWithMetadata = workflows.map((workflow, index) => ({
        name: workflow,
        description: metadata[index]?.description || "No description available",
        metadata: metadata[index],
        githubUrl: metadata[index]?.githubUrl || null,
      }));

      updateState({
        workflows: workflowsWithMetadata,
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const loadWorkflowMetadata = async (workflow) => {
    setLoading(true);
    setError(null);
    try {
      const metadata = await fetchWorkflowMetadata(workflow);
      updateState({ workflowMetadata: metadata });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const loadBiomeroConfig = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetchConfig();
      const config = response.config;
      updateState({
        config,
        configMode: response.config_mode || "layered",
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // const loadWorkflowGithub = async (workflow) => {
  //   setLoading(true);
  //   setError(null);
  //   try {
  //     const githubUrl = await fetchWorkflowGithub(workflow);
  //     updateState({
  //       githubUrls: {
  //         ...state.githubUrls,
  //         [workflow]: githubUrl.url,
  //       },
  //     });
  //   } catch (err) {
  //     setError(err.message);
  //   } finally {
  //     setLoading(false);
  //   }
  // };

  const loadOmeroTreeData = async () => {
    setLoading(true);
    setError(null);
    try {
      const omeroFileTreeData = await fetchomeroFileTreeData();
      const transformedData = transformStructure(omeroFileTreeData);
      // Add source key to each item
      Object.keys(transformedData).forEach((key) => {
        transformedData[key].source = "omero";
      });

      updateState({ omeroFileTreeData: transformedData });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const loadFolderData = async (item = null) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetchFolderData(item);
      const contents = response.contents || [];
      const formattedData = contents.reduce((acc, content) => {
        const nodeId = content.id;
        acc[nodeId] = {
          index: nodeId,
          isFolder: content.is_folder,
          children: [],
          data: content.name,
          childCount: 0,
          source: content.source,
          metadata: content.metadata,
        };
        return acc;
      }, {});
      const parentId = item || "root";
      formattedData[parentId] = {
        index: parentId,
        isFolder: true,
        children: contents.map((content) => content.id),
        // Use the actual folder path (parentId) as the display label for
        // group-mapped root folders instead of a generic placeholder — the
        // node id already equals the path relative to BASE_DIR, so it is a
        // meaningful label, and other code (e.g. path display) must not rely
        // on this being a fake/generic value.
        data: parentId === "root" ? "Home" : parentId,
        childCount: contents.length,
      };

      updateState({
        localFileTreeData: {
          ...state.localFileTreeData,
          ...formattedData,
        },
      });
    } catch (err) {
      // Attempt to surface backend-provided error message (e.g. ambiguous special files) to the user
      const serverMsg = err?.response?.data; // axios error shape
      // serverMsg may be string or object; prefer string, else fallback to err.message
      const rawMessage = typeof serverMsg === "string"
        ? serverMsg
        : (serverMsg?.message || err.message || "Unknown error");
      // Keep original setError for any components relying on it
      setError(rawMessage);
      console.error("Failed to load folder data:", rawMessage, err);
      // Shorten excessively long messages for toast, but keep essential content
      const MAX_LEN = 240;
      const displayMessage = rawMessage.length > MAX_LEN
        ? rawMessage.slice(0, MAX_LEN - 3) + "..."
        : rawMessage;
      toaster?.show({
        intent: "danger",
        icon: "error",
        message: `Failed to load folder data: ${displayMessage}`,
      });
    } finally {
      setLoading(false);
    }
  };

  const loadPlateGridData = async (plateId) => {
    setLoading(true);
    setError(null);
    try {
      const plateData = await fetchPlateGridData(plateId);
      
      // Calculate well information from grid
      const totalPositions = plateData.rowlabels.length * plateData.collabels.length;
      const wellsWithImages = plateData.grid.flat().filter(cell => cell !== null).length;
      
      // Format well count info
      const plateFormat = `${plateData.rowlabels.length}×${plateData.collabels.length}`;
      const wellCount = wellsWithImages === totalPositions 
        ? `${totalPositions} wells (${plateFormat})`
        : `${wellsWithImages}/${totalPositions} wells (${plateFormat})`;

      return {
        plateData,
        wellCount,
      };
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const loadGroups = async () => {
    setLoading(true);
    setError(null);
    try {
      const groupsHtml = await fetchGroups();
      const groups = extractGroups(groupsHtml);
      updateState({
        user: { ...state.user, groups },
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const loadScripts = async () => {
    setLoading(true);
    setError(null);
    try {
      const scripts = await fetchScripts();
      updateState({
        scripts,
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchScriptDetails = async (scriptId, directory) => {
    setLoading(true);
    try {
      const data = await fetchScriptData(scriptId, directory);
      const fetchedScript = { id: scriptId, ...data.script_menu[0] };

      // Helper function to recursively update the nested structure
      const updateNestedScripts = (nodes) =>
        nodes.map((node) => {
          if (node.id === scriptId) {
            // Update the matching script
            return { ...node, ...fetchedScript };
          } else if (node.ul) {
            // Recursively update child nodes if `ul` exists
            return { ...node, ul: updateNestedScripts(node.ul) };
          }
          return node; // No change for non-matching nodes
        });

      const updatedScripts = updateNestedScripts(state.scripts);
      
      // Update the state with the updated nested scripts
      setState((prevState) => ({
        ...prevState,
        scripts: updateNestedScripts(prevState.scripts),
      }));
    } catch (err) {
      setError("Error fetching script data.");
      console.error("Failed to fetch script data:", err);
    } finally {
      setLoading(false);
    }
  };

  const openScriptWindow = (scriptUrl) => {
    const SCRIPT_WINDOW_WIDTH = 800;
    const SCRIPT_WINDOW_HEIGHT = 600;

    const event = { target: { href: scriptUrl } };
    // eslint-disable-next-line no-undef
    OME.openScriptWindow(event, SCRIPT_WINDOW_WIDTH, SCRIPT_WINDOW_HEIGHT);
  };

  const openImportScriptWindow = (scriptUrl) => {
    // eslint-disable-next-line no-unused-vars
    const SCRIPT_WINDOW_WIDTH = 800;
    // eslint-disable-next-line no-unused-vars
    const SCRIPT_WINDOW_HEIGHT = 600;

    // eslint-disable-next-line no-unused-vars
    const event = { target: { href: scriptUrl } };
    // eslint-disable-next-line no-undef
    OME.openPopup(WEBCLIENT.URLS.script_upload);
  };

  const createNewContainer = async (
    newContainerType,
    newContainerName,
    newContainerDescription,
    targetContainerId,
    targetContainerType
  ) => {
    setLoading(true);
    setError(null);
    try {
      const response = await createContainer(
        newContainerType,
        newContainerName,
        newContainerDescription,
        targetContainerId,
        targetContainerType
      );
      const message = response?.message || "Dataset created successfully.";
      toaster.show({
        intent: "success",
        icon: "tick-circle",
        message: `${message}`,
      });
    } catch (err) {
      toaster.show({
        intent: "danger",
        icon: "error",
        message: `Dataset creation error: ${err.message}: ${
          err.response?.data?.error
        } (Params: ${JSON.stringify(
          { newContainerName, newContainerDescription },
          null,
          2
        )})`,
        timeout: 0,
      });
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const loadGroupMappings = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetchGroupMappings();
      updateState({ groupFolderMappings: response.mappings });
    } catch (err) {
      setError(err.message);
      toaster?.show({
        intent: "danger",
        icon: "error",
        message: `Failed to load group mappings: ${err.message}`,
      });
    } finally {
      setLoading(false);
    }
  };

  const saveGroupMappings = async (mappings) => {
    setLoading(true);
    setError(null);
    try {
      await postGroupMappings(mappings);
      updateState({ groupFolderMappings: mappings });
      toaster?.show({
        intent: "success",
        icon: "tick-circle",
        message: "Group mappings saved successfully",
      });
      setLoading(false);
      return true; // Indicate success
    } catch (err) {
      setError(err.message);
      toaster?.show({
        intent: "danger",
        icon: "error",
        message: `Failed to save group mappings: ${err.message}`,
      });
      setLoading(false);
      return false; // Indicate failure
    }
  };

  return (
    <AppContext.Provider
      value={{
        state,
        updateState,
        markSettingsChanged,
        markSettingsSaved,
        markSlurmInitExecuted,
        markSlurmCheckExecuted,
        needsSlurmInit,
        needsSlurmCheck,
        loadOmeroTreeData,
        loadFolderData,
        loadPlateGridData,
        loadGroups,
        loadScripts,
        fetchScriptDetails,
        openScriptWindow,
        openImportScriptWindow,
        loadWorkflows,
        loadWorkflowMetadata,
        loadBiomeroConfig,
        runWorkflowData,
        saveConfigData,
        uploadSelectedData,
        loadThumbnails,
        loadImagesForDataset,
        loadGroupMappings,
        saveGroupMappings,
        apiLoading,
        apiError,
        toaster,
        createNewContainer,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

// Custom hook to use the AppContext
export const useAppContext = () => {
  return useContext(AppContext);
};
