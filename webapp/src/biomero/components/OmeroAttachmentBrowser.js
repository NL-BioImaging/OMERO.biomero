import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  InputGroup,
  Button,
  Icon,
  Spinner,
  Tag,
  Tabs,
  Tab,
  NonIdealState,
  Tooltip,
  Popover,
  Menu,
  MenuItem,
  MenuDivider,
} from "@blueprintjs/core";
import { fetchAttachments, invalidateAttachmentsCache } from "../../apiService";
import { useAppContext } from "../../AppContext";
import OmeroAttachmentTreeBrowser from "./OmeroAttachmentTreeBrowser";

/**
 * Browse OMERO file annotations (attachments) and select one or more.
 *
 * Props:
 *   formats    {string[]}  File extensions to pre-filter server-side, e.g. ["csv", "parquet"].
 *                          Empty means no filter.
 *   fileCount  {"single"|"multiple"|null}
 *                          "single" = only one attachment can be selected at a time.
 *                          "multiple" or null = multi-select.
 *   selectedIds {number[]} Currently selected annotation IDs (controlled).
 *   onSelect   {(ids: number[]) => void}  Called with updated selection.
 */

/**
 * Walk the OMERO tree to include ancestor nodes in the context filter.
 * E.g. selecting Plate:452 also adds Screen:X so screen-level files are visible.
 */
