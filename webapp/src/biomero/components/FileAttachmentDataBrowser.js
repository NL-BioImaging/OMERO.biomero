import React from "react";
import { useAppContext } from "../../AppContext";
import FileTree from "../../shared/components/FileTree";
import { fetchFileAttachments } from "../../apiService";

const FileAttachmentDataBrowser = ({ onSelectCallback, allowedFormats = [] }) => {
  const { state, updateState } = useAppContext();

  const handleFileDataFetch = async (node) => {
    // Determine if this is a project or dataset node
    const [nodeType] = node.index.split('-');
    let response;
    let children;

    if (nodeType === 'project') {
      // Load datasets for this project (like OmeroDataBrowser)
      response = await fetchFileAttachments({ allowedFormats });
      const project = response.file_tree?.find(p => `project-${p.id}` === node.index);
      
      if (!project) return {};

      // Only create dataset nodes, files will be loaded when datasets are expanded
      children = (project.children || [])
        .filter(child => child.type === 'dataset')
        .map((dataset) => ({
          id: dataset.id,
          category: "datasets",
          index: `dataset-${dataset.id}`,
          isFolder: true,
          children: [], // Will be loaded on expansion
          childCount: dataset.children?.length || 0,
          data: dataset.name,
          source: "file_attachment",
        }));

    } else if (nodeType === 'dataset') {
      // Load files for this dataset
      response = await fetchFileAttachments({ allowedFormats });
      
      // Find the dataset in the tree
      let dataset = null;
      for (const project of response.file_tree || []) {
        dataset = project.children?.find(d => 
          d.type === 'dataset' && `dataset-${d.id}` === node.index
        );
        if (dataset) break;
      }
      
      if (!dataset) return {};

      // Create file nodes
      children = (dataset.children || [])
        .filter(child => child.type === 'file')
        .map((file) => ({
          id: file.id,
          category: "files",
          index: `file-${file.id}`,
          isFolder: false,
          children: [],
          childCount: 0,
          data: file.name,
          source: "file_attachment",
          fileData: file, // Store full file data for selection
        }));
    }

    // Update the tree structure like OmeroDataBrowser does
    const updatedNode = {
      ...state.fileAttachmentTreeData?.[node.index],
      children: children.map((child) => child.index),
    };

    const newNodes = children.reduce((acc, child) => {
      acc[child.index] = child;
      return acc;
    }, {});

    updateState({
      fileAttachmentTreeData: {
        ...state.fileAttachmentTreeData,
        ...newNodes,
        [node.index]: updatedNode,
      },
    });
    
    return newNodes;
  };

  return (
    <FileTree
      fetchData={handleFileDataFetch}
      initialDataKey="root"
      dataStructure={state.fileAttachmentTreeData || {}}
      onSelectCallback={onSelectCallback}
      selectedItems={state.fileAttachmentTreeSelection || []}
    />
  );
};

export default FileAttachmentDataBrowser;