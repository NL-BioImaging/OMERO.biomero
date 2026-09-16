import React, { useState } from "react";
import {
  DialogBody,
  Collapse,
  Button,
  Icon,
  Tag,
  Callout,
  Intent,
  Tooltip,
} from "@blueprintjs/core";
import { useAppContext } from "../../AppContext";
import { WorkflowStepIntro } from "./HistoryFeedback";
import OmeroAttachmentBrowser from "./OmeroAttachmentBrowser";

/**
 * Returns the file-input params from a workflow metadata object.
 * Uses the canonical ``file-attachment`` descriptor flag set by the schema parser.
 */
export function getFileInputParams(workflowMetadata) {
  if (!workflowMetadata?.inputs) return [];
  return workflowMetadata.inputs.filter((p) => p["file-attachment"] === true);
}

/**
 * Returns true when all required (non-optional) file params have a selection.
 * Optional params are always considered satisfied regardless of selection.
 */
export function isFileInputStepValid(workflowMetadata, formData) {
  const params = getFileInputParams(workflowMetadata);
  return params
    .filter((p) => !p.optional)
    .every((p) => {
      const sel = Array.isArray(formData?.[p.id]) ? formData[p.id] : [];
      return sel.length > 0;
    });
}

/**
 * A "param is done" when:
 *   - single file-count → exactly 1 selected
 *   - multiple / unspecified → at least 1 selected
 */
function isParamDone(param, selection) {
  if (selection.length === 0) return false;
  if (param["file-count"] === "single") return selection.length >= 1;
  return selection.length >= 1;
}

const WorkflowFileInputStep = ({ dialogBodyClassName = "" }) => {
  const { state, updateState } = useAppContext();
  const workflowMetadata = state.selectedWorkflow?.metadata;
  const fileParams = getFileInputParams(workflowMetadata);
  const hasRequired = fileParams.some((p) => !p.optional);

  // Track which param's panel is open — only one at a time
  const [openParamId, setOpenParamId] = useState(
    fileParams.length > 0 ? fileParams[0].id : null
  );
  // id→name metadata for the current selection of each param (for accordion bar display)
  const [selectionMeta, setSelectionMeta] = useState({});

  const handleSelect = (param, ids, metas = []) => {
    updateState({
      formData: {
        ...state.formData,
        [param.id]: ids,
      },
    });
    setSelectionMeta((prev) => ({ ...prev, [param.id]: metas }));

    // Auto-advance only for single-file params. Multi-file params stay open
    // so users can select several files without the panel collapsing.
    if (param["file-count"] === "single" && isParamDone(param, ids)) {
      const currentIndex = fileParams.findIndex((p) => p.id === param.id);
      const nextIncomplete = fileParams.slice(currentIndex + 1).find((p) => {
        const sel = Array.isArray(state.formData?.[p.id])
          ? state.formData[p.id]
          : [];
        return !isParamDone(p, sel);
      });
      if (nextIncomplete) {
        setOpenParamId(nextIncomplete.id);
      }
    }
  };

  if (fileParams.length === 0) {
    return (
      <DialogBody className={dialogBodyClassName || undefined}>
        <p className="text-gray-500 text-sm">This workflow has no file attachment inputs.</p>
      </DialogBody>
    );
  }

  return (
    <DialogBody className={dialogBodyClassName || undefined}>
      <WorkflowStepIntro step="the file attachments">
        <span className="text-sm">
          {hasRequired
            ? "Select the OMERO file attachments required by this workflow. Each field is defined by the workflow, and the browser is pre-filtered to the expected file type for that input."
            : "Select any optional OMERO file attachments offered by this workflow. Each field is defined by the workflow, and the browser is pre-filtered to the expected file type for that input."}
        </span>
      </WorkflowStepIntro>

      <Callout intent="primary" compact minimal className="mb-4">
        <span className="text-sm">
          <strong>Input Filter ON</strong> limits browsing to attachments near the data selected in the first step. Turn it off if the file you want to reuse lives elsewhere in OMERO.
        </span>
      </Callout>

      <div className="flex flex-col gap-1">
        {fileParams.map((param) => {
          const formats = Array.isArray(param.format)
            ? param.format
            : param.format ? [param.format] : [];
          const currentSelection = Array.isArray(state.formData[param.id])
            ? state.formData[param.id] : [];
          const done = isParamDone(param, currentSelection);
          const isOpen = openParamId === param.id;

          const headerTooltip = [
            param.description,
            `Type: ${param.type || "file"}`,
            formats.length > 0 && `Accepted formats: ${formats.join(", ")}`,
            param["file-count"] && `Selection: ${param["file-count"]}`,
            param.optional ? "Optional" : "Required",
          ].filter(Boolean).join("\n\n");

          return (
            <div key={param.id} className="border border-gray-200 rounded">
              <Tooltip
                content={<span className="block max-w-sm whitespace-pre-wrap text-xs">{headerTooltip}</span>}
                hoverOpenDelay={250}
                placement="top"
                usePortal={false}
              >
                <Button
                  minimal
                  fill
                  alignText="left"
                  onClick={() => setOpenParamId(isOpen ? null : param.id)}
                  intent={done ? Intent.SUCCESS : Intent.NONE}
                  rightIcon={isOpen ? "chevron-up" : "chevron-down"}
                >
                  <div className="flex flex-col w-full pr-1 py-0.5 gap-0.5">
                    <div className="flex items-center gap-2">
                      <Icon
                        icon={done ? "tick-circle" : "paperclip"}
                        size={14}
                        className={done ? "text-green-500" : "text-gray-400"}
                      />
                      <span className="text-sm font-semibold text-gray-900 flex-1 text-left leading-5">
                        {param.name || param.id}
                      </span>
                      {param.optional
                        ? <span className="text-xs text-gray-400">(optional)</span>
                        : !done && <span className="text-xs text-red-400">required</span>
                      }
                      <Tag minimal round intent="none" className="shrink-0">
                        {param["file-count"] === "single" ? "Select 1" : "Select 1+"}
                      </Tag>
                      {currentSelection.length > 0 && (
                        <Tag minimal round intent={done ? Intent.SUCCESS : Intent.PRIMARY} className="shrink-0">
                          {currentSelection.length}
                        </Tag>
                      )}
                    </div>
                    {(param.description || formats.length > 0 || param["file-count"]) && (
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 ml-5">
                        {param.description && (
                          <span className="text-xs text-gray-500 text-left">{param.description}</span>
                        )}
                        {formats.length > 0 && (
                          <span className="text-xs text-gray-400 italic">Formats: {formats.join(", ")}</span>
                        )}
                        <span className="text-xs text-gray-400 italic">
                          {param["file-count"] === "single" ? "Select exactly one file" : "Select one or more files"}
                        </span>
                      </div>
                    )}
                  </div>
                </Button>
              </Tooltip>

              <Collapse isOpen={isOpen} keepChildrenMounted>
                <div className="px-3 pb-3 pt-1 border-t border-gray-100">
                  <OmeroAttachmentBrowser
                    formats={formats}
                    fileCount={param["file-count"] || null}
                    selectedIds={currentSelection}
                    onSelect={(ids, metas) => handleSelect(param, ids, metas)}
                  />
                </div>
              </Collapse>
            </div>
          );
        })}
      </div>
    </DialogBody>
  );
};

export default WorkflowFileInputStep;