function buildContextWithAncestors(treeData, dataType, ids) {
  if (!dataType || !ids?.length) return [];
  // Reverse-parent map: childIndex → parent node
  const parentOf = {};
  Object.values(treeData || {}).forEach((node) => {
    (node.children || []).forEach((childIdx) => {
      parentOf[childIdx] = node;
    });
  });
  const seen = new Set();
  const contexts = [];
  const addCtx = (type, cid, name) => {
    const k = `${type}-${cid}`;
    if (seen.has(k)) return;
    seen.add(k);
    contexts.push(name != null ? { type, id: cid, name } : { type, id: cid });
  };
  for (const rawId of ids) {
    const id = parseInt(rawId, 10);
    addCtx(dataType, id, undefined);
    // Walk up the tree to include ancestor objects
    let idx = `${dataType.toLowerCase()}-${id}`;
    while (parentOf[idx]) {
      const pNode = parentOf[idx];
      const pCat = pNode.category || "";
      // Skip virtual container categories (datasets, plates, images, wells)
      if (!["datasets", "plates", "images", "wells"].includes(pCat) && pNode.id != null) {
        const pType = pCat.charAt(0).toUpperCase() + pCat.slice(1);
        const nameMatch = typeof pNode.data === "string" ? pNode.data.match(/^(.+?)\s*\(ID:/) : null;
        addCtx(pType, pNode.id, nameMatch ? nameMatch[1].trim() : pNode.data);
      }
      idx = pNode.index || "";
    }
  }
  return contexts;
}

const OmeroAttachmentBrowser = ({
  formats = [],
  fileCount = null,
  selectedIds = [],
  onSelect,
}) => {
  const { state } = useAppContext();
  // All attachments from the server (filtered by format+group, not by search)
  const [allAttachments, setAllAttachments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState("list");
  const [collapsedGroups, setCollapsedGroups] = useState(new Set());
  const [sortBy, setSortBy] = useState("date");
  const [sortDir, setSortDir] = useState("desc");
  const [colCount, setColCount] = useState(1);
  const [colCountMode, setColCountMode] = useState("auto");
  const [viewportWidth, setViewportWidth] = useState(
    typeof window !== "undefined" ? window.innerWidth : 1280
  );

  // Derive "dialog 1" context (which OMERO objects the user is working with)
  // once at mount. Used to pre-filter attachments to parents already in scope.
  const dialogContextRef = useRef(null);
  if (dialogContextRef.current === null) {
    const dataType = state.formData?.Data_Type;
    const ids = state.formData?.IDs;
    dialogContextRef.current = buildContextWithAncestors(
      state.omeroFileTreeData,
      dataType,
      ids
    );
  }
  const dialogContext = dialogContextRef.current; // stable — set once at mount

  // User-controlled context filter — starts from dialogContext, can be cleared/restored.
  const [activeContextFilters, setActiveContextFilters] = useState(
    () => dialogContextRef.current || []
  );

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // formats and group are fixed for the lifetime of this instance:
  // formats come from the workflow descriptor (never change in a session),
  // and each param gets its own browser mount.
  const formatsSet = useMemo(
    () => new Set(formats.map((f) => f.toLowerCase())),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [] // capture once at mount — formats are descriptor-static
  );
  const groupIdRef = useRef(state.user?.active_group_id ?? null);

  const loadAttachments = useCallback(async (forceRefresh = false) => {
    setLoading(true);
    setError(null);
    try {
      if (forceRefresh) invalidateAttachmentsCache(groupIdRef.current);
      const resp = await fetchAttachments(groupIdRef.current);
      setAllAttachments(resp.attachments || []);
    } catch (e) {
      setError(e?.response?.data?.error || e?.message || "Failed to load attachments");
    } finally {
      setLoading(false);
    }
  }, []); // stable — fetchAttachments handles caching

  // Fetch once on mount.
  useEffect(() => {
    loadAttachments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // In-memory filters: format (prop, stable) + OMERO parent filters + pinned text filters + live search
  const attachments = useMemo(() => {
    let list = allAttachments;
    if (formatsSet.size > 0) {
      list = list.filter((a) => formatsSet.has((a.extension || "").toLowerCase()));
    }
    // OMERO parent filters: attachment must belong to at least one listed parent (OR)
    const omeroFilters = activeContextFilters.filter((f) => f.type !== "search");
    if (omeroFilters.length > 0) {
      const ctxSet = new Set(omeroFilters.map((f) => `${f.type}-${f.id}`));
      list = list.filter((a) =>
        (a.parents || []).some((p) => ctxSet.has(`${p.type}-${p.id}`))
      );
    }
    // Search
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((a) => a.name.toLowerCase().includes(q));
    }
    return list;
  }, [allAttachments, formatsSet, activeContextFilters, search]);

  // Tree view ignores list search/context filters for scale, but still enforces
  // parameter format constraints.
  const treeAttachments = useMemo(() => {
    if (formatsSet.size === 0) return allAttachments;
    return allAttachments.filter((a) => formatsSet.has((a.extension || "").toLowerCase()));
  }, [allAttachments, formatsSet]);

  const handleSelect = (id) => {
    const isMulti = fileCount !== "single";
    let nextIds;
    if (isMulti) {
      nextIds = selectedIds.includes(id)
        ? selectedIds.filter((x) => x !== id)
        : [...selectedIds, id];
    } else {
      nextIds = selectedIds.includes(id) ? [] : [id];
    }
    const metas = allAttachments
      .filter((a) => nextIds.includes(a.id))
      .map((a) => ({ id: a.id, name: a.name }));
    onSelect(nextIds, metas);
  };

  const selectedAttachments = useMemo(
    () => allAttachments.filter((a) => selectedIds.includes(a.id)),
    [allAttachments, selectedIds]
  );

  // Group by parent is handled by OmeroAttachmentTreeBrowser
  // For list view, group attachments by their first parent so users can tell where
  // a file lives (e.g. "model.zip attached to my_training_dataset").
  const grouped = useMemo(() => {
    // Sort items before grouping so ordering is consistent within each group
    const sorted = [...attachments];
    sorted.sort((a, b) => {
      let cmp = 0;
      if (sortBy === "name") cmp = (a.name || "").localeCompare(b.name || "");
      else if (sortBy === "date") cmp = (a.date || "").localeCompare(b.date || "");
      else if (sortBy === "size") cmp = (a.size || 0) - (b.size || 0);
      return sortDir === "asc" ? cmp : -cmp;
    });
    const map = new Map();
    sorted.forEach((att) => {
      const p = att.parents && att.parents.length > 0 ? att.parents[0] : null;
      const key = p ? `${p.type}-${p.id}` : "__unlinked__";
      if (!map.has(key)) {
        map.set(key, { parent: p, items: [] });
      }
      map.get(key).items.push(att);
    });
    // Sort: linked groups first (alphabetical by parent name), unlinked last
    const entries = [...map.values()];
    entries.sort((a, b) => {
      if (!a.parent && b.parent) return 1;
      if (a.parent && !b.parent) return -1;
      if (!a.parent && !b.parent) return 0;
      return `${a.parent.type} ${a.parent.name}`.localeCompare(
        `${b.parent.type} ${b.parent.name}`
      );
    });
    return entries;
  }, [attachments, sortBy, sortDir]);

  const lastGroupSignatureRef = useRef("");
  const resetGroupCollapseOnNextLoadRef = useRef(false);
  useEffect(() => {
    const signature = grouped
      .map(({ parent }) => (parent ? `${parent.type}-${parent.id}` : "__unlinked__"))
      .join("|");
    if (!signature) return;

    const isInitialLoad = lastGroupSignatureRef.current === "";
    const shouldResetCollapse = isInitialLoad || resetGroupCollapseOnNextLoadRef.current;
    lastGroupSignatureRef.current = signature;

    if (!shouldResetCollapse) return;

    setCollapsedGroups(new Set());
    resetGroupCollapseOnNextLoadRef.current = false;
  }, [grouped, search]);

  useEffect(() => {
    if (!search.trim()) return;
    setCollapsedGroups(new Set());
  }, [search]);

  const autoColCount = useMemo(() => {
    if (viewportWidth < 1024) return 1;
    if (viewportWidth < 1400) return 2;
    if (viewportWidth < 1800) return 3;
    return 4;
  }, [viewportWidth]);

  const effectiveColCount = colCountMode === "auto" ? autoColCount : colCount;

  // Map colCount (1-4) to Tailwind grid class — all four strings must be spelled out for JIT
  const gridColsClass = { 1: "grid-cols-1", 2: "grid-cols-2", 3: "grid-cols-3", 4: "grid-cols-4" }[effectiveColCount];

  const renderCard = (att) => {
    const selected = selectedIds.includes(att.id);
    const extraParents =
      att.parents?.length > 1
        ? att.parents.slice(1).map((p) => `${p.type}: ${p.name} (ID: ${p.id})`).join(", ")
        : null;
    const tooltipContent = (
      <table className="text-xs border-separate border-spacing-x-2">
        <tbody>
          {[
            ["File", att.name],
            ["Annotation ID", att.id],
            att.file_id != null && ["File ID", att.file_id],
            att.owner && ["Owner", att.owner],
            att.linked_by && ["Linked by", att.linked_by],
            att.date && ["On", att.date.slice(0, 10)],
            att.description && ["Description", att.description],
            att.ns && ["Namespace", att.ns],
            att.mimetype && ["Mimetype", att.mimetype],
            extraParents && ["Also in", extraParents],
          ]
            .filter(Boolean)
            .map(([label, value]) => (
              <tr key={label}>
                <td className="text-blue-200 whitespace-nowrap align-top">{label}</td>
                <td className="opacity-90 max-w-[220px] break-words pl-2">{String(value)}</td>
              </tr>
            ))}
        </tbody>
      </table>
    );
    return (
      <Tooltip key={att.id} content={tooltipContent} placement="auto" hoverOpenDelay={350}>
        <div
          className={`rounded border px-2 py-1.5 cursor-pointer transition-colors ${
            selected
              ? "bg-blue-50 border-blue-400 ring-1 ring-blue-300"
              : "border-bp-border hover:border-blue-200 hover:bg-bp-surface"
          }`}
          onClick={() => handleSelect(att.id)}
        >
          {/* row 1: icon + truncated name + tick */}
          <div className="flex items-center gap-1.5 min-w-0 mb-0.5">
            <Icon icon={getFileIcon(att.extension)} size={12} className="bp5-text-muted shrink-0" />
            <span className="text-xs truncate flex-1 min-w-0">{att.name}</span>
            {selected && <Icon icon="tick-circle" size={11} className="text-blue-500 shrink-0" />}
          </div>
          {/* row 2: date + size */}
          <div className="flex items-center justify-between gap-1">
            <span className="text-xs bp5-text-muted">
              {att.date ? att.date.slice(0, 10) : ""}
            </span>
            <span className="text-xs bp5-text-muted tabular-nums">
              {att.size != null ? formatBytes(att.size) : ""}
            </span>
          </div>
        </div>
      </Tooltip>
    );
  };

  const emptyState = (
    <NonIdealState
      icon="document"
      title="No attachments found"
      description={
        activeContextFilters.length > 0
          ? "No attachments matched your selected input data (datasets, plates, screens, or images)."
          : search
          ? `No files matching "${search}".`
          : formats.length > 0
          ? `No files with extension ${formats.join(", ")} found in this group.`
          : "No file attachments found in this group."
      }
    />
  );

  const listPanel = (
    <div className="flex flex-col gap-2 mt-1">
      <div className="flex items-center gap-1.5">
        <InputGroup
          leftIcon="search"
          placeholder="Search attachments..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          rightElement={search ? <Button minimal icon="cross" small onClick={() => setSearch("")} /> : undefined}
          className="flex-1"
          small
        />
        {dialogContext.length > 0 && (
          <Tooltip
            content={activeContextFilters.length > 0 && attachments.length === 0
              ? search.trim()
                ? "No attachments match the current input filter plus your search. Turn off the input filter to search across attachments from all your projects, datasets, screens, plates, and images."
                : "No attachments matched the current input filter. Turn off the input filter to see attachments from all your projects, datasets, screens, plates, and images."
              : activeContextFilters.length > 0
              ? "Filtered to your selected input data (datasets, plates, screens, or images). Click to show all attachments."
              : "Show only attachments linked to your selected input data (datasets, plates, screens, or images)."}
            hoverOpenDelay={300}
            isOpen={activeContextFilters.length > 0 && attachments.length === 0 ? true : undefined}
            usePortal={false}
          >
            <Button
              small
              icon="filter"
              text={activeContextFilters.length > 0 ? "Input Filter ON" : "Input Filter OFF"}
              intent={activeContextFilters.length > 0 && attachments.length === 0 ? "warning" : activeContextFilters.length > 0 ? "primary" : "none"}
              outlined={activeContextFilters.length === 0}
              active={activeContextFilters.length > 0}
              onClick={() => {
                resetGroupCollapseOnNextLoadRef.current = true;
                if (activeContextFilters.length > 0) {
                  setActiveContextFilters([]);
                } else {
                  setActiveContextFilters(dialogContext);
                }
              }}
            />
          </Tooltip>
        )}
        <Popover
          content={
            <Menu>
              <MenuDivider title="Sort" />
              {[["name", "Name"], ["date", "Date"], ["size", "Size"]].map(([field, label]) => (
                <MenuItem
                  key={field}
                  text={`${label}${sortBy === field ? (sortDir === "asc" ? " ↑" : " ↓") : ""}`}
                  active={sortBy === field}
                  onClick={() => {
                    if (sortBy === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
                    else { setSortBy(field); setSortDir("asc"); }
                  }}
                />
              ))}
              <MenuDivider title="Columns" />
              <MenuItem
                text={`Auto (${autoColCount} by viewport)`}
                icon="automatic-updates"
                active={colCountMode === "auto"}
                onClick={() => setColCountMode("auto")}
              />
              {[1, 2, 3, 4].map((n) => (
                <MenuItem
                  key={n}
                  text={`${n} column${n > 1 ? "s" : ""}`}
                  active={colCountMode === "manual" && colCount === n}
                  onClick={() => {
                    setColCountMode("manual");
                    setColCount(n);
                  }}
                />
              ))}
            </Menu>
          }
          placement="bottom-end"
        >
          <Button minimal small icon="settings" />
        </Popover>
        <Button minimal icon="refresh" small loading={loading} onClick={() => loadAttachments(true)} />
      </div>

      <div className="flex flex-col gap-0 max-h-[40vh] overflow-y-auto">
        {attachments.length === 0
          ? emptyState
          : grouped.map(({ parent, items }) => {
            const groupKey = parent
              ? `${parent.type}-${parent.id}`
              : "__unlinked__";
            const groupLabel = parent
              ? `${parent.type}: ${parent.name} (ID: ${parent.id})`
              : "Unlinked";
            const groupIcon = parent
              ? parent.type === "Project"
                ? "projects"
                : parent.type === "Dataset"
                ? "database"
                : parent.type === "Plate"
                ? "grid-view"
                : parent.type === "Screen"
                ? "layers"
                : parent.type === "Image"
                ? "media"
                : "folder-close"
              : "ungroup-objects";
            return (
              <div key={groupKey}>
                <button
                  type="button"
                  className="flex items-center gap-1 px-1 py-1 text-xs font-semibold bp5-text-muted uppercase tracking-wide sticky top-0 z-10 bg-bp-surface border-b border-bp-border w-full text-left hover:bg-bp-surface"
                  onClick={() =>
                    setCollapsedGroups((prev) => {
                      const next = new Set(prev);
                      if (next.has(groupKey)) next.delete(groupKey);
                      else next.add(groupKey);
                      return next;
                    })
                  }
                >
                  <Icon icon={groupIcon} size={11} className="shrink-0" />
                  <span className="truncate">{groupLabel}</span>
                  <span className="ml-auto font-normal normal-case bp5-text-muted flex items-center gap-1">
                    {items.length}
                    <Icon icon={collapsedGroups.has(groupKey) ? "chevron-right" : "chevron-down"} size={10} />
                  </span>
                </button>
                {!collapsedGroups.has(groupKey) && (
                  <div className={`grid ${gridColsClass} gap-1.5 p-1`}>{items.map(renderCard)}</div>
                )}
              </div>
            );
          })}
      </div>
    </div>
  );

  const treePanel = (
    <div className="mt-1">
      <div className="flex justify-end mb-1">
        <Button minimal icon="refresh" small loading={loading} onClick={() => loadAttachments(true)} />
      </div>
      <div className="max-h-[32vh] overflow-y-auto">
        <OmeroAttachmentTreeBrowser
          selectedIds={selectedIds}
          onSelect={(ids) => {
              const metas = allAttachments
                .filter((a) => ids.includes(a.id))
                .map((a) => ({ id: a.id, name: a.name }));
              onSelect(ids, metas);
            }}
          fileCount={fileCount}
          allAttachments={treeAttachments}
        />
      </div>
    </div>
  );

  return (
    <div className="flex flex-col gap-2">
      {/* Error */}
      {error && (
        <div className="flex items-center gap-1 text-red-600 text-sm">
          <Icon icon="error" size={14} />
          {error}
        </div>
      )}

      {/* Selection summary — show actual filenames as removable tags */}
      {selectedIds.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          {selectedAttachments.map((att) => {
            const extraParents =
              att.parents?.length > 1
                ? att.parents.slice(1).map((p) => `${p.type}: ${p.name} (ID: ${p.id})`).join(", ")
                : null;
            const ttContent = (
              <table className="text-xs border-separate border-spacing-x-2">
                <tbody>
                  {[
                    ["File", att.name],
                    ["Annotation ID", att.id],
                    att.file_id != null && ["File ID", att.file_id],
                    att.owner && ["Owner", att.owner],
                    att.linked_by && ["Linked by", att.linked_by],
                    att.date && ["On", att.date.slice(0, 10)],
                    att.description && ["Description", att.description],
                    att.ns && ["Namespace", att.ns],
                    att.mimetype && ["Mimetype", att.mimetype],
                    extraParents && ["Also in", extraParents],
                  ]
                    .filter(Boolean)
                    .map(([label, value]) => (
                      <tr key={label}>
                        <td className="text-blue-200 whitespace-nowrap align-top">{label}</td>
                        <td className="opacity-90 max-w-[220px] break-words pl-2">{String(value)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            );
            return (
              <Tooltip
                key={att.id}
                content={ttContent}
                placement="top"
                hoverOpenDelay={300}
              >
                <Tag
                  intent="primary"
                  minimal
                  icon="tick-circle"
                  onRemove={() => {
                    const nextIds = selectedIds.filter((id) => id !== att.id);
                    const metas = allAttachments
                      .filter((a) => nextIds.includes(a.id))
                      .map((a) => ({ id: a.id, name: a.name }));
                    onSelect(nextIds, metas);
                  }}
                >
                  <span className="max-w-[180px] truncate inline-block align-bottom text-xs leading-none">
                    {att.name}
                  </span>
                </Tag>
              </Tooltip>
            );
          })}
          {selectedIds.length > 1 && (
            <Button minimal small icon="cross" onClick={() => onSelect([], [])} title="Clear all" />
          )}
        </div>
      )}

      {/* Content — spinner or tabs */}
      {loading ? (
        <div className="flex justify-center py-4">
          <Spinner size={20} />
        </div>
      ) : (
        <Tabs
          id="omero-attachment-browser-tabs"
          selectedTabId={viewMode}
          onChange={(id) => setViewMode(id)}
          renderActiveTabPanelOnly={false}
        >
          <Tab
            id="list"
            title={
              <span className="flex items-center gap-1">
                <Icon icon="list" size={12} />
                List
              </span>
            }
            panel={listPanel}
          />
          <Tab
            id="tree"
            title={
              <span className="flex items-center gap-1">
                <Icon icon="diagram-tree" size={12} />
                Tree
              </span>
            }
            panel={treePanel}
          />
        </Tabs>
      )}
    </div>
  );
};

function getFileIcon(extension) {
  const ext = (extension || "").toLowerCase();
  if (["csv", "tsv", "xlsx", "xls", "ods"].includes(ext)) return "th";
  if (["png", "jpg", "jpeg", "tif", "tiff", "bmp", "gif", "svg"].includes(ext)) return "media";
  if (["zip", "tar", "gz", "bz2", "7z", "rar"].includes(ext)) return "box";
  if (["h5", "hdf5", "zarr", "db", "sqlite"].includes(ext)) return "database";
  if (["txt", "log", "md", "rst"].includes(ext)) return "document";
  if (["json", "xml", "yaml", "yml", "toml", "ini", "cfg"].includes(ext)) return "code";
  if (["py", "js", "ts", "sh", "r", "m"].includes(ext)) return "code";
  if (["pdf"].includes(ext)) return "book";
  if (["pt", "pth", "pkl", "npy", "npz", "onnx", "weights", "model"].includes(ext)) return "cube";
  return "paperclip";
}

function formatBytes(bytes) {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default OmeroAttachmentBrowser;
