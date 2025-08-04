import React from "react";
import { Button, Overlay2, OverlaysProvider } from "@blueprintjs/core";

const NewContainerOverlay = ({
  isNewContainerOverlayOpen,
  toggleOverlay,
  newContainerName,
  setNewContainerName,
  newContainerDescription,
  setContainerDescription,
  handleCreate,
  newContainerType,
  selectedOmeroTarget,
}) => {
  const handleCancel = () => {
    setNewContainerName(""); // Clear input
    setContainerDescription(""); // Clear description
    toggleOverlay(); // Close overlay
  };

  let omeroTarget = ""; // Default value
  // if selectedOmeroTarget.category is project, and newContainerType is dataset, keep both the same. Otherwise use the newContainerType but set omeroTarget to 'root folder'
  if (
    !selectedOmeroTarget ||
    !(
      selectedOmeroTarget.category === "projects" &&
      newContainerType === "dataset"
    )
  ) {
    omeroTarget = "root folder";
  } else {
    omeroTarget = selectedOmeroTarget["data"];
  }

  const title = newContainerType
    ? `Create new ${newContainerType} in ${omeroTarget}`
    : `Create new dataset in ${omeroTarget}`;

  const placeholderName = newContainerType
    ? `Enter ${newContainerType} name`
    : "Enter dataset name";

  const placeholderDescription = newContainerType
    ? `Enter ${newContainerType} description`
    : "Enter description";

  return (
    <OverlaysProvider>
      <div>
        <Overlay2
          isOpen={isNewContainerOverlayOpen}
          onClose={handleCancel}
          className="flex items-center justify-center"
        >
          <div className="w-full h-full flex items-center justify-center position-fixed top-0 left-0">
            <div className="bg-white p-6 rounded shadow-lg w-96">
              <h3 className="text-lg font-bold mb-4">{title}</h3>
              <input
                type="text"
                placeholder={placeholderName}
                value={newContainerName}
                onChange={(e) => setNewContainerName(e.target.value)}
                className="bp5-input w-full mb-4"
              />
              <textarea
                placeholder={placeholderDescription}
                className="bp5-input w-full mb-4"
                rows={4}
                value={newContainerDescription}
                onChange={(e) => setContainerDescription(e.target.value)}
              />
              <div className="flex justify-end space-x-4">
                <Button text="Cancel" onClick={handleCancel} />
                <Button
                  text="Create"
                  intent="primary"
                  onClick={handleCreate}
                  disabled={!newContainerName.trim()}
                />
              </div>
            </div>
          </div>
        </Overlay2>
      </div>
    </OverlaysProvider>
  );
};

export default NewContainerOverlay;
