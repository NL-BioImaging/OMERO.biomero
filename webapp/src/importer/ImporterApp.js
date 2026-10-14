import { useEffect, useState, useRef } from "react";
import useDashboard from "../shared/useDashboard";
import { useAppContext } from "../AppContext";
import FileBrowser from "./components/FileBrowser";
import OmeroDataBrowser from "../shared/components/OmeroDataBrowser";
import GroupSelect from "../shared/components/GroupSelect";
import AdminPanel from "./components/AdminPanel";
import ResumableUploader from "./components/ResumableUploader";
import {
  Tabs,
  Tab,
  H4,
  Button,
  CardList,
  Card,
  Callout,
  Icon,
  Tooltip,
} from "@blueprintjs/core";
import "@blueprintjs/core/lib/css/blueprint.css";
import NewContainerOverlay from "./components/NewContainerOverlay";
import MetadataForms from "./components/MetadataForms";
import { getImportWarning } from "./import_warnings";


const MonitorPanel = ({
  iframeUrl,
  metabaseError,
  setMetabaseError,
  isAdmin,
  metabaseUrl,
  dashboardError,
  retryDashboard,
}) => {
  const iframeRef = useRef(null);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    const onLoad = () => {
      try {
        const doc = iframe.contentWindow.document;

        doc.addEventListener("click", (e) => {
          const a = e.target.closest("a");
          if (a && a.href) {
            try {
              const url = new URL(a.href);
              // Only redirect top window for links within our domain
              if (["localhost", "127.0.0.1"].includes(url.hostname)) {
                // Metabase behind a reverse proxy can generate absolute localhost
                // URLs; rewrite them to the current public origin.
                window.top.location.href =
                  window.location.origin + url.pathname + url.search + url.hash;
                e.preventDefault();
              } else if (url.hostname === window.location.hostname) {
                window.top.location.href = a.href;
                e.preventDefault();
              }
            } catch (_) {
              // ignore invalid URLs
            }
          }
        });
      } catch (err) {
        console.warn("Could not attach click handler to iframe:", err);
      }
    };

    iframe.addEventListener("load", onLoad);

    return () => {
      iframe.removeEventListener("load", onLoad);
    };
  }, [iframeUrl]);

  return (
    <div className="max-h-[calc(100vh-225px)] overflow-y-auto">
      <H4>Monitor</H4>
      <div className="bp5-form-group">
        <div className="bp5-form-content">
          <div className="bp5-form-helper-text">
            View your active import progress, or browse some historical data,
            here on this dashboard.
          </div>
          <div className="bp5-form-helper-text">
            Tip: When an import is <b>Import Completed</b>, you can find your
            result images by pasting the <b>UUID</b> in OMERO's search bar at
            the top of your screen.
          </div>
        </div>
      </div>
      <div className="p-4">
        {dashboardError && <Callout intent="warning" role="alert">
          <p>{dashboardError}</p>
          <Button icon="refresh" onClick={retryDashboard}>Retry monitor</Button>
        </Callout>}
        {!metabaseError ? (
          <iframe
            title="Metabase dashboard"
            src={iframeUrl}
            className="w-full h-[800px]"
            frameBorder="0"
            ref={iframeRef}
            onError={() => setMetabaseError(true)}
          />
        ) : (
          <div className="error">
            Error loading Metabase dashboard. Please try refreshing the page.
          </div>
        )}
        {isAdmin && (
          <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded">
            <a href={metabaseUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:text-blue-800">
              Click here to access the Metabase interface
            </a>
          </div>
        )}
      </div>
    </div>
  );
};

