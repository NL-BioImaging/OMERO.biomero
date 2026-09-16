import React, { useState, useEffect, useMemo, useRef, useCallback, useTransition } from "react";
import {
  Callout,
  DialogBody,
  H6,
  InputGroup,
  Button,
  ButtonGroup,
  Icon,
  FormGroup,
  Tooltip,
  Card,
  Tabs,
  Tab,
  Switch,
  Slider,
  TabPanel,
  Tag,
  Spinner,
  SpinnerSize,
} from "@blueprintjs/core";
import { fetchPlateImages } from "../../apiService";
import DatasetSelectWithPopover from "./DatasetSelectWithPopover";
import { useAppContext } from "../../AppContext";

/**
 * Renders a single thumbnail lazily — only requests the image when it scrolls
 * within 400 px of the viewport.  The parent supplies an `onVisible` callback
 * that batches multiple IDs before calling the real fetch.
 */
const LazyThumbnail = ({ imageId, thumbnail, apiLoading, onVisible, listMode = false }) => {
  const ref = useRef(null);

  useEffect(() => {
    if (thumbnail) return; // already in cache – nothing to observe
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          onVisible(imageId);
          observer.disconnect();
        }
      },
      { rootMargin: "400px" } // pre-load before fully visible
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [imageId, thumbnail, onVisible]);

  if (listMode) {
    // List mode: small inline icon — ref sits on the outer div, content inside
    return (
      <div ref={ref} className="w-6 h-6 shrink-0">
        {thumbnail ? (
          <img src={thumbnail} alt="" className="w-6 h-6 object-cover rounded-sm shadow-sm" />
        ) : (
          <div className="w-6 h-6 bg-gray-200 flex items-center justify-center rounded-sm">
            {apiLoading && <Spinner size={SpinnerSize.SMALL} />}
          </div>
        )}
      </div>
    );
  }

  // Grid mode: ref sits on a wrapper that exactly matches the original img/placeholder sizing
  // The Card itself is rendered by the parent; we just supply the inner content here.
  return (
    <div ref={ref} className="w-full">
      {thumbnail ? (
        <img src={thumbnail} alt="" className="object-cover w-full" />
      ) : (
        <div className="bg-gray-300 rounded-md w-full h-[100px] flex items-center justify-center">
          {apiLoading
            ? <Spinner size={SpinnerSize.SMALL} />
            : <span className="text-gray-500 text-xs">No preview</span>}
        </div>
      )}
    </div>
  );
};

// Shared shallow comparator for memoized image item components.
// Callbacks (onToggle, onVisible) are always stable refs — excluded intentionally.
// datasetInfo is excluded too: it only changes when datasets change (rare), not on selection.
const imageItemPropsAreEqual = (prev, next) =>
  prev.isSelected === next.isSelected &&
  prev.isDisabled === next.isDisabled &&
  prev.thumbnail === next.thumbnail &&
  prev.image === next.image &&
  prev.apiLoading === next.apiLoading;

// Memoized list row — only re-renders when this specific image’s selection/thumbnail changes.
export const ImageListRow = React.memo(
  ({ image, isSelected, isDisabled, thumbnail, apiLoading, datasetInfo, onToggle, onVisible }) => (
    <div
      className={`flex items-center justify-between gap-4 ${
        isDisabled ? "opacity-50 cursor-not-allowed" : ""
      }`}
    >
      <Switch
        checked={isSelected}
        onChange={() => onToggle(image.id)}
        disabled={isDisabled}
        className="mb-0 min-w-0"
      >
        {image.name}
      </Switch>
      <div className="flex items-center gap-1 shrink-0">
        <Tag minimal round size="small" icon="id-number">
          ID: {image.id}
        </Tag>
        {datasetInfo && (
          <Tag minimal round size="small" icon="id-number">
            {datasetInfo.data} (ID: {datasetInfo.id})
          </Tag>
        )}
        <LazyThumbnail
          imageId={image.id}
          thumbnail={thumbnail}
          apiLoading={apiLoading}
          onVisible={onVisible}
          listMode={true}
        />
      </div>
    </div>
  ),
  imageItemPropsAreEqual
);

