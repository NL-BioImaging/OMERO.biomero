import React, { useState, useEffect, useRef } from "react";
import { useAppContext } from "../AppContext";
import TabContainer from "./components/TabContainer";
import RunPanel from "./components/RunPanel";
import GroupSelect from "../shared/components/GroupSelect"; // Add this import
import SlurmStatusIndicator from "../shared/components/SlurmStatusIndicator";
import { Tabs, Tab, H4, Tooltip, H6 } from "@blueprintjs/core";
import "@blueprintjs/core/lib/css/blueprint.css";
import SettingsForm from "./components/SettingsForm";

const RunTab = ({ onWorkflowError }) => (
  <div className="max-h-[calc(100vh-225px)] overflow-y-auto">
    <H4>Run image analysis workflows</H4>
    <div className="flex">
      <div className="w-full p-4 flex-1">
        <RunPanel onWorkflowError={onWorkflowError} />
      </div>
    </div>
    <H6>
      Powered by{" "}
      <a
        href="https://github.com/NL-BioImaging/biomero"
        target="_blank"
        rel="noopener noreferrer"
      >
        BIOMERO.analyzer
      </a>.
    </H6>
    <div className="bp5-form-group">
        <div className="bp5-form-content">
          <div className="bp5-form-helper-text">
            If you use this software in your work, please cite it using the following metadata:
          </div>      
          <div className="bp5-form-helper-text">
            Luik, T. T., Rosas-Bertolini, R., Reits, E. A., Hoebe, R. A., & Krawczyk, P. M. (2024). BIOMERO: A scalable and extensible image analysis framework. Patterns, 5(8). <a
              href="https://doi.org/10.1016/j.patter.2024.101024"
              target="_blank"
              rel="noopener noreferrer"
            >https://doi.org/10.1016/j.patter.2024.101024</a>
          </div>
        </div>
      </div>
  </div>
);

const AdminPanel = () => {
  const { state, loadScripts } = useAppContext();
  const [scriptsLoaded, setScriptsLoaded] = useState(false);
  useEffect(() => {
    if (!scriptsLoaded) {
      loadScripts();
      setScriptsLoaded(true); // Prevent reloading if already loaded
    }
  }, []);

  return (
    <div className="max-h-[calc(100vh-225px)] overflow-y-auto">
      <H4>Admin</H4>
      <div className="flex">
        <div className="w-1/2 p-4 max-h-[calc(100vh-250px)] overflow-y-auto">
          <SettingsForm />
        </div>
        <div className="w-1/2 p-4 flex flex-col">
          {state.scripts?.length > 0 ? (
            <TabContainer />
          ) : (
            <p>Loading scripts...</p>
          )}
        </div>
      </div>
    </div>
  );
};

const StatusPanel = ({
  iframeUrl,
  metabaseError,
  setMetabaseError,
  isAdmin,
  metabaseUrl,
}) => {
  const iframeRef = useRef(null);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    const onLoad = () => {
      try {
        const doc = iframe.contentWindow.document;

        doc.addEventListener("click", (e) => {
          const a = e.target.closest("a");
          if (a && a.href) {
            try {
              const url = new URL(a.href);
              if (url.hostname === window.location.hostname) {
                window.top.location.href = a.href;
                e.preventDefault();
              }
            } catch (_) {
              // ignore invalid URLs
            }
          }
        });
      } catch (err) {
        console.warn("Could not attach click handler to iframe:", err);
      }
    };

    iframe.addEventListener("load", onLoad);

    return () => {
      iframe.removeEventListener("load", onLoad);
    };
  }, [iframeUrl]);

  return (
    <div className="max-h-[calc(100vh-225px)] overflow-y-auto">
      <H4>Status</H4>
      <div className="bp5-form-group">
        <div className="bp5-form-content">
          <div className="bp5-form-helper-text">
            View your active BIOMERO workflow progress, or browse some
            historical data, here on this dashboard.
          </div>
          <div className="bp5-form-helper-text">
            Tip: When a workflow is <b>DONE</b>, you can find your result images
            (if any) by pasting the <b>Workflow ID</b> in OMERO's search bar at
            the top of your screen.
          </div>
        </div>
      </div>
      <div className="p-4">
        {!metabaseError ? (
          <iframe
            title="Metabase dashboard"
            src={iframeUrl}
            className="w-full h-[800px]"
            ref={iframeRef}
            onError={() => setMetabaseError(true)}
          />
        ) : (
          <div className="error">
            Error loading Metabase dashboard. Please try refreshing the page.
          </div>
        )}
        {isAdmin && (
          <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded">
            <a href={metabaseUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:text-blue-800">
              Click here to access the Metabase interface
            </a>
          </div>
        )}
      </div>
    </div>
  );
};