const ImporterApp = () => {
  const {
    state,
    updateState,
    loadOmeroTreeData,
    loadFolderData,
    loadGroups,
    loadGroupMappings,
    uploadSelectedData,
    createNewContainer,
    toaster,
    loadBiomeroConfig,
    apiLoading,
  } = useAppContext();

  const [activeTab, setActiveTab] = useState("Import");
  const [metabaseError, setMetabaseError] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [loadedTabs, setLoadedTabs] = useState({
    Import: true,
    Upload: false,
    Monitor: false,
    Admin: false,
  });
  const [uploadList, setUploadList] = useState([]);
  const [areUploadItemsSelected, setAreUploadItemsSelected] = useState(false);

  // Derived state for uploader availability
  const useUploader =
    state.config?.UPLOADER?.enabled === true ||
    state.config?.UPLOADER?.enabled === "True";

  const uploadToGroupFolderEnabled =
    state.config?.UPLOADER?.upload_to_group_folder === true ||
    state.config?.UPLOADER?.upload_to_group_folder === "True";

  const getCurrentGroupFolder = () => {
    const activeGroupId = state.user.active_group_id;
    const mapping = state.groupFolderMappings[activeGroupId];
    return mapping?.folder || "root";  // Default to "root" if no mapping exists
  };

  // Whether the active group has an explicit mapping entry (regardless of what
  // folder it maps to — even "root" is a valid, intentional mapping).
  const activeGroupHasMapping =
    !!state.groupFolderMappings?.[state.user?.active_group_id];

  // Import panel: always block if there is no group folder mapping, regardless
  // of whether the web uploader feature is enabled.
  const showNoImportFolderWarning = !activeGroupHasMapping;

  // Upload panel: only block if the "upload to group folder" setting is on and
  // the current group has no folder mapped.
  const showNoUploadFolderWarning =
    uploadToGroupFolderEnabled && !activeGroupHasMapping;

  const [isNewContainerOverlayOpen, setIsNewContainerOverlayOpen] =
    useState(false);
  const [newContainerName, setNewContainerName] = useState("");
  const [newContainerDescription, setContainerDescription] = useState("");
  const [newContainerType, setNewContainerType] = useState("");
  const [selectedOmeroTarget, setSelectedOmeroTarget] = useState(null);
  const [
    lastSelectedLocalFileTreeNodeMeta,
    setLastSelectedLocalFileTreeNodeMeta,
  ] = useState(null);
  const [lastSelectedIndex, setLastSelectedIndex] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const handleRefresh = async () => {
    await loadOmeroTreeData();
    setRefreshKey((prev) => prev + 1);
  };

  const openCreateContainerOverlay = (isOpen, type) => {
    setIsNewContainerOverlayOpen(isOpen);
    setNewContainerType(type);
  };

  const handleFileTreeSelection = (
    nodeData,
    coords,
    e,
    type,
    deselect = false
  ) => {
    const nodeIds = Array.isArray(nodeData) ? nodeData : [nodeData.id];

    const selectionKey =
      type === "local" ? "localFileTreeSelection" : "omeroFileTreeSelection";
    let updatedSelection = [...state[selectionKey]];

    nodeIds.forEach((nodeId) => {
      const itemData =
        type === "local"
          ? state.localFileTreeData[nodeId]
          : state.omeroFileTreeData[nodeId];

      if (type === "local" && itemData && itemData.isFolder) {
        return; // Skip folders
      }

      if (deselect === true) {
        // Explicitly remove from selection
        updatedSelection = updatedSelection.filter((id) => id !== nodeId);
      } else if (type === "local") {
        // Remove from selection if already selected
        if (updatedSelection.includes(nodeId)) {
          updatedSelection = updatedSelection.filter((id) => id !== nodeId);
        } else {
          // Add to selection
          updatedSelection.push(nodeId);
        }
      } else {
        // Explicitly add to selection
        if (!updatedSelection.includes(nodeId)) {
          if (type === "omero") {
            updatedSelection = [nodeId];
          } else {
            updatedSelection.push(nodeId);
          }
        }
      }
    });

    // Update the state with the new selection
    if (deselect) {
      setLastSelectedLocalFileTreeNodeMeta(null);
    } else if (type === "local" && coords) {
      setLastSelectedLocalFileTreeNodeMeta({ coords, nodeId: nodeIds[0] });
    }

    updateState({ [selectionKey]: updatedSelection });

    // Update the selected target for creating new containers
    if (type === "omero" && updatedSelection.length === 1) {
      const selectedItem = state.omeroFileTreeData[updatedSelection[0]];
      setSelectedOmeroTarget(selectedItem);
    }

    // Handle shift key selection for local file tree
    const isShiftKeyPressed = e.shiftKey;
    if (isShiftKeyPressed && type === "local" && coords) {
      // Check if last selected node is of the same parent (coords array has same length, and all but last element are equal)
      const isSameParent =
        lastSelectedLocalFileTreeNodeMeta &&
        lastSelectedLocalFileTreeNodeMeta.coords.length === coords.length &&
        lastSelectedLocalFileTreeNodeMeta.coords
          .slice(0, -1)
          .every((coord, index) => coord === coords[index]);

      if (isSameParent) {
        // Find item that has last-selected id under children
        const selectedNodeId = nodeIds[0];
        const lastSelectedNodeId = lastSelectedLocalFileTreeNodeMeta.nodeId;

        const selectedParentNode = Object.values(state.localFileTreeData).find(
          (node) => node.children.includes(selectedNodeId)
        );
        const siblingNodeIds = selectedParentNode.children || [];

        const selectedNodeIdIndex = siblingNodeIds.indexOf(selectedNodeId);
        const lastSelectedNodeIdIndex =
          siblingNodeIds.indexOf(lastSelectedNodeId);
        // Get all nodes between the first and last selected node
        const start = Math.min(selectedNodeIdIndex, lastSelectedNodeIdIndex);
        const end = Math.max(selectedNodeIdIndex, lastSelectedNodeIdIndex);
        const nodesBetween = siblingNodeIds.slice(start + 1, end + 1);
        // Exclude already selected nodes
        const alreadySelectedNodes = updatedSelection.filter((id) =>
          nodesBetween.includes(id)
        );
        const nodesToSelect = nodesBetween.filter(
          (id) => !alreadySelectedNodes.includes(id)
        );
        // Re-add the last selected node
        nodesToSelect.push(selectedNodeId);

        handleFileTreeSelection(
          nodesToSelect,
          null,
          { shiftKey: false },
          "local",
          false
        );
      }
    }
  };

  const handleUpload = async () => {
    const nodeId = state.omeroFileTreeSelection[0];
    const isScreenDest = nodeId && nodeId.includes("screen-");
    const isDatasetDest = nodeId && nodeId.includes("dataset-");

    const isScreenFile = (item) => {
      if (!item) return false;
      const filename = item.filename || item.data || "";
      if (filename.toLowerCase().endsWith(".db")) return true;
      if (item.metadata && item.metadata.zarr_type === "plate") return true;
      return false;
    };

    if (isDatasetDest) {
      const hasScreenFiles = uploadList.some(item => isScreenFile(item));
      if (hasScreenFiles) {
        toaster.show({
          message: "Cannot import Screen data (.db files or Zarr screens) into a Dataset. Please remove screen files from the list or select a Screen destination.",
          intent: "danger",
        });
        return;
      }
    } else if (isScreenDest) {
      const hasNonScreenFiles = uploadList.some(item => !isScreenFile(item));
      if (hasNonScreenFiles) {
        toaster.show({
          message: "Cannot import standard files into a Screen. Only .db and Zarr screen files are supported for Screen import. Please remove standard files from the list.",
          intent: "danger",
        });
        return;
      }
    }

    setUploading(true);

    // Enhanced path construction to handle UUID-based items.
    //
    // NOTE: item.value (the tree node id) is already the correct path
    // relative to BASE_DIR/IMPORT_MOUNT_PATH — the backend's
    // get_folder_contents() always computes ids via
    // os.path.relpath(item_path_fs, BASE_DIR) (or "<parent_path>#<uuid>"
    // for nested container items), so it already includes any group-mapped
    // subfolder prefix (e.g. "biomero-group1/Barbie1.tif").
    //
    // We must NOT reconstruct the path from the tree's display "data"
    // labels via findPathToTreeLeaf: the root node of a group-mapped
    // folder is seeded with a generic placeholder label (see
    // AppContext.loadFolderData), not the real folder name, so that
    // reconstruction silently drops the group subfolder and sends a
    // truncated path (e.g. "/data/Barbie1.tif" instead of
    // "/data/biomero-group1/Barbie1.tif"), causing "not recognized as
    // file or directory" errors in the importer.
    const selectedLocal = uploadList.map((item) => {
      // Check if this is a UUID-based item (has # in the value)
      if (item.value.includes("#")) {
        const [filePath, uuid] = item.value.split("#");

        // For UUID items, we want the file path up to the container file/directory
        const fileExtensions = [".lif", ".xlef", ".lof", ".zarr"];
        const hasKnownExtension = fileExtensions.some((ext) =>
          filePath.toLowerCase().includes(ext)
        );

        if (hasKnownExtension) {
          // Use the filePath directly - this already contains the correct path to the .lif file
          // e.g., "Project A/LIF/Test-subs_copies.lif"
          return {
            localPath: filePath,
            uuid: uuid
          };
        }
      }

      // Regular files/folders: item.value (the tree node id) is already the
      // correct localPath, relative to BASE_DIR/IMPORT_MOUNT_PATH, including
      // any group-mapped subfolder prefix.
      return {
        localPath: item.value,
        uuid: null
      };
    });

    const selectedOmero = state.omeroFileTreeSelection
      .map((index) => {
        const omeroItem = state.omeroFileTreeData[index];
        return omeroItem ? [omeroItem.category, omeroItem.id] : null;
      })
      .filter(Boolean);

    const uploadData = {
      selectedLocal,
      selectedOmero,
      group: state.user.groups.find((g) => g.id === state.user.active_group_id)
        ?.name,
    };

    try {
      await uploadSelectedData(uploadData);
    } finally {
      setUploading(false);
      removeAllUploadItems();
    }
  };

  // We need to make sure only unique items are added to the upload list
  const addUploadItems = () => {
    // Only allow selection of screens as target if active tab is ImportScreens
    // Only allow selection of dataset or screen as target
    const nodeId = state.omeroFileTreeSelection[0];
    const isScreenDest = nodeId.includes("screen-");
    const isDatasetDest = nodeId.includes("dataset-");
    
    if (!isScreenDest && !isDatasetDest && activeTab === "Import") {
      toaster.show({
        message: "Please select a Dataset or Screen as import destination",
        intent: "warning",
      });
      return;
    }

    // Helper to identify screen files (.db files or Zarr screens/plates)
    const isScreenFile = (item) => {
      if (!item) return false;
      const filename = item.data || "";
      if (filename.toLowerCase().endsWith(".db")) return true;
      if (item.metadata && item.metadata.zarr_type === "plate") return true;
      return false;
    };
    
    // Validate selection against destination type
    const selectedItems = state.localFileTreeSelection.map(id => state.localFileTreeData[id]);
    
    if (isDatasetDest) {
      const hasScreenFiles = selectedItems.some(item => isScreenFile(item));
      if (hasScreenFiles) {
        toaster.show({
          message: "Cannot import Screen data (.db files or Zarr screens) into a Dataset. Please select a Screen destination.",
          intent: "danger",
        });
        return;
      }
    } else if (isScreenDest) {
      const hasNonScreenFiles = selectedItems.some(item => !isScreenFile(item));
      if (hasNonScreenFiles) {
         toaster.show({
          message: "Cannot import standard files into a Screen. Only .db and Zarr screen files are supported for Screen import.",
          intent: "danger",
        });
        return;
      }
    }
    
    const omeroPath = findPathToTreeLeaf(nodeId, state.omeroFileTreeData);
    const pathString = omeroPath ? omeroPath.join("/") : "";

    const newUploadList = state.localFileTreeSelection
      .filter(
        (item) => !uploadList.some((uploadItem) => uploadItem.value === item)
      )
      .map((item) => {
        const itemData = state.localFileTreeData[item];
        return {
          value: item,
          isSelected: false,
          filename: itemData.data,
          omeroPath: pathString,
          ...itemData,
        };
      });
    setUploadList([...uploadList, ...newUploadList]);
    updateState({ localFileTreeSelection: [] });
  };

  const removeUploadItems = () => {
    const newUploadList = uploadList.filter((item) => !item.isSelected);
    setUploadList(newUploadList);
    setAreUploadItemsSelected(false);
  };

  const removeAllUploadItems = () => {
    setUploadList([]);
    setAreUploadItemsSelected(false);
  };

  const selectItem = (item, e) => {
    const clickedIndex = uploadList.findIndex(
      (uploadItem) => uploadItem.value === item.value
    );
    let newUploadList = [...uploadList];

    if (e.shiftKey && lastSelectedIndex !== null) {
      const [start, end] = [lastSelectedIndex, clickedIndex].sort(
        (a, b) => a - b
      );
      for (let i = start; i <= end; i++) {
        newUploadList[i] = { ...newUploadList[i], isSelected: true };
      }
    } else {
      newUploadList = uploadList.map((uploadItem) =>
        uploadItem.value === item.value
          ? { ...uploadItem, isSelected: !uploadItem.isSelected }
          : uploadItem
      );
      setLastSelectedIndex(clickedIndex);
    }

    const areItemsSelected = newUploadList.some((item) => item.isSelected);
    setUploadList(newUploadList);
    setAreUploadItemsSelected(areItemsSelected);
  };

  const findPathToTreeLeaf = (nodeId, tree, rootNodeId = "root") => {
    const dfs = (currentNode, path) => {
      if (!tree || !tree[currentNode]) return null;
      if (currentNode === nodeId) return path.concat(tree[currentNode]?.data);
      const children = tree[currentNode]?.children || [];
      for (const child of children) {
        const result = dfs(child, path.concat(tree[currentNode]?.data));
        if (result) return result;
      }
      return null;
    };
    return dfs(rootNodeId, []);
  };

  const selectedOmeroPath =
    state.omeroFileTreeSelection.length > 0
      ? findPathToTreeLeaf(
          state.omeroFileTreeSelection[0],
          state.omeroFileTreeData
        )?.join("/") || ""
      : "";

  const renderCards = () => {
    // TODO
    return uploadList.map((item) => {
      // Display the actual localPath (item.value), consistent with what is
      // sent to the importer in handleUpload — do not reconstruct via
      // findPathToTreeLeaf, which uses display labels that are not reliable
      // path segments for group-mapped root folders.
      const itemPathString = item.value.includes("#")
        ? item.value.split("#")[0]
        : item.value || item.filename;
      const warningInfo = getImportWarning(item.filename, state.config);
      return (
        <Card
          key={item.value}
          interactive={true}
          className="text-sm m-1 pl-3 flex flex-col"
          selected={item.isSelected}
          onClick={(e) => selectItem(item, e)}
        >
          <div className="flex items-center place-content-between w-full">
            <div className="select-none">{item.filename}</div>
            <div>
              {/* deselect button*/}
              <Icon
                icon="cross"
                onClick={(e) => {
                  e.stopPropagation();
                  setUploadList((prevList) =>
                    prevList.filter(
                      (uploadItem) => uploadItem.value !== item.value
                    )
                  );
                }}
                color="red"
                className="cursor-pointer ml-3"
                size={16}
              />
            </div>
          </div>
          <div className="text-xs text-gray-500 text-align-left w-full select-none">
            {"Source path: " + itemPathString}
          </div>
          {warningInfo && (
            <div className="mt-2 flex items-start text-xs text-amber-700 bg-amber-50 p-2 rounded border border-amber-200">
              <Icon icon="warning-sign" size={14} className="mr-2 mt-0.5 flex-shrink-0 text-amber-600" />
              <div>
                <p className="font-semibold m-0">{warningInfo.summary}</p>
                <p className="m-0 mt-0.5 text-gray-600">{warningInfo.details}</p>
              </div>
            </div>
          )}
        </Card>
      );
    });
  };

  const handleTabChange = (newTabId) => {
    if (!loadedTabs[newTabId]) {
      setLoadedTabs((prevState) => ({ ...prevState, [newTabId]: true }));
    }
    setActiveTab(newTabId);
  };

  const metabaseUrl = document
    .getElementById("root")
    .getAttribute("data-metabase-url");
  const metabaseToken = document
    .getElementById("root")
    .getAttribute("data-metabase-token-imports");
  const isAdmin =
    document.getElementById("root").getAttribute("data-is-admin") === "true";
  const { iframeUrl, error: dashboardError, retry: retryDashboard } = useDashboard(
    `${metabaseUrl}/embed/dashboard/${metabaseToken}#bordered=true&titled=false&refresh=20`,
    window.WEBCLIENT?.URLS?.DASHBOARD_IMPORTS, activeTab === "Monitor",
  );

  useEffect(() => {
    loadOmeroTreeData();
    loadFolderData();
    loadGroups();
    loadGroupMappings();
    loadBiomeroConfig();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleOverlay = () => {
    setIsNewContainerOverlayOpen(!isNewContainerOverlayOpen);
  };

  const handleCreateContainer = () => {
    const selectedOmeroNode = state.omeroFileTreeSelection[0];

    let targetContainerId = null;
    let targetContainerType = "dataset";

    if (selectedOmeroNode) {
      targetContainerType = selectedOmeroNode.split("-")[0];
      targetContainerId = selectedOmeroNode.split("-")[1];
    }

    if (
      !(targetContainerType === "project" && newContainerType === "dataset")
    ) {
      targetContainerId = null;
    }

    createNewContainer(
      newContainerType,
      newContainerName,
      newContainerDescription,
      targetContainerId,
      targetContainerType
    )
      .then(() => {
        loadOmeroTreeData();
        setNewContainerName("");
        setContainerDescription("");
      })
      .catch((error) => {
        console.error("Error creating new container:", error);
      })
      .finally(() => {
        setIsNewContainerOverlayOpen(false);
      });
  };

  const renderUploadPanel = () => {
    let datasetId = null;
    let datasetType = null;
    if (state.omeroFileTreeSelection.length > 0) {
      const selectedNode = state.omeroFileTreeSelection[0];
      const parts = selectedNode.split("-");
      if (parts.length === 2) {
        datasetType = parts[0];
        datasetId = parts[1];
      }
    }

    if (datasetType) {
      datasetType = datasetType.charAt(0).toUpperCase() + datasetType.slice(1);
    }

    const groupName = state.user.groups.find(
      (g) => g.id === state.user.active_group_id
    )?.name;

    return (
      <div className="h-full">
        <div className="mb-4">
          <Callout intent="primary" icon="info-sign">
            Upload images directly from your computer. Select a destination Dataset or Screen on the left, drop or select files on the right, and click Upload.
          </Callout>
        </div>
        <div className="flex space-x-4">
          <div className="w-1/4 overflow-auto pt-2">
          <div className="flex items-center">
            <h1 className="text-base font-bold p-0 m-0">
              1. Select destination in OMERO
            </h1>
            <Tooltip
              content="Create new dataset"
              placement="bottom"
              usePortal={false}
              className="text-md"
            >
              <Icon
                icon="folder-new"
                onClick={() => {
                  openCreateContainerOverlay(true, "dataset");
                }}
                disabled={false}
                tooltip="Create new dataset"
                color="#99b882"
                className="cursor-pointer ml-3"
                size={20}
              />
            </Tooltip>
            <Tooltip
              content="Create new project"
              placement="bottom"
              usePortal={false}
              className="text-md"
            >
              <Icon
                icon="folder-new"
                onClick={() => {
                  openCreateContainerOverlay(true, "project");
                }}
                disabled={false}
                color="#76899e"
                className="cursor-pointer ml-3"
                size={20}
              />
            </Tooltip>
            <Tooltip
              content="Create new screen"
              placement="bottom"
              usePortal={false}
              className="text-md"
            >
              <Icon
                icon="folder-new"
                onClick={() => {
                  openCreateContainerOverlay(true, "screen");
                }}
                disabled={false}
                color="#393939"
                className="cursor-pointer ml-3"
                size={20}
              />
            </Tooltip>
          </div>
          {state.omeroFileTreeData && (
            <div className="mt-4 max-h-[calc(100vh-450px)] overflow-auto">
              <OmeroDataBrowser
                onSelectCallback={(nodeData, coords, e, deselect = false) =>
                  handleFileTreeSelection(
                    nodeData,
                    coords,
                    e,
                    "omero",
                    deselect
                  )
                }
              />
            </div>
          )}
        </div>

        <div className="w-3/4 pt-2">
          <h1 className="text-base font-bold p-0 m-0 mb-4">2. Upload Files</h1>
          {showNoUploadFolderWarning ? (
            <Callout intent="warning" icon="warning-sign">
              The currently selected group has no assigned upload folder. Switch to a different group, or contact your OMERO administrator to get a folder assigned for this group.
            </Callout>
          ) : (
            <ResumableUploader
              datasetId={datasetId}
              datasetType={datasetType}
              group={groupName}
              groupId={state.user.active_group_id}
            />
          )}
        </div>
        </div>
      </div>
    );
  };

  const renderImportPanel = () => {
    const omeroFileTreeTitle = "1. Select destination (Dataset/Screen)";
    const localFileTreeTitle = "2. Select files/folders to import";

    const disableAddFilesButton =
      state.localFileTreeSelection.length === 0 ||
      state.omeroFileTreeSelection.length === 0;

    return (
      <div className="h-full">
        <div className="mb-4">
          <Callout intent="primary" icon="info-sign">
            Import images or screens from your group&apos;s predefined network location.
          </Callout>
        </div>
        <div className="flex space-x-4">
          <div className="w-1/4 overflow-auto pt-2">
            <div className="flex items-center">
              <h1 className="text-base font-bold p-0 m-0">
                {omeroFileTreeTitle}
              </h1>
              <Tooltip
                content="Create new dataset"
                placement="bottom"
                usePortal={false}
                className="text-md"
              >
                <Icon
                  icon="folder-new"
                  onClick={() => {
                    openCreateContainerOverlay(true, "dataset");
                  }}
                  disabled={false}
                  tooltip="Create new dataset"
                  color="#99b882"
                  className="cursor-pointer ml-3"
                  size={20}
                />
              </Tooltip>
              <Tooltip
                content="Create new project"
                placement="bottom"
                usePortal={false}
                className="text-md"
              >
                <Icon
                  icon="folder-new"
                  onClick={() => {
                    openCreateContainerOverlay(true, "project");
                  }}
                  disabled={false}
                  color="#76899e"
                  className="cursor-pointer ml-3"
                  size={20}
                />
              </Tooltip>
              <Tooltip
                content="Create new screen"
                placement="bottom"
                usePortal={false}
                className="text-md"
              >
                <Icon
                  icon="folder-new"
                  onClick={() => {
                    openCreateContainerOverlay(true, "screen");
                  }}
                  disabled={false}
                  color="#393939"
                  className="cursor-pointer ml-3"
                  size={20}
                />
              </Tooltip>
              <Tooltip
                content="Refresh file tree"
                placement="bottom"
                usePortal={false}
                className="text-md"
              >
                <Icon
                  icon="refresh"
                  onClick={handleRefresh}
                  disabled={apiLoading}
                  color="#5c7080"
                  className={`cursor-pointer ml-3 ${apiLoading ? "opacity-50" : ""}`}
                  size={20}
                />
              </Tooltip>
            </div>
            {state.omeroFileTreeData && (
              <div className="mt-4 max-h-[calc(100vh-450px)] overflow-auto">
                <OmeroDataBrowser
                  key={refreshKey}
                  onSelectCallback={(nodeData, coords, e, deselect = false) =>
                    handleFileTreeSelection(
                      nodeData,
                      coords,
                      e,
                      "omero",
                      deselect
                    )
                  }
                />
              </div>
            )}
          </div>
          <div className="w-1/4 overflow-auto pt-2">
            <div className="flex space-x-4 items-center">
              <h1 className="text-base font-bold p-0 m-0 inline-block">
                {localFileTreeTitle}
              </h1>
              <Tooltip
                content={disableAddFilesButton ? "Select destination in omero and files first" : "Add selected files to import list"}
                placement="bottom"
                usePortal={false}
                className="text-md"
              >
                <Button
                  onClick={addUploadItems}
                  disabled={disableAddFilesButton}
                  rightIcon="plus"
                  intent="success"
                  loading={uploading}
                >
                  Add to import list
                </Button>
              </Tooltip>
            </div>
            {showNoImportFolderWarning ? (
              <div className="mt-4">
                <Callout intent="warning" icon="warning-sign">
                  The currently selected group has no assigned upload folder. Switch to a different group, or contact your OMERO administrator to get a folder assigned for this group.
                </Callout>
              </div>
            ) : (
              state.localFileTreeData && (
                <div className="mt-4 max-h-[calc(100vh-450px)] overflow-auto">
                  <FileBrowser
                    onSelectCallback={(nodeData, coords, e, deselect = false) =>
                      handleFileTreeSelection(
                        nodeData,
                        coords,
                        e,
                        "local",
                        deselect
                      )
                    }
                    rootFolder={getCurrentGroupFolder()}
                  />
                </div>
              )
            )}
          </div>
          <div className="w-1/4 overflow-auto pt-2">
            <div className="flex space-x-4 items-center">
              <h1 className="text-base font-bold p-0 m-0 inline-block">
                3. Import list
              </h1>
              <Button
                onClick={removeUploadItems}
                disabled={!areUploadItemsSelected}
                rightIcon="minus"
                intent="success"
                loading={uploading}
              >
                Remove selected
              </Button>
              <Button
                onClick={removeAllUploadItems}
                disabled={!uploadList.length}
                rightIcon="minus"
                intent="success"
                loading={uploading}
              >
                Remove all
              </Button>
            </div>
            {uploadList.length ? (
              <div className="mt-4 max-h-[calc(100vh-450px)] overflow-auto">
                <CardList bordered={false}>{renderCards()}</CardList>
              </div>
            ) : (
              <div className="flex p-8">
                <Callout intent="primary">No files selected</Callout>
              </div>
            )}
          </div>
          
          <div className="w-1/4 overflow-auto pt-2">
            <div className="flex items-center">
              <h1 className="text-base font-bold p-0 m-0 inline-block">
                4. Attach metadata (optional)
              </h1>
            </div>
            <MetadataForms />
          </div>
        </div>

        <div className="absolute flex items-center place-content-between bg-slate-300 w-full p-8 mt-12 bottom-0 left-0">
          <Card className="ml-12">
            <span className="text-base">{`${uploadList.length} file${
              uploadList.length > 1 || uploadList.length === 0 ? "s" : ""
            } selected for import`}</span>
          </Card>
          <Icon icon="circle-arrow-right" size={24} color="grey" />
          <Card>
            <span className="text-base">{`Import destination: ${
              selectedOmeroPath || "None"
            }`}</span>
          </Card>
          <Icon icon="circle-arrow-right" size={24} color="grey" />
          <Button
            onClick={handleUpload}
            disabled={
              !uploadList.length || !state.omeroFileTreeSelection.length
            }
            rightIcon="cloud-upload"
            intent="success"
            loading={uploading}
            large={true}
            className="mr-12"
          >
            Add to import queue
          </Button>
        </div>
      </div>
    );
  };

  return (
    <div className="h-[calc(100vh-85px)] overflow-y-auto focus:outline-none focus:ring-0">
      <div className="p-4">
        {state?.user?.groups && (
          <div className="flex items-center">
            <span className="text-base mr-4">Select group</span>
            <GroupSelect />
          </div>
        )}
      </div>

      <div className="p-4 overflow-hidden">
        <Tabs
          id="app-tabs"
          selectedTabId={activeTab}
          onChange={handleTabChange}
          className="focus:outline-none focus:ring-0"
        >
          <Tab
            id="Import"
            title="Import"
            icon="upload"
            panel={loadedTabs.Import ? renderImportPanel() : null}
            className="focus:outline-none focus:ring-0"
          />

          {useUploader && (
            <Tab
              id="Upload"
              title="Upload"
              icon="cloud-upload"
              panel={loadedTabs.Upload ? renderUploadPanel() : null}
              className="focus:outline-none focus:ring-0"
            />
          )}

          <Tab
            id="Monitor"
            title="Monitor"
            icon="dashboard"
            panel={
              loadedTabs.Monitor ? (
                <MonitorPanel
                  iframeUrl={iframeUrl}
                  metabaseError={metabaseError}
                  setMetabaseError={setMetabaseError}
                  isAdmin={isAdmin}
                  metabaseUrl={metabaseUrl}
                  dashboardError={dashboardError}
                  retryDashboard={retryDashboard}
                />
              ) : null
            }
            className="focus:outline-none focus:ring-0"
          />

          {state?.user?.isAdmin && (
            <Tab
              id="Admin"
              title="Admin"
              icon="settings"
              panel={
                loadedTabs.Admin ? (
                  <AdminPanel />
                ) : null
              }
              className="focus:outline-none focus:ring-0"
            />
          )}
        </Tabs>
      </div>
      <NewContainerOverlay
        isNewContainerOverlayOpen={isNewContainerOverlayOpen}
        toggleOverlay={toggleOverlay}
        newContainerName={newContainerName}
        setNewContainerName={setNewContainerName}
        newContainerDescription={newContainerDescription}
        setContainerDescription={setContainerDescription}
        handleCreate={handleCreateContainer}
        newContainerType={newContainerType}
        selectedOmeroTarget={selectedOmeroTarget}
      />
    </div>
  );
};

export default ImporterApp;
