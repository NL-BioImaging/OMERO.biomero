import React from 'react';
import { useAppContext } from "../../AppContext";
import { getDjangoConstants } from "../../constants";

const MetadataForms = () => {
  const { state } = useAppContext();
  const { urls } = getDjangoConstants();

  // Early return if nothing selected
  if (!state.omeroFileTreeSelection || state.omeroFileTreeSelection.length === 0) {
    return (
      <div className="text-sm">
        <p>
          If your administrator has configured OMERO.forms, you can use them to
          add metadata to datasets, projects and screens.
        </p>
        <p>Select OMERO dataset, project or screen to get started!</p>
      </div>
    );
  }

  // Get the selected item
  const selectedKey = state.omeroFileTreeSelection[0];
  const selectedItem = state.omeroFileTreeData[selectedKey];

  if (!selectedItem) return null;

  // Extract type and ID from the key (format is "type-id")
  const [type, id] = selectedKey.split('-');
  const formType = type.toLowerCase(); // dataset, project, screen, plate

  const formsUrl = `${urls.forms_viewer}?id=${id}&type=${formType}`;

  return (
    <div className="mt-4 h-[calc(100vh-450px)] overflow-auto">
      <iframe 
        src={formsUrl}
        style={{ 
          width: '100%',
          height: '100%',
          border: '1px solid #ddd', 
          borderRadius: '4px',
          display: 'block',  // Removes any inline spacing
          minHeight: 'calc(100vh-450px)'  // Match parent's constraints
        }}
        title="OMERO.forms viewer"
      />
    </div>
  );
};

export default MetadataForms;