const BiomeroApp = () => {
  const {
    state,
    updateState,
    loadOmeroTreeData,
    loadFolderData,
    loadGroups,
    loadWorkflows,
  } = useAppContext();
  const [metabaseError, setMetabaseError] = useState(false);
  const [activeTab, setActiveTab] = useState("Run");
  const [workflowError, setWorkflowError] = useState(false);
  const [loadedTabs, setLoadedTabs] = useState({
    Run: true, // Automatically load the first tab
    Admin: false,
    Status: false,
  });

  // Loading states for each API call
  const [loadingOmero, setLoadingOmero] = useState(false);

  useEffect(() => {
    if (!loadingOmero) {
      setLoadingOmero(true);
      loadOmeroTreeData()
        .then(() => {
          setLoadingOmero(false);
        })
        .catch(() => {
          setLoadingOmero(false);
        });
    }

    loadFolderData();
    loadGroups();
    loadWorkflows();

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // called only once

  const handleTabChange = (newTabId) => {
    if (!loadedTabs[newTabId]) {
      setLoadedTabs((prevState) => ({ ...prevState, [newTabId]: true }));
    }
    setActiveTab(newTabId);
  };

  const handleWorkflowError = () => {
    setWorkflowError(prev => !prev); // Toggle to trigger useEffect
  };

  const metabaseUrl = document
    .getElementById("root")
    .getAttribute("data-metabase-url");
  const metabaseToken = document
    .getElementById("root")
    .getAttribute("data-metabase-token-monitor-workflows");
  const isAdmin =
    document.getElementById("root").getAttribute("data-is-admin") === "true";
  const iframeUrl = `${metabaseUrl}/embed/dashboard/${metabaseToken}#bordered=true&titled=true&refresh=20`;

  return (
    <div>
      <div className="p-4">
        {state?.user?.groups && (
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <span className="text-base mr-4">Select group</span>
              <GroupSelect />
            </div>
            <SlurmStatusIndicator 
              onTabChange={activeTab} 
              onWorkflowError={workflowError}
            />
          </div>
        )}
      </div>

      {/* Tabs with Panels */}
      <div className="p-4 h-full overflow-hidden">
        <Tabs
          id="app-tabs"
          className="h-full"
          animate={true}
          renderActiveTabPanelOnly={false}
          large={true}
          selectedTabId={activeTab}
          onChange={handleTabChange}
        >
          <Tab
            id="Run"
            title="Run"
            icon="play"
            panel={loadedTabs.Run ? <RunTab state={state} onWorkflowError={handleWorkflowError} /> : null}
          />
          <Tab
            id="Status"
            title={
              <Tooltip
                content={<span>View your workflow's progress here</span>}
                compact={true}
                isOpen={state.workflowStatusTooltipShown}
                intent="success"
                onOpened={() => {
                  setTimeout(() => {
                    updateState({ workflowStatusTooltipShown: false });
                  }, 5000);
                }}
              >
                <span className="pointer-events-none select-none focus:outline-none">
                  Status
                </span>
              </Tooltip>
            }
            icon="dashboard"
            panel={
              loadedTabs.Status ? (
                <StatusPanel
                  iframeUrl={iframeUrl}
                  metabaseError={metabaseError}
                  setMetabaseError={setMetabaseError}
                  isAdmin={isAdmin}
                  metabaseUrl={metabaseUrl}
                />
              ) : null
            }
          />
          {/* Admin tab */}
          {state.user.isAdmin && (
            <Tab
              id="Admin"
              title="Admin"
              icon="settings"
              panel={loadedTabs.Admin ? <AdminPanel /> : null}
            />
          )}
        </Tabs>
      </div>
    </div>
  );
};

export default BiomeroApp;
