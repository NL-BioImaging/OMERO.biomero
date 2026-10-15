import React, { useState, useEffect } from "react";
import {
  Card,
  Button,
  FormGroup,
  InputGroup,
  Tooltip,
  Icon,
  H4,
  ButtonGroup,
  Switch,
  Spinner,
} from "@blueprintjs/core";
import { FaDocker } from "react-icons/fa6";
import { fetchContainerImage } from "../../apiService";
import { RuntimeIcon, SlurmInitIcon } from "./SettingsForm";

/** No Slurm Init needed — save and it applies to new submissions immediately. */
// RuntimeIcon and SlurmInitIcon are imported from SettingsForm

const ModelCard = ({
  item,
  index,
  onChange,
  onAddParam,
  onDelete,
  onReset,
  onRepoBlur,
  editable,
  setEditable,
  errors,
  validateField,
  versionStatus,
  versionCheckLoading,
  descriptorMeta,
  config,
  gpuSettings,  // { gpu_partition, gpu_gres, gpu_gpus } from SLURM settings
  globalJobParams, // { sbatchParams, defaultPartition } from SLURM settings
}) => {
  const hasScriptRepo = !!config?.SLURM?.slurm_script_repo;
  const supportsPlates = (item.isPlateWorkflow || false) || descriptorMeta?.requiresPlate === true;
  const [inputValue, setInputValue] = useState("");
  const [showWarning, setShowWarning] = useState(false);
  const [containerImage, setContainerImage] = useState(null);

  // Fetch container image on mount only (for cards loaded from saved config).
  // NOT on every repo change — that fires per keystroke and hammers GitHub.
  // Updates happen via fetchContainerImageOnBlur when the user finishes editing.
  useEffect(() => {
    if (item.repo && item.repo.includes('github.com/') && item.repo.includes('/tree/v')) {
      fetchContainerImage(item.repo).then(img => setContainerImage(img || null));
    } else {
      setContainerImage(null);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch container image from descriptor.json — only on blur, only for versioned GitHub URLs
  // (avoids 404 storms while typing and avoids fetching unresolvable refs)
  const fetchContainerImageOnBlur = (repoUrl) => {
    if (repoUrl && repoUrl.includes('github.com/') && repoUrl.includes('/tree/v')) {
      fetchContainerImage(repoUrl).then(img => setContainerImage(img || null));
    } else {
      setContainerImage(null);
    }
  };

  // Helper function to update GitHub URL with new version
  const updateToLatestVersion = () => {
    if (!versionStatus?.latestVersion || !item.repo) return;

    // Extract the base URL (before /tree/...) and any file-path suffix after
    // the branch tag, so that direct descriptor URLs like
    //   .../tree/v0.0.3/descriptor.json  →  .../tree/v1.0.0/descriptor.json
    // are preserved correctly while plain tree URLs work as before.
    const treeMatch = item.repo.match(/^(.*?)\/tree\/[^\/]+(\/.*)?$/);
    let newUrl;
    if (treeMatch) {
      const baseUrl = treeMatch[1].replace(/\/+$/, '');
      const fileSuffix = treeMatch[2] || '';          // e.g. '/descriptor.json' or ''
      newUrl = `${baseUrl}/tree/${versionStatus.latestVersion}${fileSuffix}`;
    } else {
      // Fallback: plain repo URL, just append the new tree ref
      const baseUrl = item.repo.replace(/\/+$/, '');
      newUrl = `${baseUrl}/tree/${versionStatus.latestVersion}`;
    }
    
    // Update the versionStatus first to preserve justUpdated flag
    if (versionStatus) {
      versionStatus.justUpdated = true;
      versionStatus.status = 'up-to-date';
      versionStatus.currentVersion = versionStatus.latestVersion;
    }
    
    // Use a flag to prevent automatic recheck for this change
    onChange(index, "repo", newUrl, { skipVersionCheck: true });
  };
  // Determine if there's an actionable version issue (outdated or unversioned)
  const hasVersionAction = versionStatus && !versionStatus.justUpdated && versionStatus.latestVersion && (
    versionStatus.status === 'outdated' || versionStatus.status === 'unknown'
  );

  return (
    <Card className="mb-4 shadow">
      <div className="flex justify-between items-center">
        <H4 className={`text-lg font-bold ${
          !item.name && !item.repo ? 'text-orange-500' :
          !item.name ? 'text-red-500' :
          hasVersionAction ? 'text-orange-600' : ''
        } flex items-center`}>
          {!item.name && !item.repo
            ? 'Paste a GitHub URL below to get started →'
            : item.name || 'Please fill in a valid name!'}
          {/* Version status indicator next to model name */}
          {versionStatus && !versionCheckLoading && hasVersionAction && (
            <Tooltip content={
              versionStatus.status === 'unknown'
                ? `No version pinned — latest is ${versionStatus.latestVersion}`
                : `Update available: ${versionStatus.currentVersion} → ${versionStatus.latestVersion}`
            }>
              <Icon icon="outdated" size={14} intent="warning" className="ml-2" />
            </Tooltip>
          )}
        </H4>
        <ButtonGroup>
          <Tooltip
            content={editable ? "Lock model" : "Click here to edit the model!"}
            isOpen={!editable}
            position="top"
          >
            <Button
              minimal
              icon={editable ? "tick" : "edit"}
              onClick={() => setEditable(index, !editable)}
            />
          </Tooltip>
          <Tooltip content="Reset values">
            <Button
              minimal
              icon="reset"
              intent="warning"
              onClick={() => onReset(index)}
            />
          </Tooltip>
          <Tooltip content="Delete model">
            <Button
              minimal
              intent="danger"
              icon="delete"
              onClick={() => onDelete(index)}
            />
          </Tooltip>
        </ButtonGroup>
      </div>

      <FormGroup
        label={
          <span className="inline-flex items-center gap-1">
            Model Name
            <Tooltip content="Provide a unique, lowercase name for this model. It will be used as foldername on Slurm and in the INI file as [name]_job_<parameter>.">
              <Icon icon="help" size={12} />
            </Tooltip>
            <SlurmInitIcon />
          </span>
        }
        subLabel="Also the path to store the container on the slurm_images_path."
        intent={errors?.name ? "danger" : undefined}
        helperText={
          errors?.name ? (
            <span className="text-red-500"><Icon icon="error" size={10} className="mr-1" />{errors.name}</span>
          ) : undefined
        }
      >
        <InputGroup
          value={item.name}
          placeholder="e.g., cellpose"
          readOnly={!editable}
          intent={errors?.name ? "danger" : undefined}
          onChange={(e) =>
            onChange(index, "name", e.target.value.toLowerCase())
          }
        />
      </FormGroup>

      <FormGroup
        label={
          <span className="inline-flex items-center gap-1">
            GitHub Repository
            <Tooltip content="Specify the versioned GitHub repository URL for this model. Versions (e.g., /tree/v1.0.0) ensure reproducibility.">
              <Icon icon="help" size={12} />
            </Tooltip>
            <SlurmInitIcon />
          </span>
        }
        subLabel={
          <span>
            GitHub URL pointing to the workflow repository — either a versioned tree URL or a direct descriptor file inside that tree.{" "}
            <span className="font-mono text-xs">
              https://github.com/org/repo/tree/v1.0.0
            </span>
            {" "}(auto-discovers descriptor.json / config.yaml) or{" "}
            <span className="font-mono text-xs">
              …/tree/v1.0.0/descriptor.json
            </span>
            {" "}(uses that exact file). Pinning a version is strongly recommended.
          </span>
        }
        helperText={errors?.repo ? (
          <span className="text-red-500"><Icon icon="error" size={10} className="mr-1" />{errors.repo}</span>
        ) : !item.repo && !item.name ? (
          <span className="text-blue-600 font-medium">
            ↑ Start here! Paste the GitHub URL — the name will be filled automatically.
          </span>
        ) : null}
        intent={errors?.repo ? "danger" : !item.repo && !item.name ? "primary" : undefined}
      >
        <InputGroup
          value={item.repo}
          placeholder="e.g., https://github.com/org/repo/tree/v1.0.0  or  …/tree/v1.0.0/descriptor.json"
          readOnly={!editable}
          onChange={(e) => onChange(index, "repo", e.target.value)}
          onBlur={() => {
            fetchContainerImageOnBlur(item.repo);
            if (onRepoBlur) onRepoBlur(index);
          }}
          rightElement={
            item.repo ? (
              <div className="flex">
                {!item.repo.includes('github.com/') ? (
                  // Not a GitHub URL at all
                  <Tooltip content="This should be a GitHub repository URL (https://github.com/org/repo)." intent="danger">
                    <Button icon="error" minimal intent="danger" />
                  </Tooltip>
                ) : item.repo.includes("/tree/v") ? (
                  <Button
                    icon="git-branch"
                    minimal
                    intent="primary"
                    title="Test GitHub URL"
                    onClick={() =>
                      window.open(item.repo, "_blank", "noopener,noreferrer")
                    }
                  />
                ) : (
                  <Tooltip
                    content="URL is missing a version (e.g., /tree/v1.0.0)."
                    intent="warning"
                  >
                    <Button icon="warning-sign" minimal intent="warning" />
                  </Tooltip>
                )}
                {/* DockerHub button — only show when we have a valid versioned URL and a resolved image with org/repo */}
                {containerImage && containerImage.includes('/') && (() => {
                  const imageRepo = containerImage.split(':')[0];
                  // Version lives in the GitHub URL (e.g. /tree/v2.0.3), not in the image string
                  const versionMatch = item.repo?.match(/\/tree\/(v[\d.]+)/);
                  const imageTag = versionMatch?.[1] || '';
                  const tagsUrl = imageTag
                    ? `https://hub.docker.com/r/${imageRepo}/tags?name=${imageTag}`
                    : `https://hub.docker.com/r/${imageRepo}`;
                  return (
                    <Tooltip content={imageTag ? `Check DockerHub tags for ${imageTag}` : 'View on DockerHub'}>
                      <Button
                        icon={<FaDocker />}
                        minimal
                        intent="primary"
                        title="Check DockerHub"
                        onClick={() => window.open(tagsUrl, '_blank', 'noopener,noreferrer')}
                      />
                    </Tooltip>
                  );
                })()}
                {/* Add latest version link for outdated models */}
                {versionStatus && versionStatus.status === 'outdated' && !versionStatus.justUpdated && versionStatus.latestReleaseUrl && (
                  <Tooltip content={`View latest version: ${versionStatus.latestVersion}`}>
                    <Button
                      icon="git-new-branch"
                      minimal
                      intent="warning"
                      title={`Latest version: ${versionStatus.latestVersion}`}
                      onClick={() =>
                        window.open(versionStatus.latestReleaseUrl, "_blank", "noopener,noreferrer")
                      }
                    />
                  </Tooltip>
                )}
                {/* Accept Update button for outdated models OR no-version URLs */}
                {versionStatus && (versionStatus.status === 'outdated' || versionStatus.status === 'unknown') && !versionStatus.justUpdated && versionStatus.latestVersion && editable && (
                  <Tooltip content={
                    versionStatus.status === 'unknown'
                      ? `No version set — use ${versionStatus.latestVersion}?`
                      : `Update to latest version: ${versionStatus.latestVersion}`
                  }>
                    <Button
                      icon="updated"
                      minimal
                      intent={versionStatus.status === 'unknown' ? 'warning' : 'success'}
                      title={
                        versionStatus.status === 'unknown'
                          ? `No version set — use ${versionStatus.latestVersion}?`
                          : `Accept update to ${versionStatus.latestVersion}`
                      }
                      onClick={updateToLatestVersion}
                    />
                  </Tooltip>
                )}
              </div>
            ) : null
          }
        />
        {/* Version status information */}
        {versionStatus && !versionCheckLoading && (
          <div className="mt-2">
            {versionStatus.justUpdated ? (
              <div className="bp5-form-helper-text text-green-600">
                <Icon icon="tick-circle" size={10} className="mr-1" />
                Updated to version {versionStatus.latestVersion}! Remember to save settings and run Slurm Init after.
              </div>
            ) : versionStatus.status === 'outdated' && !versionStatus.justUpdated ? (
              <div className="bp5-form-helper-text text-orange-600">
                <Icon icon="outdated" size={10} className="mr-1" />
                Update available: {versionStatus.currentVersion} → {versionStatus.latestVersion}
                {editable && " (Click the update button to accept)"}
              </div>
            ) : versionStatus.status === 'unknown' && versionStatus.latestVersion ? (
              <div className="bp5-form-helper-text text-orange-600">
                <Icon icon="warning-sign" size={10} className="mr-1" />
                No version set — latest available is {versionStatus.latestVersion}
                {editable && `. Click the update button to use it.`}
              </div>
            ) : (versionStatus.status === 'up-to-date' || versionStatus.justUpdated) ? (
              <div className="bp5-form-helper-text text-green-600">
                <Icon icon="tick" size={10} className="mr-1" />
                Using latest version: {versionStatus.justUpdated ? versionStatus.latestVersion : versionStatus.currentVersion}
              </div>
            ) : versionStatus.status === 'ahead' ? (
              <div className="bp5-form-helper-text text-blue-600">
                <Icon icon="info-sign" size={10} className="mr-1" />
                Using unreleased version: {versionStatus.currentVersion} (latest release: {versionStatus.latestVersion})
              </div>
            ) : null}
          </div>
        )}
      </FormGroup>

      <FormGroup
        label={
          <span className="inline-flex items-center gap-1">
            Slurm Job Script
            <Tooltip content="Specify the relative path to the Slurm job script. Defaults to 'jobs/<model-name>.sh' if left blank.">
              <Icon icon="help" size={12} />
            </Tooltip>
            <SlurmInitIcon />
          </span>
        }
        subLabel="The jobscript path in the 'slurm_script_repo'. Use jobs/<modelname>.sh, unless you added your own Slurm Script Repository."
        intent={errors?.job ? "danger" : undefined}
        helperText={
          errors?.job ? (
            <span className="text-red-500"><Icon icon="error" size={10} className="mr-1" />{errors.job} — rename the model above to fix this automatically.</span>
          ) : !hasScriptRepo ? (
            <span className="bp5-text-muted">Auto-generated from the model name — rename the model to update this. To use custom scripts instead, add a <em>Slurm Script Repository</em> in Slurm Settings.</span>
          ) : undefined
        }
      >
        <Tooltip
          content={errors?.job
            ? `Duplicate path — rename the model above and this will update automatically.`
            : "Auto-generated from the model name. Rename the model to update this. To use custom job scripts, add a Slurm Script Repository in Slurm Settings."}
          disabled={hasScriptRepo && !errors?.job}
          placement="top"
        >
          <InputGroup
            value={item.job}
            placeholder="e.g., jobs/cellpose.sh"
            disabled={!hasScriptRepo}
            intent={errors?.job ? "danger" : undefined}
            onChange={(e) => onChange(index, "job", e.target.value)}
          />
        </Tooltip>
      </FormGroup>

      {/* Workflow Input Configuration */}
      <FormGroup
        label={<span className="inline-flex items-center gap-1">Workflow Input Requirements <RuntimeIcon /></span>}
        subLabel="Configure input format requirements for this workflow."
      >
        <div className="flex items-center justify-between">
          <div className="flex flex-col">
            <span className="text-sm font-medium flex items-center gap-1">
              <Icon icon="grid-view" size={12} intent="primary" />
              Plate Workflow (ZARR Only)
            </span>
            <span className="text-xs bp5-text-muted">
              Enable for workflows that process entire plates and require ZARR format
            </span>
          </div>
          <Switch
            checked={item.isPlateWorkflow || false}
            disabled={!editable}
            onChange={(e) => {
              const isChecked = e.target.checked;
              onChange(index, "isPlateWorkflow", isChecked);
            }}
          />
        </div>
        {descriptorMeta !== null && descriptorMeta !== undefined && descriptorMeta.requiresPlate !== null && (item.isPlateWorkflow || false) !== descriptorMeta.requiresPlate && (
          <div className="bp5-text-muted text-xs mt-1 flex items-center gap-1">
            <Icon icon="help" size={10} />
            {descriptorMeta.requiresPlate
              ? 'Descriptor indicates plate input — enable Plate Workflow?'
              : 'Plate Workflow enabled but not in descriptor — intentional?'}
          </div>
        )}
        

        <div className="flex items-center justify-between mt-3">
          <div className="flex flex-col">
            <span className="text-sm font-medium flex items-center gap-1">
              <Icon icon="applications" size={12} intent="primary" />
              Also Allow Image Input
            </span>
            <span className="text-xs bp5-text-muted">
              Show this same workflow in both tabs and use the image dialog for image runs
            </span>
          </div>
          <Tooltip
            content="Enable Plate Workflow first, or declare requires-plate in the BILAYERS descriptor"
            disabled={supportsPlates}
          >
            <Switch
              checked={item.isDualModeWorkflow || false}
              disabled={!editable || !supportsPlates}
              onChange={(e) => onChange(index, "isDualModeWorkflow", e.target.checked)}
            />
          </Tooltip>
        </div>
        <div className="flex items-center justify-between mt-3">
          <div className="flex flex-col">
            <span className="text-sm font-medium flex items-center gap-1">
              <Icon icon="cube" size={12} className="bp5-text-muted" />
              ZARR Format Required
            </span>
            <span className="text-xs bp5-text-muted">
              {supportsPlates
                ? "Automatically enabled when plate workflow is selected"
                : "Enable for workflows that require ZARR input format (skips TIFF conversion)"
              }
            </span>
          </div>
          <Switch
            checked={(item.isZarrWorkflow || false) || supportsPlates}
            disabled={!editable || supportsPlates} // Plate support always requires ZARR
            onChange={(e) => {
              const isChecked = e.target.checked;
              onChange(index, "isZarrWorkflow", isChecked);
            }}
          />
        </div>
        {descriptorMeta !== null && descriptorMeta !== undefined && descriptorMeta.requiresZarr !== null && (item.isZarrWorkflow || false) !== descriptorMeta.requiresZarr && (
          <div className="bp5-text-muted text-xs mt-1 flex items-center gap-1">
            <Icon icon="help" size={10} />
            {descriptorMeta.requiresZarr
              ? 'Descriptor indicates Zarr input — enable Zarr Workflow?'
              : 'Zarr Workflow enabled but not in descriptor — intentional?'}
          </div>
        )}

        <div className="flex items-center justify-between mt-3">
          <div className="flex flex-col">
            <span className="text-sm font-medium flex items-center gap-1">
              <Icon icon="lightning" size={12} className="text-yellow-500" />
              GPU Workflow
            </span>
            <span className="text-xs bp5-text-muted">
              Mark this workflow as GPU-enabled by default. BIOMERO will apply the global{" "}
              <code>gpu_partition</code> / <code>gpu_gres</code> / <code>gpu_gpus</code> from
              Slurm Settings — or override them per-workflow using the sbatch parameters below
              (e.g. <code>partition=gpu_a100</code>, <code>gres=gpu:a100:1</code>).
            </span>
          </div>
          <Switch
            checked={item.useGpu || false}
            disabled={!editable}
            onChange={(e) => onChange(index, "useGpu", e.target.checked)}
          />
        </div>
        {/* GPU sbatch params set but toggle is off — shown in unified global section below */}
        {/* Warning or effective values when GPU toggle is on */}
        {item.useGpu && (() => {
          const partition = gpuSettings?.gpu_partition;
          const gres = gpuSettings?.gpu_gres;
          const gpus = gpuSettings?.gpu_gpus;
          const extraEntries = Object.entries(item.extraParams || {});
          const perWfPartitionEntry = extraEntries.find(([k]) => k.toLowerCase().endsWith('_job_partition'));
          const perWfGresEntry = extraEntries.find(([k]) => k.toLowerCase().endsWith('_job_gres'));
          const perWfGpusEntry = extraEntries.find(([k]) => k.toLowerCase().endsWith('_job_gpus'));
          const hasPerWfPartition = !!perWfPartitionEntry;
          const hasPerWfGres = !!(perWfGresEntry || perWfGpusEntry);
          const missingPartition = !partition && !hasPerWfPartition;
          const missingResources = !(gres || gpus) && !hasPerWfGres;
          if (missingPartition || missingResources) {
            const parts = [];
            if (missingPartition) parts.push('gpu_partition is not set');
            if (missingResources) parts.push('neither gpu_gres nor gpu_gpus is set');
            return (
              <div className="text-orange-500 text-xs mt-1 flex items-center gap-1">
                <Icon icon="warning-sign" size={10} />
                GPU workflow enabled but {parts.join(' and ')} — configure in Slurm Settings or add per-workflow sbatch overrides below.
              </div>
            );
          }
          // Cross-type gres/gpus conflict: per-wf gres + global gpus (or vice versa)
          // The slurm client checks them independently, so BOTH would end up in the
          // sbatch command → SLURM rejects the submission.
          const crossConflict = (perWfGresEntry && gpus) || (perWfGpusEntry && gres);
          if (crossConflict) {
            const conflictDesc = perWfGresEntry && gpus
              ? `per-workflow --gres=${perWfGresEntry[1]} + global gpu_gpus=${gpus}`
              : `per-workflow --gpus=${perWfGpusEntry[1]} + global gpu_gres=${gres}`;
            return (
              <div className="text-red-600 text-xs mt-1 flex items-center gap-1">
                <Icon icon="error" size={10} />
                <span><strong>sbatch conflict:</strong> {conflictDesc} — <code>--gres</code> and <code>--gpus</code> are mutually exclusive; SLURM will reject this job.</span>
              </div>
            );
          }
          // No separate effective-values block here — shown in unified section below.
          return null;
        })()}
      </FormGroup>

      <FormGroup
        label={
          <span className="inline-flex items-center gap-1">
            Additional Slurm Parameters
            <Tooltip content="Add parameters in key=value format (e.g., mem=32GB). These will be converted to <name>_job_<key>=<value> in the INI file.">
              <Icon icon="help" size={12} />
            </Tooltip>
            <RuntimeIcon />
          </span>
        }
        subLabel={
          <>
            Override the default job values for this workflow, or add a job
            value to this workflow.{" "}
            <div>
              See Slurm{" "}
              <a
                href="https://slurm.schedmd.com/sbatch.html#SECTION_OPTIONS"
                target="_blank"
                rel="noopener noreferrer"
              >
                SBATCH parameters
              </a>{" "}
              for all options. Always use the extended form here (e.g.{" "}
              <code>cpus-per-task</code>, not <code>c</code>).
            </div>
          </>
        }
      >
        <InputGroup
          placeholder="e.g., mem=32GB"
          disabled={!editable}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onBlur={() => {
            if (inputValue && !showWarning) {
              setShowWarning(true);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && editable) {
              const [key, value] = inputValue.split("=");
              if (key) {
                onAddParam(index, key.trim(), value ? value.trim() : "");
                setInputValue("");
                setShowWarning(false);
              }
            }
          }}
          rightElement={
            showWarning && editable ? (
              <Tooltip
                content="Press Enter or click this button to confirm your changes"
                intent="warning"
                isOpen={showWarning && editable}
              >
                <Button
                  icon="warning-sign"
                  minimal
                  intent="warning"
                  onClick={() => {
                    const [key, value] = inputValue.split("=");
                    if (key) {
                      onAddParam(index, key.trim(), value ? value.trim() : "");
                      setInputValue("");
                      setShowWarning(false);
                    }
                  }}
                />
              </Tooltip>
            ) : null
          }
        />
      </FormGroup>
      <div className="bp5-form-group">
        <div className="bp5-form-content">
          <div className="bp5-form-helper-text">
            <ul>
              E.g.
              <li>
                Run with specific GPU: <code>gres=gpu:1g.10gb:1</code>
              </li>
              <li>
                Run on a specific partition: <code>partition=luna-gpu-short</code>
              </li>
              <li>
                Use more CPU memory: <code>mem=15GB</code>
              </li>
              <li>
                Higher timeout (d-hh:mm:ss): <code>time=08:00:00</code>
              </li>
            </ul>
          </div>
        </div>
      </div>
      {item.extraParams && (
        <ul className="list-disc list-inside space-y-2">
          {Object.entries(item.extraParams).map(([key, value]) => (
            <li key={key} className="flex items-center space-x-2">
              <span className="text-sm font-semibold">{key}:</span>
              {editable ? (
                <InputGroup
                  value={value}
                  onChange={(e) => onAddParam(index, key, e.target.value)}
                  className="flex-1"
                />
              ) : (
                <span>{value}</span>
              )}
              {editable && (
                <Button
                  icon="delete"
                  minimal
                  intent="danger"
                  onClick={() => {
                    onAddParam(index, key, null); // Pass null as the value to trigger deletion
                  }}
                />
              )}
            </li>
          ))}
        </ul>
      )}
      {/* Active global settings — show greyed-out globals that aren't overridden by per-workflow params */}
      {(() => {
        // Collect the param names already set per-workflow (the part after _job_)
        const perWfParamNames = new Set(
          Object.keys(item.extraParams || {}).map(k => {
            const m = k.match(/_job_(.+)$/);
            return m ? m[1].toLowerCase() : null;
          }).filter(Boolean)
        );

        const activeGlobals = [];

        // GPU settings (only when useGpu is on and no per-workflow override)
        if (item.useGpu) {
          const gpuPartition = gpuSettings?.gpu_partition;
          const gpuGres = gpuSettings?.gpu_gres;
          const gpuGpus = gpuSettings?.gpu_gpus;
          if (gpuPartition && !perWfParamNames.has('partition'))
            activeGlobals.push({ flag: '--partition', value: gpuPartition, source: 'GPU setting' });
          if (gpuGres && !perWfParamNames.has('gres'))
            activeGlobals.push({ flag: '--gres', value: gpuGres, source: 'GPU setting' });
          if (gpuGpus && !perWfParamNames.has('gpus'))
            activeGlobals.push({ flag: '--gpus', value: gpuGpus, source: 'GPU setting' });
        }

        // Default partition (only if no per-workflow or GPU partition already covers it)
        const hasPartitionAlready = perWfParamNames.has('partition') || (item.useGpu && gpuSettings?.gpu_partition);
        if (globalJobParams?.defaultPartition && !hasPartitionAlready)
          activeGlobals.push({ flag: '--partition', value: globalJobParams.defaultPartition, source: 'global default' });

        // Global sbatch params (if not overridden per-workflow)
        for (const { key, value } of (globalJobParams?.sbatchParams || [])) {
          if (key && value && !perWfParamNames.has(key.toLowerCase()))
            activeGlobals.push({ flag: `--${key}`, value, source: 'global' });
        }

        if (activeGlobals.length === 0) return null;
        return (
          <div className="mt-2 border-t border-bp-border pt-2 space-y-0.5">
            <div className="text-xs bp5-text-muted font-medium mb-1">Also active for this workflow:</div>
            {activeGlobals.map(({ flag, value, source }, i) => (
              <div key={i} className="flex items-center gap-1.5 text-xs bp5-text-muted">
                <code className="bp5-text-muted">{flag}={value}</code>
                <span className="bp5-text-muted">({source})</span>
              </div>
            ))}
          </div>
        );
      })()}
    </Card>
  );
};

export default ModelCard;
