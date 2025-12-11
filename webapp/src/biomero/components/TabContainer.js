import React, { useState, useEffect } from "react";
import { useAppContext } from "../../AppContext";
import ScriptCardGroup from "./ScriptCardGroup";
import SearchBar from "./SearchBar";
import UploadButton from "./UploadButton";
import { getDjangoConstants } from "../../constants";
import { Tabs, Tab } from "@blueprintjs/core";
import "@blueprintjs/core/lib/css/blueprint.css";

const TabContainer = () => {
  const { user } = getDjangoConstants();
  const { state } = useAppContext();
  const [searchQuery, setSearchQuery] = useState("");
  const [filteredData, setFilteredData] = useState(state.scripts);
  const [hasWritePrivileges, setHasWritePrivileges] = useState(false);
  const [openSectionsPerTab, setOpenSectionsPerTab] = useState({}); // Track open section per tab

  useEffect(() => {
    setHasWritePrivileges(user.isAdmin);
  }, [user.isAdmin]);

  useEffect(() => {
    const filteredByAdmin = state.scripts
      .map((folder) => ({
        ...folder,
        ul: folder.ul
          ?.map((group) => {
            if (group.name.toLowerCase().includes("admin") && !user.isAdmin)
              return null;
            return group;
          })
          .filter(Boolean),
      }))
      .filter((folder) => folder.ul?.length > 0);

    const lowerCaseQuery = searchQuery.trim().toLowerCase();
    const filtered = filteredByAdmin
      .map((folder) => ({
        ...folder,
        ul: folder.ul
          ?.map((group) => ({
            ...group,
            ul: group.ul?.filter((script) =>
              script.name.toLowerCase().includes(lowerCaseQuery)
            ),
          }))
          .filter((group) => group.ul?.length > 0),
      }))
      .filter((folder) => folder.ul?.length > 0);

    setFilteredData(filtered);
  }, [searchQuery, state.scripts, user.isAdmin]);

  // Initialize open sections - auto-open admin sections or first section per tab
  useEffect(() => {
    if (filteredData.length > 0) {
      const initialOpenSections = {};
      filteredData.forEach(folder => {
        if (folder.ul && folder.ul.length > 0) {
          // Find admin section or use first section
          const adminSection = folder.ul.find(group => 
            group.name.toLowerCase().includes("admin")
          );
          const sectionToOpen = adminSection || folder.ul[0];
          const folderId = `${folder.name}-${sectionToOpen.name}`;
          initialOpenSections[folder.name] = folderId;
        }
      });
      setOpenSectionsPerTab(initialOpenSections);
    }
  }, [filteredData]);

  const renderScripts = (folder) => {
    const tabKey = folder.name;
    
    return (
      <div className="folders-list">
        {folder.ul?.map((group) => {
          const folderId = `${folder.name}-${group.name}`;
          const isOpen = openSectionsPerTab[tabKey] === folderId;
          
          return (
            <ScriptCardGroup 
              key={group.name} 
              folder={group} 
              folderId={folderId}
              isOpen={isOpen}
              onToggle={(folderId) => {
                setOpenSectionsPerTab(prev => ({
                  ...prev,
                  [tabKey]: prev[tabKey] === folderId ? null : folderId
                }));
              }}
            />
          );
        })}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full">
      {/* Static controls - always visible, non-scrollable */}
      <div className="flex-shrink-0 mb-4">
        <div className="tab-controls flex justify-between items-center">
          <div className="tab-right-controls flex space-x-4">
            <SearchBar
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
            />
            {hasWritePrivileges && <UploadButton />}
          </div>
        </div>
      </div>

      {/* Tabs with static headers and scrollable content */}
      <div className="flex-1 overflow-hidden">
        <Tabs
          id="script-tabs"
          renderActiveTabPanelOnly={false}
          animate={true}
          large={true}
          className="h-full flex flex-col"
        >
          {filteredData.map((folder) => (
            <Tab
              key={folder.name}
              id={folder.name}
              title={folder.name}
              tagContent={folder.ul?.reduce(
                (sum, group) => sum + (group.ul?.length || 0),
                0
              )}
              tagProps={{ round: true }}
              panel={
                <div className="h-full overflow-y-auto p-4">
                  {renderScripts(folder)}
                </div>
              }
            />
          ))}
        </Tabs>
      </div>
    </div>
  );
};

export default TabContainer;
