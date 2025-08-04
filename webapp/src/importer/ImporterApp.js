import { useEffect, useState } from "react";
import { useAppContext } from "../AppContext";
import FileBrowser from "./components/FileBrowser";
import OmeroDataBrowser from "../shared/components/OmeroDataBrowser";
import GroupSelect from "../shared/components/GroupSelect";
import AdminPanel from "./components/AdminPanel";
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

const MonitorPanel = ({
  iframeUrl,
  metabaseError,
  setMetabaseError,
  isAdmin,
  metabaseUrl,
}) => (
  <div className="h-full overflow-y-auto">
    <H4>Monitor</H4>
    <div className="bp5-form-group">
      <div className="bp5-form-content">
        <div className="bp5-form-helper-text">
          View your active import progress, or browse some historical data, here
          on this dashboard.
        </div>
        <div className="bp5-form-helper-text">
          Tip: When an import is <b>Import Completed</b>, you can find your
          result images by pasting the <b>UUID</b> in OMERO's search bar at the
          top of your screen.
        </div>
      </div>
    </div>
    <div className="p-4 h-full overflow-hidden">
      {!metabaseError ? (
        <iframe
          title="Metabase dashboard"
          src={iframeUrl}
          className="w-full h-[800px]"
          frameBorder="0"
          onError={() => setMetabaseError(true)}
          onload="iFrameResize({}, this)"
        />
      ) : (
        <div className="error">
          Error loading Metabase dashboard. Please try refreshing the page.
        </div>
      )}
      {isAdmin && (
        <div className="bottom-message">
          <a href={metabaseUrl} target="_blank" rel="noopener noreferrer">
            Click here to access the Metabase interface
          </a>
        </div>
      )}
    </div>
  </div>
);

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
  } = useAppContext();

  const [activeTab, setActiveTab] = useState("ImportImages");
  const [metabaseError, setMetabaseError] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [loadedTabs, setLoadedTabs] = useState({
    ImportImages: true,
    ImportScreens: false,
    Monitor: false,
    Admin: false,
  });
  const [uploadList, setUploadList] = useState([]);
  const [areUploadItemsSelected, setAreUploadItemsSelected] = useState(false);

  const getCurrentGroupFolder = () => {
    const activeGroupId = state.user.active_group_id;
    const mapping = state.groupFolderMappings[activeGroupId];
    return mapping?.folder || "root";  // Default to "root" if no mapping exists
  };

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
    setUploading(true);

    // Enhanced path construction to handle UUID-based items
    const selectedLocal = uploadList.map((item) => {
      const itemPath = findPathToTreeLeaf(item.value, state.localFileTreeData);
      const pathString = itemPath.slice(1).join("/"); // skip Root node

      // Check if this is a UUID-based item (has # in the value)
      if (item.value.includes("#")) {
        const [filePath, uuid] = item.value.split("#");

        // For UUID items, we want the file path up to the .lif/.xlef/.lof file
        const fileExtensions = [".lif", ".xlef", ".lof"];
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

      // Backward compatible: return simple path string for regular files
      return {
        localPath: pathString,
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
    const nodeId = state.omeroFileTreeSelection[0];
    const omeroPath = findPathToTreeLeaf(nodeId, state.omeroFileTreeData);
    const pathString = omeroPath.join("/");
    const isScreen = nodeId.includes("screen-");
    const isDataset = nodeId.includes("dataset-");
    if (!isScreen && activeTab === "ImportScreens") {
      // Show toast if the user tries to select something else
      toaster.show({
        message: "You can only select a screen as upload destination",
        intent: "warning",
      });
      return;
    } else if (!isDataset && activeTab === "ImportImages") {
      // Only allow selection of datasets if active tab is ImportImages
      if (!isDataset && activeTab === "ImportImages") {
        // Show toast if the user tries to select something else
        toaster.show({
          message: "You can only select a dataset as upload destination",
          intent: "warning",
        });
        return;
      }
    }
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

  const findPathToTreeLeaf = (nodeId, tree) => {
    const dfs = (currentNode, path) => {
      if (currentNode === nodeId) return path.concat(tree[currentNode]?.data);
      const children = tree[currentNode]?.children || [];
      for (const child of children) {
        const result = dfs(child, path.concat(tree[currentNode]?.data));
        if (result) return result;
      }
      return null;
    };
    return dfs("root", []);
  };

  const selectedOmeroPath =
    state.omeroFileTreeSelection.length > 0
      ? findPathToTreeLeaf(
          state.omeroFileTreeSelection[0],
          state.omeroFileTreeData
        ).join("/")
      : "";

  const renderCards = () => {
    // TODO
    return uploadList.map((item) => {
      const itemPath = findPathToTreeLeaf(item.value, state.localFileTreeData);
      const itemPathString = itemPath.join("/");
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
  const iframeUrl = `${metabaseUrl}/embed/dashboard/${metabaseToken}#bordered=true&titled=false&refresh=20`;

  useEffect(() => {
    loadOmeroTreeData();
    loadFolderData();
    loadGroups();
    loadGroupMappings();
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

  const renderImportPanel = (mode) => {
    const omeroFileTreeTitle = `1. Select destination ${
      mode === "screen" ? "screen " : "dataset "
    }in OMERO`;
    const localFileTreeTitle = `2. Select ${mode}s to import`;

    const disableAddFilesButton = state.localFileTreeSelection.length === 0 || state.omeroFileTreeSelection.length === 0

    return (
      <div className="h-full">
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
          <div className="w-1/4 overflow-auto pt-2">
            <div className="flex space-x-4 items-center">
              <h1 className="text-base font-bold p-0 m-0 inline-block">
                {localFileTreeTitle}
              </h1>
              <Tooltip
                content={disableAddFilesButton ? "Select destination in omero and files first" : "Add selected files to upload list"}
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
                  Add to upload list
                </Button>
              </Tooltip>
            </div>
            {state.localFileTreeData && (
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
            )}
          </div>
          <div className="w-1/4 overflow-auto pt-2">
            <div className="flex space-x-4 items-center">
              <h1 className="text-base font-bold p-0 m-0 inline-block">
                3. Upload list
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
            } selected for upload`}</span>
          </Card>
          <Icon icon="circle-arrow-right" size={24} color="grey" />
          <Card>
            <span className="text-base">{`Upload destination: ${
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
            Add to upload queue
          </Button>
        </div>
      </div>
    );
  };

  return (
    <div className="focus:outline-none focus:ring-0">
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
            id="ImportImages"
            title="Import images"
            icon="upload"
            panel={loadedTabs.ImportImages ? renderImportPanel("image") : null}
            className="focus:outline-none focus:ring-0"
          />
          <Tab
            id="ImportScreens"
            title="Import screens"
            icon="upload"
            panel={
              loadedTabs.ImportScreens ? renderImportPanel("screen") : null
            }
            className="focus:outline-none focus:ring-0"
          />

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
