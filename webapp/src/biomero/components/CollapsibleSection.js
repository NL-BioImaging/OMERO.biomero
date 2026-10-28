import React, { useState } from "react";
import { Collapse, Button, H5, H6, Icon, Tag, Tooltip } from "@blueprintjs/core";
import DocumentationLink from "./DocumentationLink";

const CollapsibleSection = ({ title, children, versionSummary, versionCheckLoading, onRefresh, errorCount, nested, documentation }) => {
  const [isOpen, setIsOpen] = useState(false);
  const TitleTag = nested ? H6 : H5;

  return (
    <div className={nested ? "ml-2 pl-3 border-l-2 border-bp-border my-1" : ""}>
      <div className="flex items-center justify-between">
        <TitleTag className="flex items-center cursor-pointer" onClick={() => setIsOpen(!isOpen)}>
          <Icon
            icon={isOpen ? "chevron-down" : "chevron-right"}
            className="mr-2"
          />
          <span>{title}</span>
          {/* Validation error count tag — same style as version warning tags */}
          {errorCount > 0 && (
            <Tooltip content="Expand this section to see and fix the validation errors">
              <Tag minimal intent="danger" className="ml-2">
                {errorCount} validation error{errorCount !== 1 ? 's' : ''}
              </Tag>
            </Tooltip>
          )}
          {/* Version summary for Models Settings */}
          {versionSummary && (
            <span className="ml-2 flex items-center">
              {versionCheckLoading ? (
                <Tag minimal intent="none" className="ml-2">
                  Checking versions...
                </Tag>
              ) : versionSummary.total > 0 ? (
                <>
                  {/* Status unavailable indicator */}
                  {versionSummary.rateLimited > 0 ? (
                    <Tooltip 
                      content={`GitHub API rate limit exceeded. Version status unavailable for ${versionSummary.rateLimited} models.${
                        versionSummary.rateLimitResetTime 
                          ? ` Rate limit resets at ${versionSummary.rateLimitResetTime.toLocaleTimeString()}` 
                          : ''
                      }`}
                    >
                      <Tag minimal intent="warning" className="ml-2">
                        ? / {versionSummary.total}
                      </Tag>
                    </Tooltip>
                  ) : versionSummary.stale > 0 ? (
                    <Tooltip content={`${versionSummary.stale} models showing stale data due to rate limiting`}>
                      <Tag minimal intent="none" className="ml-2 text-orange-500">
                        {versionSummary.upToDate}/{versionSummary.total} up to date (stale)
                      </Tag>
                    </Tooltip>
                  ) : versionSummary.outdated > 0 ? (
                    <Tag minimal intent="warning" className="ml-2">
                      {versionSummary.outdated} update{versionSummary.outdated !== 1 ? 's' : ''} available
                    </Tag>
                  ) : (
                    <Tag minimal intent="success" className="ml-2">
                      {versionSummary.upToDate}/{versionSummary.total} up to date
                    </Tag>
                  )}
                </>
              ) : null}
            </span>
          )}
        </TitleTag>

        <div className="flex items-center gap-1 shrink-0">
          {/* Help and refresh stay outside the clickable title. */}
          {onRefresh && (
            <Tooltip content="Refresh version check (clears cache)">
              <Button
                minimal
                small
                icon="repeat"
                onClick={() => onRefresh()}
                disabled={versionCheckLoading}
              />
            </Tooltip>
          )}
          {documentation && <DocumentationLink {...documentation} />}
        </div>
      </div>
      <Collapse isOpen={isOpen}>
        <div>{children}</div>
      </Collapse>
    </div>
  );
};

export default CollapsibleSection;
