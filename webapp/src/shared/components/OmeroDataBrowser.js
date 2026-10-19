import React from "react";
import { useAppContext } from "../../AppContext";
import FileTree from "./FileTree";
import {
  fetchImages,
  fetchPlateImages,
  fetchProjectData,
  fetchPlatesData,
} from "../../apiService";

const OmeroDataBrowser = ({ onSelectCallback }) => {
  const { state, updateState } = useAppContext();

  const handleProjectDataFetch = async (node) => {
    // Determine if this is a project or screen node
    const [nodeType] = node.index.split('-');
    let response;
    let children;

    if (nodeType === 'screen') {
      response = await fetchPlatesData(node);
      children = (response.plates || []).map((plate) => ({
        id: plate.id,
        category: "plates",
        index: `plate-${plate.id}`,
        isFolder: false,
        children: [],
        childCount: plate.childCount || 0,
        data: plate.name,
        source: "omero",
      }));
    } else if (nodeType === "dataset") {
      response = await fetchImages(
        node.id,
        1,
        false,
        false,
        state.user.active_group_id
      );
      children = response.map((image) => ({
        id: image.id,
        category: "images",
        index: `image-${image.id}`,
        isFolder: false,
        children: [],
        childCount: 0,
        data: image.name,
        source: "omero",
      }));
    } else if (nodeType === "plate") {
      response = await fetchPlateImages(node.id);
      children = response.map((image) => ({
        ...image,
        category: "images",
        isFolder: false,
        children: [],
        childCount: 0,
        data: image.name,
      }));
    } else {
      response = await fetchProjectData(node);
      children = (response.datasets || []).map((dataset) => ({
        id: dataset.id,
        category: "datasets",
        index: `dataset-${dataset.id}`,
        isFolder: false,
        children: [],
        childCount: dataset.childCount,
        data: dataset.name,
        source: "omero",
      }));
    }

    const newNodes = children.reduce((acc, child) => {
      acc[child.index] = child;
      return acc;
    }, {});

    // Expansion requests are asynchronous and several nodes can be opened in
    // quick succession. Merge into the latest tree state so a slower response
    // cannot replace children that another request has just loaded.
    updateState((latestState) => ({
      omeroFileTreeData: {
        ...latestState.omeroFileTreeData,
        ...newNodes,
        [node.index]: {
          ...latestState.omeroFileTreeData[node.index],
          children: children.map((child) => child.index),
        },
      },
    }));
    return newNodes;
  };

  return (
    <FileTree
      fetchData={handleProjectDataFetch}
      initialDataKey="root"
      dataStructure={state.omeroFileTreeData}
      onSelectCallback={onSelectCallback}
      selectedItems={state.omeroFileTreeSelection}
    />
  );
};

export default OmeroDataBrowser;
