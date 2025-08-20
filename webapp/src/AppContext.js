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
  fetchWorkflowGithub,
  runWorkflow,
  postConfig,
  postUpload,
  fetchThumbnails,
  fetchImages,
  fetchPlateImages,
  createContainer,
  fetchGroupMappings,
  postGroupMappings,
} from "./apiService";
import { getDjangoConstants } from "./constants";
import { transformStructure, extractGroups } from "./utils";
import { OverlayToaster, Position } from "@blueprintjs/core";

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
    workflowStatusTooltipShown: false,
    inputDatasets: [],
    omeroFileTreeData: null,
    localFileTreeData: null,
    omeroFileTreeSelection: [],
    localFileTreeSelection: [],
    groupFolderMappings: {},
  });
  const [apiLoading, setLoading] = useState(false);
  const [apiError, setError] = useState(null);
  const [toaster, setToaster] = useState(null);

  const updateState = (newState) => {
    setState((prevState) => {
      return { ...prevState, ...newState };
    });
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
    setLoading(true);
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

      // Update state with the merged thumbnails map
      updateState({
        thumbnails: { ...state.thumbnails, ...thumbnailsMap }, // Merge with existing thumbnails
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
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

        // Store images in the parent structure in state.omeroFileTreeData
        updateState({
          omeroFileTreeData: {
            ...state.omeroFileTreeData,
            [index]: {
              ...dataset,
              children: allImages, // Attach fetched images to the dataset
            },
          },
          images: [...(state.images || []), ...allImages],
        });
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
        updateState({
          omeroFileTreeData: {
            ...state.omeroFileTreeData,
            [index]: {
              ...dataset,
              children: imagesWithSource,
            },
          },
          images: [...(state.images || []), ...imagesWithSource],
        });

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

  const runWorkflowData = async (workflowName, params = {}) => {
    setLoading(true);
    setError(null);
    try {
      const response = await runWorkflow(workflowName, params);

      const message = response?.message || "Workflow executed successfully.";

      toaster.show({
        intent: "success",
        icon: "tick-circle",
        message: `${workflowName}: ${message}`,
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
    } finally {
      setLoading(false);
    }
  };

  const saveConfigData = async (config) => {
    setLoading(true);
    setError(null);
    try {
      const response = await postConfig(config);

      const message = response?.message || "Config saved successfully.";

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
        message: `Config response: ${err.message}: ${
          err.response?.data?.error
        } (Params: ${JSON.stringify(config, null, 2)})`,
        timeout: 0,
      });
      setError(err.message);
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

      // Fetch metadata and GitHub URLs for each workflow
      const metadataPromises = workflows.map((workflow) =>
        fetchWorkflowMetadata(workflow)
      );
      const githubPromises = workflows.map((workflow) =>
        fetchWorkflowGithub(workflow)
      );

      const metadata = await Promise.all(metadataPromises);
      const githubUrls = await Promise.all(githubPromises);

      // Prepare the metadata and GitHub URLs in the format that matches the workflow names
      const workflowsWithMetadata = workflows.map((workflow, index) => ({
        name: workflow,
        description: metadata[index]?.description || "No description available",
        metadata: metadata[index],
        githubUrl: githubUrls[index]?.url,
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
      updateState({ config });
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
        };
        return acc;
      }, {});
      const parentId = item || "root";
      formattedData[parentId] = {
        index: parentId,
        isFolder: true,
        children: contents.map((content) => content.id),
        data: parentId === "root" ? "Home" : "Folder",
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
        loadOmeroTreeData,
        loadFolderData,
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
