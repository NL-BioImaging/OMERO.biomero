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

  const renderScripts = (folder) => (
    <div className="folders-list">
      {folder.ul?.map((group) => (
        <ScriptCardGroup key={group.name} folder={group} />
      ))}
    </div>
  );

  return (
    <div className="tab-container h-full">
      <div className="tab-controls flex justify-between items-center mb-4">
        <div className="tab-right-controls flex space-x-4">
          <SearchBar
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
          />
          {hasWritePrivileges && <UploadButton />}
        </div>
      </div>

      {/* Tabs with Panels */}
      <Tabs
        id="script-tabs"
        renderActiveTabPanelOnly={false}
        animate={true}
        large={true}
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
              <div className="p-4 max-h-[calc(100vh-300px)] overflow-y-auto">
                {renderScripts(folder)}
              </div>
            }
          />
        ))}
      </Tabs>
    </div>
  );
};

export default TabContainer;
