import React, { useState, useEffect } from "react";
import {
  Callout,
  DialogBody,
  H6,
  Card,
  Tag,
  Icon,
  Tooltip,
  Button,
} from "@blueprintjs/core";
import DatasetSelectWithPopover from "../DatasetSelectWithPopover";
import { useAppContext } from "../../../AppContext";
import { fetchPlatesData } from "../../../apiService";

const PlateWorkflowInput = () => {
  const { state, updateState, loadPlateGridData } = useAppContext();
  const [activePreviewIndex, setActivePreviewIndex] = useState(0);
  const [plateWellCount, setPlateWellCount] = useState(null);
  const [plateGridData, setPlateGridData] = useState(null);
  // Cache per plate ID so switching tabs doesn't re-fetch
  const [plateDataCache, setPlateDataCache] = useState({});

  // Persistent state shared with AppContext (survives Back/Next)
  const selectedPlates = state.workflowInputState?.selectedPlates ?? [];
  const updateWIS = (changes) =>
    updateState({ workflowInputState: { ...state.workflowInputState, ...changes } });

  // Reset preview to first plate when the selection changes
  useEffect(() => {
    setActivePreviewIndex(0);
  }, [selectedPlates.length]);

  // Fetch well count/grid for the active preview plate (cached per plate ID)
  useEffect(() => {
    const fetchPlateWellCount = async () => {
      const activePlate = selectedPlates[activePreviewIndex];
      if (!activePlate?.id) {
        setPlateWellCount(null);
        setPlateGridData(null);
        return;
      }
      // Serve from cache if already fetched
      if (plateDataCache[activePlate.id]) {
        const cached = plateDataCache[activePlate.id];
        setPlateGridData(cached.plateData);
        setPlateWellCount(cached.wellCount);
        return;
      }
      try {
        setPlateWellCount("Fetching...");
        setPlateGridData(null);

        const result = await loadPlateGridData(activePlate.id);

        // Store in cache
        setPlateDataCache((prev) => ({
          ...prev,
          [activePlate.id]: result,
        }));
        setPlateGridData(result.plateData);
        setPlateWellCount(result.wellCount);
      } catch (error) {
        console.error("Failed to fetch plate details:", error);
        setPlateWellCount("Error loading");
        setPlateGridData(null);
      }
    };

    fetchPlateWellCount();
  }, [selectedPlates[activePreviewIndex]?.id, activePreviewIndex]);

  // Save selected plates when changed
  useEffect(() => {
    if (selectedPlates.length > 0) {
      // For plate mode, save all plate IDs and set data type to PLATE
      updateState({
        formData: {
          ...state.formData,
          IDs: selectedPlates.map((p) => p.id),
          Data_Type: "Plate", // Backend expects "Plate" (case sensitive!)
          plateMode: true,
          useZarrFormat: true, // Force zarr format for plates
        },
      });
    } else {
      updateState({
        formData: {
          ...state.formData,
          IDs: [],
        },
      });
    }
  }, [selectedPlates]);

  // Render plate grid visualization
  const renderPlateGrid = () => {
    if (!plateGridData) return null;

    const { grid, rowlabels, collabels } = plateGridData;
    
    // Find min/max occupied positions to create a compact view
    let minRow = rowlabels.length, maxRow = -1, minCol = collabels.length, maxCol = -1;
    grid.forEach((row, rowIdx) => {
      row.forEach((cell, colIdx) => {
        if (cell !== null) {
          minRow = Math.min(minRow, rowIdx);
          maxRow = Math.max(maxRow, rowIdx);
          minCol = Math.min(minCol, colIdx);
          maxCol = Math.max(maxCol, colIdx);
        }
      });
    });

    // If no images, show message
    if (minRow > maxRow) {
      return (
        <div className="text-center text-gray-500 text-sm p-4">
          No images in this plate
        </div>
      );
    }

    // Add padding for context (show some empty wells around occupied ones)
    const padding = 1;
    const startRow = Math.max(0, minRow - padding);
    const endRow = Math.min(rowlabels.length - 1, maxRow + padding);
    const startCol = Math.max(0, minCol - padding);
    const endCol = Math.min(collabels.length - 1, maxCol + padding);

    return (
      <div className="mt-3">
        <div className="text-sm text-gray-600 mb-2">Plate Layout Preview:</div>
        <div className="border rounded p-2 bg-gray-50 inline-block">
          {/* Column headers */}
          <div className="flex">
            <div className="w-6"></div> {/* Empty corner */}
            {collabels.slice(startCol, endCol + 1).map((colLabel, idx) => (
              <div key={colLabel} className="w-12 h-6 text-center text-xs font-medium text-gray-700 flex items-center justify-center">
                {colLabel}
              </div>
            ))}
          </div>
          
          {/* Rows with data */}
          {rowlabels.slice(startRow, endRow + 1).map((rowLabel, rowIdx) => (
            <div key={rowLabel} className="flex">
              {/* Row header */}
              <div className="w-6 h-12 text-center text-xs font-medium text-gray-700 flex items-center justify-center">
                {rowLabel}
              </div>
              
              {/* Well cells */}
              {grid[startRow + rowIdx].slice(startCol, endCol + 1).map((cell, colIdx) => (
                <div key={`${rowLabel}${collabels[startCol + colIdx]}`} className="w-12 h-12 p-0.5">
                  {cell ? (
                    <Tooltip content={`${rowLabel}${collabels[startCol + colIdx]}: ${cell.name}`}>
                      <div className="w-full h-full border border-blue-300 rounded overflow-hidden bg-white shadow-sm">
                        <img
                          src={cell.thumb_url}
                          alt={`Well ${rowLabel}${collabels[startCol + colIdx]}`}
                          className="w-full h-full object-cover"
                        />
                      </div>
                    </Tooltip>
                  ) : (
                    <div className="w-full h-full border border-gray-200 rounded bg-gray-100"></div>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <DialogBody className="flex flex-col min-h-[75vh]">
      {!state.historyRun && <Callout intent="primary" icon="info-sign" className="mb-4">
        Choose the OMERO plates this workflow should process. You can select plates directly, or select a screen to include all of its sub-plates, then review the plate layout preview before continuing.
      </Callout>}

      <div className="w-full">
        <H6 className="mb-2">Select Input Plates</H6>
        
        {/* Plate selection UI */}
        <DatasetSelectWithPopover
          value={selectedPlates.map((p) => `${p.data} (ID: ${p.id})`)}
          label="Select plate(s)"
          placeholder="Select one or more plates..."
          buttonText="Select Plates"
          tooltip="Select one or more OMERO plates as workflow input."
          onChange={async (ids, type) => {
            if (type === "manual") {
              // TagInput fired a deletion — ids are remaining display strings like "name (ID: 501)"
              if (ids.length === 0) {
                updateWIS({ selectedPlates: [] });
                setPlateWellCount(null);
                setPlateGridData(null);
              } else {
                const remainingIds = new Set(
                  ids.map((s) => {
                    const m = s.match(/\(ID:\s*(\d+)\)$/);
                    return m ? parseInt(m[1], 10) : null;
                  }).filter((id) => id !== null)
                );
                updateWIS({ selectedPlates: selectedPlates.filter((p) => remainingIds.has(p.id)) });
              }
              return;
            }

            // Tree selection — ids are node keys like "plate-123" or "screen-456"
            if (ids.length > 0) {
              const plateIds = [];
              const extraNodes = {};

              for (const id of ids) {
                if (id.startsWith("screen-")) {
                  const screenNode = state.omeroFileTreeData[id];
                  if (screenNode?.children?.length > 0) {
                    plateIds.push(...screenNode.children.filter((cid) => cid.startsWith("plate-")));
                  } else {
                    try {
                      const screenId = parseInt(id.replace("screen-", ""), 10);
                      const response = await fetchPlatesData({ id: screenId });
                      const plates = response.plates || [];
                      plates.forEach((plate) => {
                        const key = `plate-${plate.id}`;
                        extraNodes[key] = {
                          index: key,
                          isFolder: false,
                          children: [],
                          childCount: plate.childCount || 0,
                          data: plate.name,
                          id: plate.id,
                          category: "plates",
                          source: "omero",
                        };
                        plateIds.push(key);
                      });
                      if (Object.keys(extraNodes).length > 0) {
                        updateState({
                          omeroFileTreeData: {
                            ...state.omeroFileTreeData,
                            ...extraNodes,
                            [id]: {
                              ...screenNode,
                              children: plates.map((p) => `plate-${p.id}`),
                            },
                          },
                        });
                      }
                    } catch (e) {
                      console.error("Failed to fetch plates for screen", id, e);
                    }
                  }
                } else if (id.startsWith("plate-")) {
                  plateIds.push(id);
                }
              }

              const allNodes = { ...state.omeroFileTreeData, ...extraNodes };
              const resolvedPlates = plateIds.map((p) => allNodes[p]).filter(Boolean);
              // Merge with existing selection, deduplicate by id
              const merged = [...selectedPlates, ...resolvedPlates];
              updateWIS({
                selectedPlates: merged.filter(
                  (plate, idx, arr) => arr.findIndex((p) => p.id === plate.id) === idx
                ),
              });
            } else {
              updateWIS({ selectedPlates: [] });
              setPlateWellCount(null);
              setPlateGridData(null);
            }
          }}
          multiSelect={true}
          allowedCategories={["plates", "screens"]}
          onClear={() => {
            updateWIS({ selectedPlates: [] });
            setPlateWellCount(null);
            setPlateGridData(null);
          }}
        />
        {selectedPlates.length > 0 && (
          <Card className="mt-4">
            <div className="p-4 pb-2">
              {/* Plate tabs — only shown when >1 plate selected */}
              {selectedPlates.length > 1 && (
                <div className="flex flex-wrap gap-1 mb-4 border-b pb-3">
                  {selectedPlates.map((plate, idx) => (
                    <Button
                      key={plate.id}
                      small={true}
                      icon="lab-test"
                      intent={idx === activePreviewIndex ? "primary" : "none"}
                      minimal={idx !== activePreviewIndex}
                      active={idx === activePreviewIndex}
                      onClick={() => setActivePreviewIndex(idx)}
                    >
                      {plate.data} (ID: {plate.id})
                    </Button>
                  ))}
                </div>
              )}

              {/* Single-plate preview for the active plate */}
              {(() => {
                const activePlate = selectedPlates[activePreviewIndex];
                if (!activePlate) return null;
                return (
                  <>
                    <div className="flex justify-between items-start mb-3">
                      <div className="flex items-center gap-2">
                        <H6 className="mb-0">
                          <Icon icon="lab-test" className="mr-2" />
                          {activePlate.data}
                        </H6>
                        <Tag icon="id-number" intent="none" minimal={true} small={true} className="text-xs">
                          ID: {activePlate.id}
                        </Tag>
                      </div>
                    </div>

                    <div className="flex items-center space-x-3 mb-3">
                      <Tag icon="grid-view" intent="none" minimal={true}>
                        {plateWellCount !== null ? plateWellCount :
                          (activePlate.childCount ? activePlate.childCount : "Loading wells...")}
                      </Tag>
                    </div>

                    {/* Plate Grid Visualization */}
                    {renderPlateGrid()}
                  </>
                );
              })()}
            </div>
          </Card>
        )}
      </div>
    </DialogBody>
  );
};

export default PlateWorkflowInput;