// Memoized grid card — same principle.
export const ImageGridCard = React.memo(
  ({ image, isSelected, isDisabled, thumbnail, apiLoading, datasetInfo, onToggle, onVisible }) => (
    <Tooltip
      content={
        <div>
          <div>{image.name}</div>
          <div className="text-xs opacity-75 mt-0.5">
            Image ID: {image.id}
          </div>
          {datasetInfo && (
            <div className="text-xs opacity-75 mt-0.5">
              {datasetInfo.data} (ID: {datasetInfo.id})
            </div>
          )}
        </div>
      }
      targetProps={{ className: isDisabled ? "cursor-not-allowed" : "" }}
    >
      <Card
        interactive={true}
        elevation={isDisabled ? 1 : 3}
        className={`p-1 flex flex-col items-center justify-between border
          ${isDisabled ? "opacity-50 pointer-events-none cursor-not-allowed" : ""}
          ${isSelected ? "bg-blue-500" : ""}
        `}
        onClick={() => !isDisabled && onToggle(image.id)}
        selected={isSelected}
      >
        <LazyThumbnail
          imageId={image.id}
          thumbnail={thumbnail}
          apiLoading={apiLoading}
          onVisible={onVisible}
        />
      </Card>
    </Tooltip>
  ),
  imageItemPropsAreEqual
);

