import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  Callout,
  Card,
  H3,
  InputGroup,
  Spinner,
} from "@blueprintjs/core";

import { useAppContext } from "../AppContext";
import OmeroDataBrowser from "../shared/components/OmeroDataBrowser";
import AnalysisLaunchOptions from "./AnalysisLaunchOptions";
import {
  buildAnalysisUrl,
  isAnalysisMessage,
  parseAnalysisLaunch,
  postAnalysisTheme,
  sourceFromTreeItems,
} from "../analysisIntegration";

const DataAnalysisApp = ({ theme = "light" }) => {
  const { state, updateState, loadOmeroTreeData } = useAppContext();
  const [source, setSource] = useState(() =>
    parseAnalysisLaunch(window.location.search)
  );
  const [query, setQuery] = useState("");
  const [iframeRevision, setIframeRevision] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [ready, setReady] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);
  const iframeRef = useRef(null);

  const { ui, urls } = state;
  useEffect(() => {
    if (!source && ui.data_analysis_available && !state.omeroFileTreeData) {
      loadOmeroTreeData();
    }
    // AppContext actions are recreated with provider state; the data guard makes
    // this intentionally depend only on the source and loaded tree state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, state.omeroFileTreeData, ui.data_analysis_available]);

  const selectedItems = (state.omeroFileTreeSelection || [])
    .map((id) => state.omeroFileTreeData?.[id])
    .filter(Boolean);
  const selectedResult = sourceFromTreeItems(selectedItems);
  const searchResults = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return [];
    return Object.values(state.omeroFileTreeData || {})
      .filter((item) => {
        const category = String(item.category || "").replace(/s$/, "");
        return (
          ["dataset", "screen", "plate", "image"].includes(category) &&
          String(item.data || "").toLowerCase().includes(normalized)
        );
      })
      .slice(0, 20);
  }, [query, state.omeroFileTreeData]);

  const selectTreeNode = (nodeData, _coords, event = {}) => {
    const nodeId = nodeData.id;
    const item = state.omeroFileTreeData?.[nodeId];
    if (!item) return;
    const category = String(item.category || "").replace(/s$/, "");
    const mayExtend =
      ["image", "plate"].includes(category) &&
      (event.ctrlKey || event.metaKey);
    const current = state.omeroFileTreeSelection || [];
    const next = mayExtend
      ? current.includes(nodeId)
        ? current.filter((id) => id !== nodeId)
        : [...current, nodeId]
      : [nodeId];
    updateState({ omeroFileTreeSelection: next });
  };

  const selectSearchResult = (item) => {
    updateState({ omeroFileTreeSelection: [item.index] });
    setQuery("");
  };

  const changeSource = () => {
    if (
      dirty &&
      !window.confirm("Analysis has unsaved editor changes. Change source anyway?")
    ) {
      return;
    }
    setSource(null);
    setDirty(false);
    setReady(false);
    updateState({ omeroFileTreeSelection: [] });
  };

  const reloadAnalysis = () => {
    if (
      dirty &&
      !window.confirm("Analysis has unsaved editor changes. Reload anyway?")
    ) {
      return;
    }
    setReady(false);
    setSessionExpired(false);
    setIframeRevision((value) => value + 1);
  };

  const embeddedUrl = buildAnalysisUrl(urls.data_analysis, source, true);
  const standaloneUrl = buildAnalysisUrl(urls.data_analysis, source, false);

  useEffect(() => {
    const onMessage = (event) => {
      if (!isAnalysisMessage(event, iframeRef.current?.contentWindow)) return;
      const { type, payload } = event.data;
      if (type === "ready") {
        setReady(true);
        postAnalysisTheme(iframeRef.current?.contentWindow, theme);
      }
      if (type === "dirty-state-changed") setDirty(Boolean(payload.dirty));
      if (type === "source-title-changed" && payload.title) {
        setSource((current) =>
          current ? { ...current, title: String(payload.title) } : current
        );
      }
      if (type === "request-open-new-tab") {
        window.open(standaloneUrl, "_blank", "noopener");
      }
      if (type === "session-expired") setSessionExpired(true);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [standaloneUrl, theme]);

  useEffect(() => {
    if (ready) postAnalysisTheme(iframeRef.current?.contentWindow, theme);
  }, [ready, theme]);

  if (!ui.data_analysis_available) {
    return (
      <div className="p-6">
        <Callout intent="danger" title="Data Analysis is unavailable">
          {ui.data_analysis_error ||
            "OMERO.Analysis is not available in this OMERO.web deployment."}
        </Callout>
      </div>
    );
  }

  if (!source) {
    return (
      <div className="p-6 max-w-5xl mx-auto overflow-y-auto h-[calc(100vh-85px)]">
        <H3>Choose data for Analysis</H3>
        <p className="mb-4 text-gray-600">
          Select a Dataset, Screen, Plate, or Image. Hold Ctrl or Command to
          select multiple Images or Plates of the same type. Expand the
          +AnalysisWorkspaces Project and select a managed Dataset to resume it.
        </p>
        <InputGroup
          leftIcon="search"
          placeholder="Search loaded OMERO sources"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {searchResults.length > 0 && (
          <Card className="my-2 max-h-52 overflow-y-auto">
            {searchResults.map((item) => (
              <Button
                key={item.index}
                minimal
                fill
                alignText="left"
                text={`${item.data} (${String(item.category).replace(/s$/, "")})`}
                onClick={() => selectSearchResult(item)}
              />
            ))}
          </Card>
        )}
        <Card className="my-4 max-h-[52vh] overflow-y-auto">
          {state.omeroFileTreeData ? (
            <OmeroDataBrowser onSelectCallback={selectTreeNode} />
          ) : (
            <Spinner />
          )}
        </Card>
        <AnalysisLaunchOptions
          baseUrl={urls.data_analysis}
          source={selectedResult.source}
          selectionError={selectedResult.error}
          onOpen={setSource}
        />
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-85px)] flex flex-col bg-white">
      <div className="h-[48px] px-3 border-b flex items-center gap-2 bg-gray-50">
        <strong className="truncate flex-1">{source.title}</strong>
        <span className="text-gray-500">{source.type} {source.id}</span>
        {!ready && <Spinner size={16} />}
        {dirty && <span className="text-amber-700">Unsaved changes</span>}
        <Button
          minimal
          icon="exchange"
          text="Change source"
          onClick={changeSource}
        />
        <Button minimal icon="refresh" text="Reload" onClick={reloadAnalysis} />
        <Button
          minimal
          icon="share"
          text="Open in new tab"
          onClick={() => window.open(standaloneUrl, "_blank", "noopener")}
        />
      </div>
      {sessionExpired && (
        <Callout intent="danger" title="OMERO session expired">
          Sign in again, then reload Data Analysis.
        </Callout>
      )}
      <iframe
        key={iframeRevision}
        ref={iframeRef}
        title="OMERO Data Analysis"
        src={embeddedUrl}
        className="border-0 w-full flex-1 min-h-0"
      />
    </div>
  );
};

export default DataAnalysisApp;