const WorkflowInput = () => {
  const { state, updateState, loadThumbnails, loadImagesForDataset, apiLoading } =
    useAppContext();
  const [selectedPlate, setSelectedPlate] = useState(null);
  const [plateWellCount, setPlateWellCount] = useState(null);
  const [plateGridData, setPlateGridData] = useState(null);

  // Persistent state (survives Back/Next navigation)
  const wis = state.workflowInputState || {};
  const selectedImageIds = wis.selectedImageIds ?? [];
  // searchQuery stays local for instant typing; debounced value is mirrored to AppContext
  // so it survives Back/Next navigation
  const [searchQuery, setSearchQuery] = useState(wis.searchQuery ?? "");
  const [debouncedQuery, setDebouncedQuery] = useState(wis.searchQuery ?? "");
  const debounceRef = useRef(null);
  useEffect(() => () => clearTimeout(debounceRef.current), []);
  const activeTab = wis.activeTab ?? "grid";
  const zoom = wis.zoom ?? 7;

  // Atomic helper — updates one or more fields in workflowInputState
  const updateWIS = (changes) =>
    updateState({ workflowInputState: { ...state.workflowInputState, ...changes } });

  const [isPending, startTransition] = useTransition();

  // O(1) lookup set — avoids O(n) .includes() over 1800+ ids per render
  const selectedSet = useMemo(() => new Set(selectedImageIds), [selectedImageIds]);

  // Track previous image IDs so we can add new / remove deleted without resetting manual deselections
  const prevImageIdsRef = useRef([]);
  // Skip the first run of the inputMode reset effect (component mount ≠ mode change)
  const inputModeInitRef = useRef(true);

  // Batched lazy-thumbnail loader — collect IDs as they become visible, flush after 150 ms.
  // requestThumbnailImpl holds the latest closure; requestThumbnail is a stable ref-forwarding
  // wrapper with a fixed identity so React.memo children never re-render just for it.
  const pendingIdsRef = useRef(new Set());
  const flushTimerRef = useRef(null);
  useEffect(() => () => clearTimeout(flushTimerRef.current), []);
  const requestThumbnailImpl = useRef(null);
  requestThumbnailImpl.current = (id) => {
    if (state.thumbnails?.[String(id)]) return;
    pendingIdsRef.current.add(id);
    clearTimeout(flushTimerRef.current);
    flushTimerRef.current = setTimeout(() => {
      const ids = [...pendingIdsRef.current];
      pendingIdsRef.current.clear();
      if (ids.length > 0) loadThumbnails(ids);
    }, 150);
  };
  const requestThumbnail = useCallback((id) => requestThumbnailImpl.current(id), []);

  // Pre-load the first 50 thumbnails immediately so the initial viewport isn't blank
  const preloadedRef = useRef(false);
  useEffect(() => {
    if (preloadedRef.current || !state.images?.length) return;
    preloadedRef.current = true;
    const firstBatch = state.images.slice(0, 28).map((img) => img.id).filter((id) => !state.thumbnails?.[String(id)]);
    if (firstBatch.length > 0) loadThumbnails(firstBatch);
  }, [state.images]);

  // Get input mode from formData instead of local state
  const inputMode = state.formData?.workflowMode || "images";

  // Derive plate/zarr workflow flags from admin config
  const getWorkflowFlags = useCallback((workflowName) => {
    const ui = state.config?.UI;
    if (!ui) return { isPlateWorkflow: false, isZarrWorkflow: false };
    const plateWorkflows = JSON.parse(ui.plate_workflows || "[]");
    const zarrWorkflows  = JSON.parse(ui.zarr_workflows  || "[]");
    return {
      isPlateWorkflow: plateWorkflows.includes(workflowName),
      isZarrWorkflow:  zarrWorkflows.includes(workflowName),
    };
  }, [state.config]);

  // Build imageId → dataset node lookup so each image knows its parent dataset
  const datasetByImageId = useMemo(() => {
    const map = {};
    (state.inputDatasets || []).forEach((ds) => {
      const node = state.omeroFileTreeData[ds.index];
      if (node?.children) {
        node.children.forEach((img) => { map[img.id] = ds; });
      }
    });
    return map;
  }, [state.inputDatasets, state.omeroFileTreeData]);

  // Load images when datasets change
  useEffect(() => {
    const currentDatasetIds = state.inputDatasets?.map((ds) => ds.index) || [];

    // Remove images of datasets not in inputDatasets
    const filteredImages = Object.entries(state.omeroFileTreeData || {})
      .filter(([key]) => currentDatasetIds.includes(key))
      .flatMap(([, datasetNode]) => datasetNode.children || []);

    const images = [...new Map([...(state.historicalInputImages || []), ...filteredImages]
      .map(image => [image.id, image])).values()];
    updateState({ images });

    // Load images for datasets missing children in omeroFileTreeData
    state.inputDatasets?.forEach((dataset) => {
      const treeNode = state.omeroFileTreeData[dataset.index];

      if (!treeNode || !treeNode.children || treeNode.children.length === 0) {
        loadImagesForDataset({
          dataset: dataset,
          group: state.user.active_group_id,
        }); // Fetch only if not already loaded
      }
    });
  }, [state.inputDatasets, state.historicalInputImages]);

  // Load thumbnails and sync image selection when images list changes
  useEffect(() => {
    if (!state.images) return;

    const allIds = state.images.map((img) => img.id);
    const prevIds = prevImageIdsRef.current;
    prevImageIdsRef.current = allIds;

    // Thumbnails are now loaded lazily via IntersectionObserver in <LazyThumbnail>.
    // filteredImages is derived via useMemo below — no setFilteredImages needed here.

    if (prevIds.length === 0) {
      // First mount — if we have stored selections keep them, otherwise select all
      if (selectedImageIds.length === 0) {
        updateWIS({ selectedImageIds: allIds });
      }
      return;
    }

    // Incremental update: keep existing selections, add new images, drop removed ones
    const removedSet = new Set(prevIds.filter((id) => !allIds.includes(id)));
    const addedIds = allIds.filter((id) => !prevIds.includes(id));
    if (removedSet.size === 0 && addedIds.length === 0) return;
    const updated = [
      ...selectedImageIds.filter((id) => !removedSet.has(id)),
      ...addedIds,
    ];
    updateWIS({ selectedImageIds: updated });
  }, [state.images]);

  // Fetch well count when plate is selected
  useEffect(() => {
    const fetchPlateWellCount = async () => {
      if (selectedPlate?.id) {
        try {
          setPlateWellCount("Fetching...");
          setPlateGridData(null);
          // Use the same endpoint as OMERO webclient for plate grid data
          const response = await fetch(
            `${window.location.origin}/webgateway/plate/${selectedPlate.id}/0/`
          );
          const text = await response.text();
          
          // Parse both JSONP and plain JSON responses
          let plateData;
          if (text.includes('jQuery') && text.includes('({') && text.includes('})')) {
            // JSONP format: jQuery123({...})
            const jsonStart = text.indexOf('({') + 1;
            const jsonEnd = text.lastIndexOf('})');
            plateData = JSON.parse(text.substring(jsonStart, jsonEnd));
          } else {
            // Plain JSON format
            plateData = JSON.parse(text);
          }
          
          // Store the complete grid data for visualization
          setPlateGridData(plateData);
          
          // Calculate well information from grid
          const totalPositions = plateData.rowlabels.length * plateData.collabels.length;
          const wellsWithImages = plateData.grid.flat().filter(cell => cell !== null).length;
          
          // Format well count info
          const plateFormat = `${plateData.rowlabels.length}×${plateData.collabels.length}`;
          if (wellsWithImages === totalPositions) {
            setPlateWellCount(`${totalPositions} wells (${plateFormat})`);
          } else {
            setPlateWellCount(`${wellsWithImages}/${totalPositions} wells (${plateFormat})`);
          }
        } catch (error) {
          console.error("Error fetching plate details:", error);
          setPlateWellCount("Error loading");
          setPlateGridData(null);
        }
      }
    };

    fetchPlateWellCount();
  }, [selectedPlate?.id]);

  // Split images into matched/unmatched — original objects are never spread/cloned,
  // so React.memo only re-renders items whose isDisabled prop actually flips.
  const [matchedImages, disabledImages] = useMemo(() => {
    if (!state.images) return [[], []];
    if (!debouncedQuery) return [state.images, []];
    const lq = debouncedQuery.toLowerCase();
    const matched = [], disabled = [];
    for (const img of state.images) {
      (img.name.toLowerCase().includes(lq) ? matched : disabled).push(img);
    }
    return [matched, disabled];
  }, [state.images, debouncedQuery]);

  // enabledIds, allEnabledSelected, noneEnabledSelected — memoized to avoid repeated O(n) scans in JSX
  const enabledIds = useMemo(() => matchedImages.map((img) => img.id), [matchedImages]);
  // true only when the selection is exactly the enabled set — same count AND all enabled are selected
  const allEnabledSelected = useMemo(
    () =>
      enabledIds.length > 0 &&
      selectedImageIds.length === enabledIds.length &&
      enabledIds.every((id) => selectedSet.has(id)),
    [enabledIds, selectedImageIds, selectedSet]
  );
  const noneEnabledSelected = useMemo(
    () => enabledIds.every((id) => !selectedSet.has(id)),
    [enabledIds, selectedSet]
  );

  // handleToggleImage is stable (ref-forwarding pattern) so React.memo items don't re-render
  // when the parent re-renders for unrelated reasons.
  const toggleImpl = useRef(null);
  toggleImpl.current = (id) => {
    const updated = selectedSet.has(id)
      ? selectedImageIds.filter((x) => x !== id)
      : [...selectedImageIds, id];
    updateWIS({ selectedImageIds: updated });
  };
  const handleToggleImage = useCallback((id) => toggleImpl.current(id), []);

  const handleUncheckAll = () => startTransition(() => updateWIS({ selectedImageIds: [] }));

  const handleCheckAllFiltered = () => {
    startTransition(() =>
      updateWIS({ selectedImageIds: [...new Set([...selectedImageIds, ...enabledIds])] })
    );
  };

  const handleCheckOnlyFiltered = () => {
    startTransition(() => updateWIS({ selectedImageIds: [...enabledIds] }));
  };

  const handleCheckAll = () => {
    startTransition(() =>
      updateWIS({ selectedImageIds: state.images.map((img) => img.id) })
    );
  };

  const handleUncheckAllFiltered = () => {
    const enabledSet = new Set(enabledIds);
    startTransition(() =>
      updateWIS({ selectedImageIds: selectedImageIds.filter((id) => !enabledSet.has(id)) })
    );
  };

  // Save selected IDs when proceeding to the next step
  useEffect(() => {
    const workflowName = state.selectedWorkflow?.name;
    const { isPlateWorkflow, isZarrWorkflow } = workflowName ? getWorkflowFlags(workflowName) : { isPlateWorkflow: false, isZarrWorkflow: false };
    
    if (inputMode === "plates" && selectedPlate) {
      // For plate mode, save plate ID and set data type to PLATE
      updateState({
        formData: {
          ...state.formData,
          IDs: [selectedPlate.id],
          Data_Type: "Plate", // Backend expects "Plate" (case sensitive!)
          plateMode: true,
          useZarrFormat: true, // Force zarr format for plates
        },
      });
    } else if (inputMode === "images") {
      // For dataset mode, save image IDs and set data type to IMAGE
      const shouldUseZarr = isPlateWorkflow || isZarrWorkflow; // Admin-configured ZARR requirement
      updateState({
        formData: {
          ...state.formData,
          IDs: selectedImageIds,
          Data_Type: "Image", // Backend expects "Image" (case sensitive)
          plateMode: false,
          useZarrFormat: shouldUseZarr || state.formData.useZarrFormat,
        },
      });
    }
  }, [selectedImageIds, selectedPlate, inputMode, state.selectedWorkflow, state.config]);

  // Reset selections when input mode changes (controlled from parent)
  // Skip on first mount — we only want to clear when the user actively switches modes
  useEffect(() => {
    if (inputModeInitRef.current) {
      inputModeInitRef.current = false;
      return;
    }
    setSelectedPlate(null);
    setPlateWellCount(null);
    setPlateGridData(null);
    updateState({ inputDatasets: [] });
  }, [inputMode]);

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
        Choose the OMERO data this workflow should process. Start by selecting one or more datasets or plates, then review the images that will be included.
      </Callout>}

      <div className="w-full">
        <H6 className="mb-2">
          {inputMode === "plates" ? "Select Input Plate" : "Select Input Images"}
        </H6>
        
        {inputMode === "images" ? (
          // Image/Dataset selection UI
          <>
          <DatasetSelectWithPopover
            value={state.inputDatasets.map((dataset) =>
              dataset?.id ? `${dataset.data} (ID: ${dataset.id})` : dataset?.data
            ) || []}
            label="Select dataset(s) or plate(s)"
            placeholder="Select one or more datasets or plates..."
            buttonText="Select Datasets or Plates"
            tooltip="Select one or more OMERO datasets or plates as workflow input."
            onChange={(datasets, type) => {
              if (type === "manual") {
                // datasets are remaining display strings like "name (ID: 56)"
                if (datasets.length === 0) {
                  updateState({ inputDatasets: [] });
                } else {
                  const remainingIds = new Set(
                    datasets.map((s) => {
                      const m = s.match(/\(ID:\s*(\d+)\)$/);
                      return m ? parseInt(m[1], 10) : null;
                    }).filter((id) => id !== null)
                  );
                  updateState({
                    inputDatasets: state.inputDatasets.filter((ds) =>
                      remainingIds.has(ds.id)
                    ),
                  });
                }
                return;
              }
              // Tree selection — datasets are node keys like "dataset-123"
              const inputDatasets = datasets
                .map((dataset) => state.omeroFileTreeData[dataset])
                .filter(Boolean);
              updateState({
                inputDatasets: [
                  // Adding, keep unique by index
                  ...new Map(
                    [...state.inputDatasets, ...inputDatasets].map((item) => [
                      item.index,
                      item,
                    ])
                  ).values(),
                ],
              });
            }}
            multiSelect={true}
            allowedCategories={["datasets", "plates"]}
            onClear={() => {
              updateState({ inputDatasets: [], images: [] });
              updateWIS({ selectedImageIds: [] });
            }}
          />
          </>
        ) : (
          <DatasetSelectWithPopover
            value={selectedPlate ? [selectedPlate.data] : []} 
            label="Select plate"
            placeholder="Add new plate name or select..."
            buttonText="Select Plate"
            tooltip="Select the OMERO plate as workflow input."
            onChange={(plates, type) => {
              if (plates.length > 0) {
                const resolvedPlate =
                  state.omeroFileTreeData[plates[0]] || // Case 1: plate is already the key/index
                  Object.values(state.omeroFileTreeData).find(
                    (node) => node.data === plates[0]
                  ); // Case 2: plate is the data value
                setSelectedPlate(resolvedPlate);
                setPlateWellCount(null); // Reset well count when changing plates
                setPlateGridData(null); // Reset grid data when changing plates
              } else {
                setSelectedPlate(null);
                setPlateWellCount(null);
                setPlateGridData(null);
              }
            }}
            multiSelect={false}
            allowedCategories={["plates"]}
          />
        )}
        
        {/* Plate Preview */}
        {inputMode === "plates" && selectedPlate && (
          <Card className="mt-4">
            <div className="p-4 pb-2">
              <div className="flex justify-between items-start mb-3">
                <div className="flex items-center gap-2">
                  <H6 className="mb-0">
                    <Icon icon="lab-test" className="mr-2" />
                    {selectedPlate.data}
                  </H6>
                  <Tag
                    icon="id-number"
                    intent="none"
                    minimal={true}
                    small={true}
                    className="text-xs"
                  >
                    ID: {selectedPlate.id}
                  </Tag>
                </div>
              </div>
              
              <div className="flex items-center space-x-3 mb-3">
                <Tag
                  icon="grid-view"
                  intent="none"
                  minimal={true}
                >
                  {plateWellCount !== null ? plateWellCount : 
                    (selectedPlate.childCount ? selectedPlate.childCount : "Loading wells...")}
                </Tag>
              </div>
            </div>
            
            {/* Plate Grid Visualization */}
            {renderPlateGrid()}
          </Card>
        )}
        
      </div>
      {inputMode === "images" && state.inputDatasets?.length > 0 && (
        <>
            {/* Filter bar and buttons */}
            <div className="pb-2">
              <FormGroup
                label={
                  <div className="flex items-center justify-between">
                    <span>Filter filenames</span>
                    <Tooltip content="Reload images from OMERO for selected datasets">
                      <Button
                        icon="refresh"
                        minimal
                        small
                        onClick={() => {
                          updateState({ images: [] });
                          updateWIS({ selectedImageIds: [] });
                          state.inputDatasets.forEach((ds) => {
                            loadImagesForDataset({
                              dataset: ds,
                              group: state.user.active_group_id,
                            });
                          });
                        }}
                      />
                    </Tooltip>
                  </div>
                }
                className="mb-4"
              >
                <InputGroup
                  leftElement={<Icon icon="filter" />}
                  rightElement={
                    searchQuery && (
                      <Button
                        minimal
                        icon="cross"
                        onClick={() => {
                          clearTimeout(debounceRef.current);
                          setSearchQuery("");
                          startTransition(() => {
                            setDebouncedQuery("");
                            updateWIS({ searchQuery: "" });
                          });
                        }}
                      />
                    )
                  }
                  placeholder="Type to filter images..."
                  value={searchQuery}
                  onChange={(e) => {
                    const q = e.target.value;
                    setSearchQuery(q);
                    clearTimeout(debounceRef.current);
                    debounceRef.current = setTimeout(() => {
                      startTransition(() => {
                        setDebouncedQuery(q);
                        updateWIS({ searchQuery: q });
                      });
                    }, 150);
                  }}
                />
              </FormGroup>
              <ButtonGroup className="mb-2 w-full" fill={true}>
                <Tooltip
                  intent={
                    selectedImageIds.length === state.images?.length
                      ? "none"
                      : searchQuery
                      ? "warning"
                      : "primary"
                  }
                  content={
                    selectedImageIds.length === state.images?.length
                      ? "Already selected all images"
                      : searchQuery
                      ? "Select all images, also those not in your current filter!"
                      : "Select all images"
                  }
                >
                  <Button
                    icon="selection"
                    intent={
                      selectedImageIds.length === state.images?.length
                        ? "none"
                        : searchQuery
                        ? "warning"
                        : "primary"
                    }
                    text="Select ALL"
                    onClick={handleCheckAll}
                    disabled={selectedImageIds.length === state.images?.length}
                    className="flex-grow"
                    outlined={true}
                  />
                </Tooltip>
                <Tooltip
                  intent={selectedImageIds.length === 0 ? "none" : "danger"}
                  content={
                    selectedImageIds.length === 0
                      ? "No images are selected to deselect"
                      : searchQuery
                      ? "Deselect all images, also those not in your current filter!"
                      : "Deselect all images"
                  }
                >
                  <Button
                    outlined={true}
                    icon="circle"
                    intent={selectedImageIds.length === 0 ? "none" : "danger"}
                    text="Deselect ALL"
                    onClick={handleUncheckAll}
                    disabled={selectedImageIds.length === 0}
                    className="flex-grow"
                  />
                </Tooltip>
                <Tooltip
                  intent={
                    searchQuery &&
                    !allEnabledSelected
                      ? "success"
                      : "none"
                  }
                  content={
                    !searchQuery
                      ? "Add a filter first"
                      : allEnabledSelected
                      ? "Only the filtered images are already selected"
                      : "Select ONLY the images matching your filter"
                  }
                  isOpen={
                    searchQuery && !allEnabledSelected
                      ? true
                      : undefined
                  }
                >
                  <Button
                    icon="filter"
                    outlined={true}
                    text="Apply Filter"
                    onClick={() => {
                      handleCheckOnlyFiltered();
                    }}
                    intent={
                      searchQuery && !allEnabledSelected
                        ? "success"
                        : "none"
                    }
                    disabled={
                      !searchQuery || allEnabledSelected
                    }
                    className="flex-grow"
                  />
                </Tooltip>
                <Tooltip
                  intent={
                    searchQuery && !allEnabledSelected
                      ? "primary"
                      : "none"
                  }
                  content={
                    !searchQuery
                      ? "Add a filter first"
                      : allEnabledSelected
                      ? "All filtered images are already selected"
                      : "Select all filtered images"
                  }
                >
                  <Button
                    icon="selection"
                    outlined={true}
                    text="Select Filtered"
                    onClick={handleCheckAllFiltered}
                    intent={
                      searchQuery && !allEnabledSelected
                        ? "primary"
                        : "none"
                    }
                    disabled={
                      !searchQuery || allEnabledSelected
                    }
                    className="flex-grow"
                  />
                </Tooltip>

                <Tooltip
                  intent={
                    searchQuery && !noneEnabledSelected
                      ? "primary"
                      : "none"
                  }
                  content={
                    !searchQuery
                      ? "Add a filter first"
                      : noneEnabledSelected
                      ? "No filtered images are selected to deselect"
                      : "Deselect all filtered images"
                  }
                >
                  <Button
                    icon="circle"
                    outlined={true}
                    text="Deselect Filtered"
                    onClick={handleUncheckAllFiltered}
                    intent={
                      searchQuery && !noneEnabledSelected
                        ? "primary"
                        : "none"
                    }
                    disabled={
                      !searchQuery || noneEnabledSelected
                    }
                    className="flex-grow"
                  />
                </Tooltip>
              </ButtonGroup>
            </div>
        </>
      )}
      {inputMode === "images" && state.inputDatasets?.length > 0 && (
        <div className="p-1 h-full overflow-hidden">
          <Tabs
            id="workflow-input-tabs"
            selectedTabId={activeTab}
            onChange={(newTab) => updateWIS({ activeTab: newTab })}
            renderActiveTabPanelOnly={true}
          >
            <Tab
              id="list"
              title="Image List"
              tagContent={selectedImageIds.length}
              tagProps={{
                round: true,
                className:
                  selectedImageIds.length === 0 ? "bg-red-500 text-white" : "",
              }}
            />
            <Tab
              id="grid"
              tagContent={selectedImageIds.length}
              tagProps={{
                round: true,
                className:
                  selectedImageIds.length === 0 ? "bg-red-500 text-white" : "",
              }}
              title="Thumbnail Grid"
            />
          </Tabs>
          <TabPanel
            id="list"
            selectedTabId={activeTab}
            parentId="workflow-input-tabs"
            className="overflow-auto"
            panel={
              <div className={`flex flex-col gap-2 overflow-y-auto pt-1 pl-1 min-h-[calc(100vh-80vh)] max-h-[45vh] transition-opacity duration-150 ${isPending ? "opacity-50" : ""}`}>
                {apiLoading && matchedImages.length === 0 && disabledImages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-32 gap-2 text-gray-400">
                    <Spinner size={SpinnerSize.LARGE} />
                    <span className="text-sm">Loading images…</span>
                  </div>
                ) : matchedImages.length > 0 || disabledImages.length > 0 ? (
                  <>
                    {matchedImages.map((image) => (
                      <ImageListRow
                        key={image.id}
                        image={image}
                        isSelected={selectedSet.has(image.id)}
                        isDisabled={false}
                        thumbnail={state.thumbnails?.[image.id]}
                        datasetInfo={datasetByImageId[image.id]}
                        apiLoading={apiLoading}
                        onToggle={handleToggleImage}
                        onVisible={requestThumbnail}
                      />
                    ))}
                    {disabledImages.map((image) => (
                      <ImageListRow
                        key={image.id}
                        image={image}
                        isSelected={selectedSet.has(image.id)}
                        isDisabled={true}
                        thumbnail={state.thumbnails?.[image.id]}
                        datasetInfo={datasetByImageId[image.id]}
                        apiLoading={apiLoading}
                        onToggle={handleToggleImage}
                        onVisible={requestThumbnail}
                      />
                    ))}
                  </>
                ) : (
                  <p className="text-gray-500 text-xs">
                    No images match your search.
                  </p>
                )}
              </div>
            }
          />
          <TabPanel
            id="grid"
            selectedTabId={activeTab}
            parentId="workflow-input-tabs"
            className="overflow-auto min-h-[calc(100vh-80vh)] max-h-[45vh]"
            panel={
              <div className={`flex flex-col items-center transition-opacity duration-150 ${isPending ? "opacity-50" : ""}` }>
                {/* Slider Section */}
                <div className="w-full px-4">
                  <FormGroup label="Columns" inline={false}>
                    <Slider
                      min={1}
                      max={12}
                      value={zoom}
                      onChange={(v) => updateWIS({ zoom: v })}
                      showTrackFill={false}
                      labelStepSize={11}
                      vertical={false}
                    />
                  </FormGroup>
                </div>

                {/* Thumbnail Grid */}
                <div
                  className={`grid grid-cols-${zoom} gap-2 overflow-y-auto p-1 w-full`}
                >
                  {apiLoading && matchedImages.length === 0 && disabledImages.length === 0 ? (
                    <div className="col-span-full flex flex-col items-center justify-center h-32 gap-2 text-gray-400">
                      <Spinner size={SpinnerSize.LARGE} />
                      <span className="text-sm">Loading images…</span>
                    </div>
                  ) : matchedImages.length > 0 || disabledImages.length > 0 ? (
                    <>
                      {matchedImages.map((image) => (
                        <ImageGridCard
                          key={image.id}
                          image={image}
                          isSelected={selectedSet.has(image.id)}
                          isDisabled={false}
                          thumbnail={state.thumbnails?.[image.id]}
                          datasetInfo={datasetByImageId[image.id]}
                          apiLoading={apiLoading}
                          onToggle={handleToggleImage}
                          onVisible={requestThumbnail}
                        />
                      ))}
                      {disabledImages.map((image) => (
                        <ImageGridCard
                          key={image.id}
                          image={image}
                          isSelected={selectedSet.has(image.id)}
                          isDisabled={true}
                          thumbnail={state.thumbnails?.[image.id]}
                          datasetInfo={datasetByImageId[image.id]}
                          apiLoading={apiLoading}
                          onToggle={handleToggleImage}
                          onVisible={requestThumbnail}
                        />
                      ))}
                    </>
                  ) : (
                    <p className="text-gray-500 text-xs col-span-4">
                      No images match your search.
                    </p>
                  )}
                </div>
              </div>
            }
          />
        </div>
      )}
    </DialogBody>
  );
};

export default WorkflowInput;
