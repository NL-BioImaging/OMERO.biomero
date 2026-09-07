import React, { useState, useEffect, useMemo } from "react";
import {
  Card,
  FormGroup,
  InputGroup,
  Button,
  Switch,
  H3,
  H5,
  H6,
  Tag,
  Icon,
  ButtonGroup,
  Tooltip,
  Spinner,
} from "@blueprintjs/core";
import { useAppContext } from "../../AppContext";
import CollapsibleSection from "./CollapsibleSection";
import ConfigSection from "./ConfigSection";
import ModelCard from "./ModelCard.js";
import ConverterCard from "./ConverterCard.js";
import { checkModelVersions, clearGitHubCache, slugify, fetchWorkflowMetadata } from "../../apiService";
import { getDeletedConfigOptions } from "../configAdmin";

const DOCS_URL = "https://nl-bioimaging.github.io/biomero/slurm-configuration.html";

/** Inline Tag showing an environment variable name. */
const EnvVarTag = ({ name }) => (
  <Tag minimal className="font-mono">{name}</Tag>
);

/** "Environment variable(s): TAG (i)" labeled line, stays within bp5-form-helper-text font size. */
const EnvVarNote = ({ vars }) => (
  <span className="block mt-0.5">
    <strong className="text-gray-600">
      Environment variable{vars.length > 1 ? "s" : ""}:
    </strong>{" "}
    {vars.map((v, i) => (
      <span key={v}><EnvVarTag name={v} />{i < vars.length - 1 ? " / " : ""}</span>
    ))}{" "}
    <Tooltip
      content={
        vars.length > 1
          ? "If any of these environment variables are set on the server, they override this field. Their current values are not shown here."
          : "If this environment variable is set on the server, it overrides this field. Its current value is not shown here."
      }
      placement="right"
    >
      <Icon icon="info-sign" size={11} className="align-middle cursor-help text-gray-400" />
    </Tooltip>
  </span>
);

/** "Example: value" labeled line, stays within bp5-form-helper-text font size. */
const ExampleNote = ({ children }) => (
  <span className="block mt-0.5"><strong className="text-gray-600">Example:</strong> <code>{children}</code></span>
);

/** Setting type icon: takes effect immediately after saving, no Slurm Init needed. */
export const RuntimeIcon = () => (
  <span className="inline-flex align-middle">
    <Tooltip
      content="Runtime setting — takes effect immediately after saving. No Slurm Init needed."
      placement="right"
    >
      <Icon icon="automatic-updates" size={12} className="cursor-help text-gray-400" />
    </Tooltip>
  </span>
);

/** Setting type icon: requires running the Slurm Init script to deploy. */
export const SlurmInitIcon = () => (
  <span className="inline-flex align-middle">
    <Tooltip
      content="Slurm Init setting — a Slurm Init run is needed to deploy this change to the cluster."
      placement="right"
    >
      <Icon icon="refresh" size={12} className="cursor-help text-gray-400" />
    </Tooltip>
  </span>
);

const SettingsForm = () => {
  const { 
    state, 
    updateState, 
    loadBiomeroConfig, 
    saveConfigData
  } = useAppContext();
  const [settingsForm, setSettingsForm] = useState(null);
  const [initialFormData, setInitialFormData] = useState(null); // Stable reference to initial data
  const [editMode, setEditMode] = useState({});

  const [hasChanges, setHasChanges] = useState(false);
  const [showSaveTooltip, setShowSaveTooltip] = useState(true);
  const [showResetTooltip, setShowResetTooltip] = useState(false);
  const [loading, setLoading] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false); // Track if form has been initialized

  const [converters, setConverters] = useState([]);
  const [globalSbatchParams, setGlobalSbatchParams] = useState([]);
  const [errors, setErrors] = useState({});
  const [modelErrors, setModelErrors] = useState({});
  
  // Descriptor flags derived from already-fetched state.workflows (populated by Run tab on load)
  const descriptorMetadata = useMemo(() => {
    if (!settingsForm?.WORKFLOWS || !state.workflows) return {};
    const result = {};
    settingsForm.WORKFLOWS.forEach((model, index) => {
      const wf = state.workflows.find((w) => w.name === model.name);
      if (wf?.metadata) {
        result[index] = {
          requiresZarr: wf.metadata['requires-zarr'] ?? null,
          requiresPlate: wf.metadata['requires-plate'] ?? null,
        };
      }
    });
    return result;
  }, [settingsForm?.WORKFLOWS, state.workflows]);

  // Version checking state
  const [versionStatus, setVersionStatus] = useState({});
  const [versionCheckLoading, setVersionCheckLoading] = useState(false);
  const [versionCheckCompleted, setVersionCheckCompleted] = useState(false);
  
  // Validation for UI settings
  const validateMaxBatchJobs = (value) => {
    if (!value || value === "") return null;
    const numValue = parseInt(value, 10);
    if (isNaN(numValue)) return "Must be a number";
    if (numValue < 10) return "Minimum 10 jobs (for dangerous jobs mode)";
    if (numValue > 1000) return "Maximum 1000 jobs";
    return null;
  };
  
  const getMaxBatchJobsError = () => {
    return validateMaxBatchJobs(settingsForm?.UI?.max_batch_jobs);
  };
  
  const hasValidationErrors = () => {
    return getMaxBatchJobsError() !== null || Object.keys(errors).length > 0 || Object.keys(modelErrors).length > 0;
  };

  const validateModelFields = (models, scriptRepo, slurm) => {
    const newErrors = {};
    const globalGres = slurm?.gpu_gres || '';
    const globalGpus = slurm?.gpu_gpus || '';
    models.forEach((model, index) => {
      // Duplicate name check
      if (model.name) {
        const hasDupeName = models.some((m, i) => i !== index && m.name === model.name);
        if (hasDupeName) {
          if (!newErrors[index]) newErrors[index] = {};
          newErrors[index].name = `Duplicate name "${model.name}" — each workflow must have a unique name`;
        }
      }
      // Duplicate job script check (always relevant — duplicate paths cause conflicts regardless)
      if (model.job) {
        const hasDupeJob = models.some((m, i) => i !== index && m.job && m.job === model.job);
        if (hasDupeJob) {
          if (!newErrors[index]) newErrors[index] = {};           
          newErrors[index].job = `Duplicate job script "${model.job}" — each workflow must have a unique script path`;
        }
      }
      // GPU sbatch conflict: per-workflow --gres + global gpu_gpus (or vice versa)
      // The slurm client adds them independently, so both would end up in the sbatch
      // command and SLURM would reject the submission.
      if (model.useGpu) {
        const extraKeys = Object.keys(model.extraParams || {}).map(k => k.toLowerCase());
        const hasPerWfGres = extraKeys.some(k => k.endsWith('_job_gres'));
        const hasPerWfGpus = extraKeys.some(k => k.endsWith('_job_gpus'));
        if (hasPerWfGres && globalGpus) {
          if (!newErrors[index]) newErrors[index] = {};
          newErrors[index].gpuConflict = `sbatch conflict: per-workflow gres= + global gpu_gpus — --gres and --gpus are mutually exclusive; SLURM will reject this job`;
        } else if (hasPerWfGpus && globalGres) {
          if (!newErrors[index]) newErrors[index] = {};
          newErrors[index].gpuConflict = `sbatch conflict: per-workflow gpus= + global gpu_gres — --gres and --gpus are mutually exclusive; SLURM will reject this job`;
        }
      }
    });
    setModelErrors((prev) => {
      // Merge: keep repo errors set by handleRepoUrlBlur, only replace
      // name/job/gpuConflict which we just recomputed.
      const merged = {};
      // Collect all indices present in either old or new errors
      const allIndices = new Set([
        ...Object.keys(prev).map(Number),
        ...Object.keys(newErrors).map(Number),
      ]);
      allIndices.forEach((i) => {
        const repoErr = prev[i]?.repo;
        const computed = newErrors[i] || {};
        const entry = { ...computed };
        if (repoErr) entry.repo = repoErr;
        if (Object.keys(entry).length > 0) merged[i] = entry;
      });
      return merged;
    });
  };

  useEffect(() => {
    if (!initialFormData) return;
    // globalSbatchParams is stored in initialFormData for the separate comparison below,
    // but is NOT present in settingsForm — strip it before the main diff to avoid a
    // permanent false-positive that lights up Save/Undo on every page load.
    const { globalSbatchParams: _gsb, ...initialForComparison } = initialFormData;
    if (JSON.stringify(settingsForm) !== JSON.stringify(initialForComparison)) {
      setHasChanges(true);
    } else if (
      JSON.stringify(converters) !== JSON.stringify(initialFormData?.CONVERTERS) ||
      JSON.stringify(globalSbatchParams) !== JSON.stringify(initialFormData?.globalSbatchParams)
    ) {
      setHasChanges(true);
    } else {
      setHasChanges(false);
    }
  }, [settingsForm, initialFormData, converters, globalSbatchParams]);

  const initializeFormState = () => {
    if (state.config) {
      const mappedModels = Object.entries(state.config.WORKFLOWS || {})
        .filter(([key]) => key.endsWith("_repo")) // Filter for relevant keys
        .map(([key, value]) => {
          const prefix = key.replace("_repo", ""); // Extract the prefix
          
          // Check if this workflow is marked as plate workflow in UI config
          const plateWorkflows = state.config.UI?.plate_workflows ? 
            JSON.parse(state.config.UI.plate_workflows || '[]') : [];
          const isPlateWorkflow = plateWorkflows.includes(prefix);
          

          const dualModeWorkflows = state.config.UI?.dual_mode_workflows ?
            JSON.parse(state.config.UI.dual_mode_workflows || '[]') : [];
          const isDualModeWorkflow = dualModeWorkflows.includes(prefix);

          // Check if this workflow is marked as ZARR workflow in UI config
          const zarrWorkflows = state.config.UI?.zarr_workflows ? 
            JSON.parse(state.config.UI.zarr_workflows || '[]') : [];
          const isZarrWorkflow = zarrWorkflows.includes(prefix);
          
          return {
            name: state.config.WORKFLOWS[prefix], // e.g., "cellpose"
            repo: value, // e.g., the repo URL
            job: state.config.WORKFLOWS[`${prefix}_job`], // e.g., "jobs/cellpose.sh"
            isPlateWorkflow: isPlateWorkflow, // Boolean flag from UI list
            isDualModeWorkflow: isDualModeWorkflow,
            isZarrWorkflow: isZarrWorkflow, // Boolean flag from UI list
            useGpu: state.config.WORKFLOWS[`${prefix}_use_gpu`] === "true",
            extraParams: extractExtraParams(prefix), // Handle the extraParams here
          };
        });

      const mappedConverters = Object.entries(
        state.config.CONVERTERS || {}
      ).map(([key, value]) => ({ key, value }));
      const mappedSbatchParams = Object.entries(state.config.SLURM || {})
        .filter(([k]) => k.startsWith("sbatch_"))
        .map(([k, v]) => ({ key: k.slice(7), value: v }));
      // store a version to 'reset' to
      setInitialFormData({
        ...state.config,
        WORKFLOWS: mappedModels,
        CONVERTERS: mappedConverters,
        globalSbatchParams: mappedSbatchParams,
      });
      // the living version to be changed by the UI
      setSettingsForm({
        ...state.config,
        WORKFLOWS: mappedModels,
        CONVERTERS: mappedConverters,
      });

      setConverters(mappedConverters);
      setGlobalSbatchParams(mappedSbatchParams);
    }
  };

  const extractExtraParams = (prefix) => {
    const extraParams = {};
    Object.entries(state.config.WORKFLOWS || {}).forEach(([key, value]) => {
      if (key.startsWith(`${prefix}_job_`)) {
        const paramKey = key;
        extraParams[paramKey] = value;
      }
    });
    return extraParams;
  };

  useEffect(() => {
    loadBiomeroConfig();
  }, []); // Load config once on mount

  useEffect(() => {
    // Initialize form state once when config is available and form hasn't been initialized
    if (state.config && !isInitialized) {
      initializeFormState();
      setIsInitialized(true);
    }
  }, [state.config, isInitialized]); // Only run when config loads and form isn't initialized

  // Validate model fields whenever WORKFLOWS or GPU settings change
  useEffect(() => {
    if (settingsForm?.WORKFLOWS) {
      validateModelFields(settingsForm.WORKFLOWS, settingsForm?.SLURM?.slurm_script_repo, settingsForm?.SLURM);
    }
  }, [settingsForm?.WORKFLOWS, settingsForm?.SLURM?.slurm_script_repo, settingsForm?.SLURM?.gpu_gres, settingsForm?.SLURM?.gpu_gpus]);

  // Trigger version check when admin panel opens for the first time
  useEffect(() => {
    if (settingsForm?.WORKFLOWS?.length > 0 && !versionCheckCompleted) {
      performVersionCheck();
    }
  }, [settingsForm?.WORKFLOWS, versionCheckCompleted]);

  const performVersionCheck = async (forceRefresh = false) => {
    if (!settingsForm?.WORKFLOWS?.length || versionCheckLoading) return;
    
    setVersionCheckLoading(true);
    try {
      const results = await checkModelVersions(settingsForm.WORKFLOWS, forceRefresh);
      const statusMap = {};
      results.forEach(result => {
        statusMap[result.index] = result;
      });
      setVersionStatus(statusMap);
      setVersionCheckCompleted(true);
    } catch (error) {
      console.error('Error checking model versions:', error);
    } finally {
      setVersionCheckLoading(false);
    }
  };

  // Manual refresh that clears cache and forces fresh API calls
  const manualRefreshVersions = async () => {
    await clearGitHubCache(); // Clear the cache first (now async)
    await performVersionCheck(true); // Force refresh
  };

  // Check version for a specific model
  const recheckModelVersion = async (modelIndex, updatedModel = null, forceRefresh = false) => {
    if (!settingsForm?.WORKFLOWS?.[modelIndex] && !updatedModel) return;
    
    try {
      const model = updatedModel || settingsForm.WORKFLOWS[modelIndex];
      const results = await checkModelVersions([model], forceRefresh);
      if (results.length > 0) {
        const result = { ...results[0], index: modelIndex }; // Fix index to match our array
        setVersionStatus(prev => ({
          ...prev,
          [modelIndex]: result
        }));
      }
    } catch (error) {
      console.error('Error rechecking model version:', error);
    }
  };

  // Calculate version summary for Workflows Settings
  const getVersionSummary = () => {
    if (!settingsForm?.WORKFLOWS?.length || !Object.keys(versionStatus).length) {
      return { 
        upToDate: 0, 
        total: 0, 
        outdated: 0, 
        rateLimited: 0, 
        stale: 0
      };
    }
    
    const total = settingsForm.WORKFLOWS.length;
    let upToDate = 0;
    let outdated = 0;
    let rateLimited = 0;
    let stale = 0;
    let rateLimitResetTime = null;
    
    Object.values(versionStatus).forEach(status => {
      if (status.status === 'rate-limited') {
        rateLimited++;
        // Get the earliest reset time for display
        if (status.rateLimitInfo?.reset) {
          const resetTime = parseInt(status.rateLimitInfo.reset) * 1000;
          if (!rateLimitResetTime || resetTime < rateLimitResetTime) {
            rateLimitResetTime = resetTime;
          }
        }
      } else if (status.status === 'up-to-date' || status.justUpdated) {
        upToDate++;
      } else if (status.status === 'outdated') {
        outdated++;
      } else if (status.status === 'unknown' && status.latestVersion) {
        outdated++; // unversioned URLs count as needing an update
      } else if (status.status === 'up-to-date-stale' || status.status === 'outdated-stale') {
        stale++;
        if (status.status === 'up-to-date-stale') upToDate++;
        if (status.status === 'outdated-stale') outdated++;
      }
      // Handle 'error' and 'unknown' statuses - these count toward total but no specific category
    });
    
    return { 
      upToDate, 
      total, 
      outdated, 
      rateLimited, 
      stale, 
      rateLimitResetTime: rateLimitResetTime ? new Date(rateLimitResetTime) : null
    };
  };

  // Handle when user finishes editing repo URL
  const handleRepoUrlBlur = async (modelIndex) => {
    if (!settingsForm?.WORKFLOWS?.[modelIndex]?.repo) return;
    
    const model = settingsForm.WORKFLOWS[modelIndex];

    // Clear any previous repo error for this model
    setModelErrors((prev) => {
      if (!prev[modelIndex]?.repo) return prev;
      const next = { ...prev };
      if (next[modelIndex]) {
        const { repo: _, ...rest } = next[modelIndex];
        if (Object.keys(rest).length === 0) delete next[modelIndex];
        else next[modelIndex] = rest;
      }
      return next;
    });

    // Fetch the descriptor once — gets us the tool name AND zarr/plate flags
    // in a single Django→GitHub round-trip (server-side caching applies).
    let metadata;
    try {
      metadata = await fetchWorkflowMetadata(null, model.repo);
    } catch (err) {
      const msg = err?.response?.data?.error || err?.message || 'Could not fetch descriptor';
      setModelErrors((prev) => ({
        ...prev,
        [modelIndex]: { ...(prev[modelIndex] || {}), repo: `Descriptor not found: ${msg}` },
      }));
      return;
    }

    if (metadata) {
      setSettingsForm((prev) => {
        const updatedModels = structuredClone(prev.WORKFLOWS);
        const m = updatedModels[modelIndex];

        // Auto-populate name from descriptor if the name field is still empty
        if (!m.name && metadata.name) {
          const descriptorName = slugify(metadata.name);
          if (descriptorName) {
            const existingNames = updatedModels
              .filter((_, i) => i !== modelIndex)
              .map((n) => n.name)
              .filter(Boolean);
            let uniqueName = descriptorName;
            let counter = 2;
            while (existingNames.includes(uniqueName)) {
              uniqueName = `${descriptorName}_${counter++}`;
            }
            m.name = uniqueName;
            if (!prev.SLURM.slurm_script_repo) {
              m.job = `jobs/${uniqueName}.sh`;
            }
          }
        }

        // Auto-detect zarr/plate flags from the descriptor
        if (metadata['requires-plate'] && !m.isPlateWorkflow) {
          m.isPlateWorkflow = true;
          m.isZarrWorkflow = true; // plate implies zarr
        } else if (metadata['requires-zarr'] && !m.isZarrWorkflow) {
          m.isZarrWorkflow = true;
        }

        return { ...prev, WORKFLOWS: updatedModels };
      });
    }

    recheckModelVersion(modelIndex, model);
  };

  const toggleEdit = (field) => {
    setEditMode((prev) => ({ ...prev, [field]: !prev[field] }));
  };

  const handleModelChange = (index, field, value, options = {}) => {
    setSettingsForm((prev) => {
      const updatedModels = structuredClone(prev.WORKFLOWS);
      updatedModels[index][field] = value;

      if (field === "name" && !prev.SLURM.slurm_script_repo) {
        updatedModels[index]["job"] = `jobs/${value}.sh`;
      }

      // Special handling for plate/zarr workflow coupling
      if (field === "isPlateWorkflow" && value === true) {
        // When enabling plate workflow, also enable ZARR
        updatedModels[index]["isZarrWorkflow"] = true;
      }
      if (field === "isPlateWorkflow" && value === false &&
          !descriptorMetadata[index]?.requiresPlate) {
        updatedModels[index]["isDualModeWorkflow"] = false;
      }


      return { ...prev, WORKFLOWS: updatedModels };
    });

    // Clear version status when repo URL changes - we'll check on blur
    if (field === "repo" && !options.skipVersionCheck) {
      setVersionStatus(prev => {
        const updated = { ...prev };
        delete updated[index];
        return updated;
      });
    }
  };

  // Regex for validation
  const converterKeyRegex = /^[a-zA-Z0-9]+_to_[a-zA-Z0-9]+$/;
  const dockerImageRegex =
    /^[a-zA-Z0-9-_]+\/[a-zA-Z0-9-_]+(:[a-zA-Z0-9-_.]+)?$/;
  const validateField = (index, field, value) => {
    let newErrors = { ...errors };

    if (field === "key") {
      if (!converterKeyRegex.test(value)) {
        newErrors[index] = {
          ...newErrors[index],
          key: "Invalid format: should be X_to_Y",
        };
      } else {
        delete newErrors[index]?.key;
      }
    }

    if (field === "value") {
      if (!dockerImageRegex.test(value)) {
        newErrors[index] = {
          ...newErrors[index],
          value: "Invalid Docker image format",
        };
      } else {
        delete newErrors[index]?.value;

        // Warn if missing a version
        if (!value.includes(":")) {
          newErrors[index] = {
            ...newErrors[index],
            valueWarning: "No version tag specified (defaulting to latest)",
          };
        } else {
          delete newErrors[index]?.valueWarning;
        }
      }
    }

    setErrors(newErrors);
  };

  const handleConverterChange = (index, field, value) => {
    // const updatedConverters = structuredClone(settingsForm.CONVERTERS);
    // updatedConverters[index][field] = value;
    // setSettingsForm((prev) => ({ ...prev,
    //   CONVERTERS: updatedConverters
    // }));
    const newConverters = [...converters];
    newConverters[index] = { ...newConverters[index], [field]: value };
    setConverters(newConverters);
  };

  const handleAddConverter = () => {
    // setSettingsForm((prev) => ({
    //     ...prev,
    //     CONVERTERS: [...prev.CONVERTERS, { key: "", value: "" }],
    //   }));
    setConverters([...converters, { key: "", value: "" }]);
  };

  const handleRemoveConverter = (index) => {
    setConverters(converters.filter((_, i) => i !== index));
    setErrors((prevErrors) => {
      const newErrors = { ...prevErrors };
      delete newErrors[index];
      return newErrors;
    });
  };

  const resetConverter = (index) => {
    if (!initialFormData) return;

    setConverters((prev) => {
      const updatedConverters = [...prev];
      if (initialFormData.CONVERTERS[index]) {
        updatedConverters[index] = initialFormData.CONVERTERS[index]; // Restore from initial data
      } else {
        updatedConverters[index] = { key: "", value: "" }; // Reset to default if it's a new converter
      }

      return updatedConverters;
    });
  };

  const openDockerHub = (image) => {
    const [repo, version] = image.split(":");
    const url = `https://hub.docker.com/r/${repo}/tags?page=1&name=${version}`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const addModel = () => {
    setSettingsForm((prev) => ({
      ...prev,
      WORKFLOWS: [...prev.WORKFLOWS, { name: "", repo: "", job: "" }],
    }));
  };

  const handleDeleteModel = (index) => {
    setSettingsForm((prev) => {
      const updatedModels = prev.WORKFLOWS.filter((_, i) => i !== index);
      return { ...prev, WORKFLOWS: updatedModels };
    });
    // Rebuild versionStatus: remove the deleted entry and shift higher indices down
    setVersionStatus((prev) => {
      const updated = {};
      Object.entries(prev).forEach(([key, val]) => {
        const i = parseInt(key);
        if (i < index) updated[i] = val;
        else if (i > index) updated[i - 1] = val;
        // i === index is dropped
      });
      return updated;
    });
  };

  const resetModel = (index) => {
    if (!initialFormData) return;

    setSettingsForm((prev) => {
      const updatedModels = [...prev.WORKFLOWS];
      if (initialFormData.WORKFLOWS[index]) {
        updatedModels[index] = initialFormData.WORKFLOWS[index]; // Restore model from initial data
      } else {
        updatedModels[index] = { name: "", repo: "", job: "" }; // Reset to default if it's a new model
      }

      return { ...prev, WORKFLOWS: updatedModels };
    });
  };

  const resetForm = () => {
    if (state.config) {
      initializeFormState(); // Re-initialize from current config
      setShowSaveTooltip(true);
    }
  };

  const handleInputChange = (field, value) => {
    const updatedSettings = structuredClone(settingsForm); // Deep clone the settings form
    const keys = field.split(".");

    // Traverse the cloned object to update the nested value
    let current = updatedSettings;
    keys.forEach((key, index) => {
      if (index === keys.length - 1) {
        current[key] = value; // Update the value at the final key
      } else {
        if (!current[key]) current[key] = {}; // Ensure nested objects exist
        current = current[key];
      }
    });

    setSettingsForm(updatedSettings);
    updateState({ settingsForm: updatedSettings });
  };

  const submitConfig = async () => {
    // Check for validation errors before saving
    if (hasValidationErrors()) {
      return; // Don't save if there are validation errors
    }
    
    setLoading(true);
    try {
      // Prepare the config with current converters for saving
      const configToSave = {
        ...settingsForm,
        CONVERTERS: converters, // Use current converters state
      };
      
      // Update the form state for UI consistency
      if (Object.keys(errors).length === 0) {
        setSettingsForm((prev) => ({
          ...prev,
          CONVERTERS: converters,
        }));
      }
      
      const configPayload = transformSettingsFormToPayload(configToSave);
      const deleted = getDeletedConfigOptions(
        state.config || {}, configPayload
      );
      await saveConfigData(configPayload, deleted);
      
      // Update the baseline for "hasChanges" detection - form state is now the "initial" state
      const currentFormState = {
        ...settingsForm,
        CONVERTERS: converters,
        globalSbatchParams: globalSbatchParams,
      };
      setInitialFormData(currentFormState);
      
      // Reload config in background for other components (doesn't affect our form state)
      loadBiomeroConfig(); // Note: not awaited - we don't want it to interfere with our form
      
      setShowSaveTooltip(false); // Hide "Don't forget to save"
      setShowResetTooltip(true); // Show "Reload to apply changes"
    } catch {
      // AppContext displays the save error; keep the existing form baseline.
    } finally {
      setLoading(false);
    }
  };

  const transformSettingsFormToPayload = (settingsForm) => {
    const models = settingsForm.WORKFLOWS.reduce((acc, model) => {
      acc[model.name] = model.name;
      acc[`${model.name}_repo`] = model.repo;
      acc[`${model.name}_job`] = model.job;
      if (model.useGpu) {
        acc[`${model.name}_use_gpu`] = "true";
      }
      if (model.extraParams) {
        Object.entries(model.extraParams).forEach(([key, value]) => {
          acc[key] = value;
        });
      }
      return acc;
    }, {});

    // Collect plate workflows into a JSON list
    const plateWorkflows = settingsForm.WORKFLOWS
      .filter(model => model.isPlateWorkflow)
      .map(model => model.name);
      

    // Workflows in this list appear in both the image and plate run tabs.
    const dualModeWorkflows = settingsForm.WORKFLOWS
      .filter(model => model.isDualModeWorkflow)
      .map(model => model.name);
    // Collect ZARR workflows into a JSON list
    const zarrWorkflows = settingsForm.WORKFLOWS
      .filter(model => model.isZarrWorkflow)
      .map(model => model.name);

    const converters = settingsForm.CONVERTERS.reduce((acc, converter) => {
      acc[converter.key] = converter.value;
      return acc;
    }, {});

    const slurmWithoutSbatch = Object.fromEntries(
      Object.entries(settingsForm.SLURM || {}).filter(([k]) => !k.startsWith("sbatch_"))
    );
    const sbatchEntries = {};
    globalSbatchParams.forEach(({ key, value }) => {
      if (key) sbatchEntries[`sbatch_${key}`] = value;
    });
    return {
      ...settingsForm,
      SLURM: { ...slurmWithoutSbatch, ...sbatchEntries },
      CONVERTERS: converters,
      WORKFLOWS: models,
      UI: {
        ...settingsForm.UI,
        plate_workflows: JSON.stringify(plateWorkflows),
        zarr_workflows: JSON.stringify(zarrWorkflows),
        dual_mode_workflows: JSON.stringify(dualModeWorkflows)
      }
    };
  };

  const renderEditableField = (
    label,
    field,
    value,
    placeholder,
    explanation,
    intent = ""
  ) => (
    <FormGroup
      label={label}
      helperText={explanation}
      intent={intent}
    >
      <div className="flex items-center space-x-2">
        <InputGroup
          value={value || ""}
          onChange={(e) => handleInputChange(field, e.target.value)}
          readOnly={!editMode[field]}
          placeholder={placeholder}
          className="flex-1"
          rightElement={
            <Button
              icon={editMode[field] ? "tick" : "edit"}
              intent="primary"
              minimal
              title={editMode[field] ? "Lock this field" : "Edit this field"}
              text={editMode[field] ? "lock" : "edit"}
              onClick={() => toggleEdit(field)}
            />
          }
        />
      </div>
    </FormGroup>
  );

  if (!settingsForm) return <div>Loading...</div>;

  return (
    <Card>
      <H3>Settings</H3>
      <div className="bp5-form-group">
        <div className="bp5-form-content">
          <div className="bp5-form-helper-text">
            View or edit your settings for BIOMERO here!
          </div>

          <div className="bp5-form-helper-text">
            Each setting is marked with an icon indicating when it takes effect:
          </div>
          <div className="bp5-form-helper-text flex items-center gap-1">
            <RuntimeIcon /> <i>runtime</i> — applies immediately after saving.
          </div>
          <div className="bp5-form-helper-text flex items-center gap-1">
            <SlurmInitIcon /> <i>Slurm Init</i> — requires running the <b>Slurm Init</b> script to deploy to the cluster.
          </div>

          <div className="bp5-form-helper-text">
            Use <b>Slurm Check Setup</b> to verify which workflows are actually installed on your Slurm cluster.
          </div>

          <div className="bp5-form-helper-text">
            Please check the{" "}
            <a
              href="https://nl-bioimaging.github.io/biomero/"
              target="_blank"
              rel="noopener noreferrer"
            >
              BIOMERO documentation
            </a>{" "}
            for more info.
          </div>
        </div>
      </div>

      <CollapsibleSection title={<span className="inline-flex items-center gap-1">SSH Settings <SlurmInitIcon /></span>}>
        <div className="bp5-form-group">
          <div className="bp5-form-content">
            <div className="bp5-form-helper-text">
              Settings for BIOMERO's SSH connection to Slurm.
            </div>
            <div className="bp5-form-helper-text">
              Set the rest of your SSH configuration in your SSH config under
              this host name/alias. Or in e.g. /etc/fabric.yml (see{" "}
              <a
                href="https://docs.fabfile.org/en/latest/concepts/configuration.html"
                target="_blank"
                rel="noopener noreferrer"
              >
                Fabric's documentation
              </a>{" "}
              for details on config loading).
            </div>
          </div>
        </div>
        {renderEditableField(
          "SSH Host",
          "SSH.host",
          settingsForm.SSH.host,
          "Enter SSH Host",
          "The alias for the SSH connection for connecting to Slurm."
        )}
      </CollapsibleSection>
      <CollapsibleSection title="Slurm Settings">
        <div className="bp5-form-group">
          <div className="bp5-form-content">
            <div className="bp5-form-helper-text">
              General settings for where to find things on the Slurm cluster.{" "}
              <a href={DOCS_URL} target="_blank" rel="noopener noreferrer">Documentation ↗</a>
            </div>
          </div>
        </div>
        <CollapsibleSection title={<span className="inline-flex items-center gap-1">Paths <SlurmInitIcon /></span>} nested>
          <div className="bp5-form-group">
            <div className="bp5-form-content">
              <div className="bp5-form-helper-text">
                You should prefer to use full paths, but you could use relative
                paths compared to the Slurm user's home dir if you omit the
                starting '/'.
              </div>
            </div>
          </div>
          {renderEditableField(
            "Slurm Data Path",
            "SLURM.slurm_data_path",
            settingsForm.SLURM.slurm_data_path,
            "/data/my-scratch/data",
            "The path on SLURM entrypoint for storing datafiles."
          )}
          {renderEditableField(
            "Slurm Images Path",
            "SLURM.slurm_images_path",
            settingsForm.SLURM.slurm_images_path,
            "/data/my-scratch/singularity_images/workflows",
            "The path on SLURM entrypoint for storing container image files."
          )}
          {renderEditableField(
            "Slurm Converters Path",
            "SLURM.slurm_converters_path",
            settingsForm.SLURM.slurm_converters_path,
            "/data/my-scratch/singularity_images/converters",
            "The path on SLURM entrypoint for storing converter image files."
          )}
          {renderEditableField(
            "Slurm Script Path",
            "SLURM.slurm_script_path",
            settingsForm.SLURM.slurm_script_path,
            "/data/my-scratch/slurm-scripts",
            "The path on SLURM entrypoint for storing the Slurm job scripts."
          )}
          {renderEditableField(
            "Slurm Data Bind Path",
            "SLURM.slurm_data_bind_path",
            settingsForm.SLURM.slurm_data_bind_path,
            "",
            "Exported as APPTAINER_BINDPATH for workflow jobs. Configure if your HPC administrator requires it. Example: /data/my-scratch/data. Leave blank if not needed."
          )}
          {renderEditableField(
            <span className="inline-flex items-center gap-1">Apptainer Tmp Dir <SlurmInitIcon /></span>,
            "SLURM.apptainer_tmpdir",
            settingsForm.SLURM?.apptainer_tmpdir,
            "",
            <>
              Path for Apptainer/Singularity temporary files (sets APPTAINER_TMPDIR). Useful when <code>/tmp</code> is too small on your login or worker nodes — applies to image pulls and job execution. Leave blank for system default. SLURM Init creates this dir if set.
              <ExampleNote>/scratchdata/$USER/.apptainer-tmp</ExampleNote>
              <EnvVarNote vars={["BIOMERO_APPTAINER_TMPDIR"]} />
            </>
          )}
          {renderEditableField(
            <span className="inline-flex items-center gap-1">Apptainer Cache Dir <SlurmInitIcon /></span>,
            "SLURM.apptainer_cachedir",
            settingsForm.SLURM?.apptainer_cachedir,
            "",
            <>
              Path for the Apptainer/Singularity image cache (sets APPTAINER_CACHEDIR). Useful when the default cache location is too small — applies to image pulls and job execution. Leave blank for system default. SLURM Init creates this dir if set.
              <ExampleNote>/scratchdata/$USER/.apptainer-cache</ExampleNote>
              <EnvVarNote vars={["BIOMERO_APPTAINER_CACHEDIR"]} />
            </>
          )}
        </CollapsibleSection>
        <CollapsibleSection title={<span className="inline-flex items-center gap-1">SACCT History Window <RuntimeIcon /></span>} nested>
          <div className="bp5-form-group">
            <div className="bp5-form-content">
              <div className="bp5-form-helper-text">
                How far back BIOMERO looks when querying job history via <code>sacct</code>. Default: 2023-01-01.
                Option 1: absolute date (YYYY-MM-DD). Option 2: rolling window in days (overrides option 1).
              </div>
            </div>
          </div>
          {renderEditableField(
            "SACCT Start Time",
            "SLURM.sacct_start_time",
            settingsForm.SLURM?.sacct_start_time,
            "",
            <>
              Absolute start date (YYYY-MM-DD). Leave blank for built-in default.
              <ExampleNote>2024-01-01</ExampleNote>
              <EnvVarNote vars={["BIOMERO_SACCT_START_TIME"]} />
            </>
          )}
          {renderEditableField(
            "SACCT Days Ago",
            "SLURM.sacct_days_ago",
            settingsForm.SLURM?.sacct_days_ago,
            "",
            <>
              Rolling window in days (relative to today). Overrides SACCT Start Time if both are set. Leave blank for absolute date or built-in default.
              <ExampleNote>7</ExampleNote>
              <EnvVarNote vars={["BIOMERO_SACCT_START_DAYS_AGO"]} />
            </>
          )}
        </CollapsibleSection>
        <CollapsibleSection title={<span className="inline-flex items-center gap-1">Repositories <SlurmInitIcon /></span>} nested>
          <div className="bp5-form-group">
            <div className="bp5-form-content">
              <div className="bp5-form-helper-text">
                Leave empty (default) — BIOMERO will generate job scripts from the{" "}
                <a
                  href="https://github.com/NL-BioImaging/biomero/blob/main/resources/job_template.sh"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  job_template
                </a>{" "}
                and each workflow's descriptor.json. Only set this if you need custom scripts for every workflow.
              </div>
            </div>
          </div>
          {renderEditableField(
            <span className="inline-flex items-center gap-1">Slurm Script Repository <SlurmInitIcon /></span>,
            "SLURM.slurm_script_repo",
            settingsForm.SLURM.slurm_script_repo,
            "",
            "Git repository URL for custom Slurm job scripts. Leave empty to use auto-generated scripts (recommended).",
            "danger"
          )}
        </CollapsibleSection>
        <CollapsibleSection title="Processing Settings" nested>
          <div className="bp5-form-group">
            <div className="bp5-form-content">
              <div className="bp5-form-helper-text">
                Advanced opt-in settings, all <strong>off by default</strong>. Enable only what your cluster requires.
              </div>
            </div>
          </div>
          <H6><span className="inline-flex items-center gap-1">Job Script Generation <SlurmInitIcon /></span></H6>
          <div className="bp5-form-group">
            <div className="bp5-form-content">
              <div className="bp5-form-helper-text">
                Writes job env vars to a per-job file instead of SSH inline propagation.
                Enable when <code>sbatch</code> jobs do not inherit SSH session env vars.
                <EnvVarNote vars={["BIOMERO_ENV_FILE_SUBMISSION"]} />
              </div>
            </div>
          </div>
          <Switch
            checked={settingsForm.SLURM?.env_file_submission === "true"}
            label="Env-File Submission"
            onChange={(e) =>
              handleInputChange(
                "SLURM.env_file_submission",
                e.target.checked ? "true" : "false"
              )
            }
          />
          <div className="bp5-form-group">
            <div className="bp5-form-content">
              <div className="bp5-form-helper-text">
                Rewrites <code>singularity run --nv</code> to a <code>USE_GPU</code>-gated flag so one script runs on both CPU and GPU partitions.
                <EnvVarNote vars={["BIOMERO_INJECT_GPU_FLAG"]} />
              </div>
            </div>
          </div>
          <Switch
            checked={settingsForm.SLURM?.inject_gpu_flag === "true"}
            label="Inject GPU Flag"
            onChange={(e) =>
              handleInputChange(
                "SLURM.inject_gpu_flag",
                e.target.checked ? "true" : "false"
              )
            }
          />
          <H6><span className="inline-flex items-center gap-1">Partition &amp; GPU Fallback <RuntimeIcon /></span></H6>
          <div className="bp5-form-group">
            <div className="bp5-form-content">
              <div className="bp5-form-helper-text">
                Runtime defaults applied at sbatch submission. Per-workflow job parameters always take precedence. Leave blank if not needed.
              </div>
            </div>
          </div>
          {renderEditableField(
            <span className="inline-flex items-center gap-1">Default Partition <RuntimeIcon /></span>,
            "SLURM.slurm_default_partition",
            settingsForm.SLURM?.slurm_default_partition,
            "",
            <>
              Generic fallback <code>--partition</code> applied to both workflow and conversion jobs that do not already set a partition. Per-workflow params, the Conversion Partition, and GPU Partition always take precedence. Useful on clusters without a usable system default partition.
              <ExampleNote>cpu-short</ExampleNote>
              <EnvVarNote vars={["BIOMERO_DEFAULT_PARTITION"]} />
            </>
          )}
          {renderEditableField(
            <span className="inline-flex items-center gap-1">Slurm Conversion Partition <RuntimeIcon /></span>,
            "SLURM.slurm_conversion_partition",
            settingsForm.SLURM.slurm_conversion_partition,
            "",
            <>
              Partition for data conversion jobs (added as a real <code>--partition</code> flag on the conversion sbatch). Takes precedence over the Default Partition above. Leave empty to fall back to the Default Partition, or the system default if neither is set.
              <ExampleNote>cpu-short</ExampleNote>
            </>
          )}
          {renderEditableField(
            "GPU Partition",
            "SLURM.gpu_partition",
            settingsForm.SLURM?.gpu_partition,
            "",
            <>
              Fallback Slurm partition for GPU jobs. Leave blank if not needed.
              <ExampleNote>gpu</ExampleNote>
              <EnvVarNote vars={["BIOMERO_GPU_PARTITION"]} />
            </>
          )}
          {renderEditableField(
            "GPU GRES",
            "SLURM.gpu_gres",
            settingsForm.SLURM?.gpu_gres,
            "",
            <>
              Fallback <code>--gres</code> value for GPU jobs. Use for clusters that allocate GPUs via <code>--gres</code>. Mutually exclusive with GPU GPUS.
              <ExampleNote>gpu:a100:1</ExampleNote>
              <EnvVarNote vars={["BIOMERO_GPU_GRES"]} />
            </>
          )}
          {renderEditableField(
            "GPU GPUS",
            "SLURM.gpu_gpus",
            settingsForm.SLURM?.gpu_gpus,
            "",
            <>
              Fallback <code>--gpus</code> value for GPU jobs. Use for clusters that allocate GPUs via <code>--gpus</code>. Mutually exclusive with GPU GRES.
              <ExampleNote>1</ExampleNote>
              <EnvVarNote vars={["BIOMERO_GPU_GPUS"]} />
            </>
          )}
          {settingsForm.SLURM?.gpu_gres && settingsForm.SLURM?.gpu_gpus && (
            <div className="bp5-form-group">
              <div className="bp5-form-content">
                <div className="bp5-form-helper-text text-red-600 flex items-center gap-1">
                  <Icon icon="error" size={12} />
                  <strong>Conflict:</strong> <code>gpu_gres</code> and <code>gpu_gpus</code> are mutually exclusive — clear one of them.
                </div>
              </div>
            </div>
          )}
          <H6><span className="inline-flex items-center gap-1">Image Pull Settings <SlurmInitIcon /></span></H6>
          <div className="bp5-form-group">
            <div className="bp5-form-content">
              <div className="bp5-form-helper-text">
                Controls how BIOMERO pulls container images. Default: legacy background <code>nohup</code> on the login node.
                Enable scheduler-native pulling to use one bounded workflow-and-converter job array, node-local temporary storage, per-image logs, validation, and atomic publication.
                <EnvVarNote vars={["BIOMERO_IMAGE_PULL_VIA_SBATCH"]} />
              </div>
            </div>
          </div>
          <Switch
            checked={settingsForm.SLURM?.slurm_image_pull_via_sbatch === "true"}
            label="Pull Images via sbatch"
            onChange={(e) =>
              handleInputChange(
                "SLURM.slurm_image_pull_via_sbatch",
                e.target.checked ? "true" : "false"
              )
            }
          />
          {renderEditableField(
            "Pull CPUs",
            "SLURM.image_pull_cpus",
            settingsForm.SLURM?.image_pull_cpus,
            "",
            <>
              CPUs for sbatch image pull jobs. Leave blank to inherit <code>sbatch_cpus-per-task</code>, then the scheduler default.
              <ExampleNote>2</ExampleNote>
              <EnvVarNote vars={["BIOMERO_PULL_CPUS"]} />
            </>
          )}
          {renderEditableField(
            "Pull Memory",
            "SLURM.image_pull_mem",
            settingsForm.SLURM?.image_pull_mem,
            "",
            <>
              Memory for sbatch image pull jobs. Leave blank to inherit <code>sbatch_mem</code>, then the scheduler default.
              <ExampleNote>4G</ExampleNote>
              <EnvVarNote vars={["BIOMERO_PULL_MEM"]} />
            </>
          )}
          {renderEditableField(
            "Pull Time",
            "SLURM.image_pull_time",
            settingsForm.SLURM?.image_pull_time,
            "",
            <>
              Time limit for the combined workflow and converter image array. Leave blank to inherit <code>sbatch_time</code> when configured.
              <ExampleNote>1-00:00:00</ExampleNote>
              <EnvVarNote vars={["BIOMERO_PULL_TIME"]} />
            </>
          )}
          {renderEditableField(
            "Pull Concurrency",
            "SLURM.image_pull_concurrency",
            settingsForm.SLURM?.image_pull_concurrency,
            "",
            <>
              Maximum image array tasks running simultaneously. Default: 1 for compatibility; 2–4 is recommended to protect shared storage.
              <ExampleNote>4</ExampleNote>
              <EnvVarNote vars={["BIOMERO_PULL_CONCURRENCY"]} />
            </>
          )}
          {renderEditableField(
            "Pull Partition",
            "SLURM.image_pull_partition",
            settingsForm.SLURM?.image_pull_partition,
            "",
            <>
              Dedicated partition for image initialization. Leave blank to inherit <code>sbatch_partition</code>. This value overrides the global flag when set.
              <EnvVarNote vars={["BIOMERO_PULL_PARTITION"]} />
            </>
          )}
          <H6><span className="inline-flex items-center gap-1">ZIP Command <RuntimeIcon /></span></H6>
          <div className="bp5-form-group">
            <div className="bp5-form-content">
              <div className="bp5-form-helper-text">
                ZIP command for archiving result files on the cluster. Leave blank to auto-detect
                (<code>7z</code> or <code>7za</code> in PATH). Set <code>zip</code> to use the
                Info-ZIP <code>zip</code>/<code>unzip</code> pair.
              </div>
            </div>
          </div>
          {renderEditableField(
            "Slurm Zip Command",
            "SLURM.slurm_zip_cmd",
            settingsForm.SLURM?.slurm_zip_cmd,
            "",
            <>
              Executable name or path. Leave blank to auto-detect (<code>7z</code> or <code>7za</code> in PATH).
              <code>zip</code> selects Info-ZIP syntax and requires the matching <code>unzip</code> executable.
              <ExampleNote>zip</ExampleNote>
              <EnvVarNote vars={["BIOMERO_SLURM_ZIP_CMD"]} />
            </>
          )}
          <H6><span className="inline-flex items-center gap-1">Global Sbatch Parameters <RuntimeIcon /></span></H6>
          <div className="bp5-form-group">
            <div className="bp5-form-content">
              <div className="bp5-form-helper-text">
                Additional <code>sbatch</code> flags applied to workflow, conversion, and scheduled image-pull submissions.
                Per-workflow, conversion-specific, and dedicated image-pull values take precedence.
                Stored as <code>sbatch_flag=value</code> in the config.
              </div>
              <div className="bp5-form-helper-text">
                Useful for short-lived cluster-wide settings like a reservation or priority adjustment.
                <ExampleNote>reservation=biomero</ExampleNote>
              </div>
            </div>
          </div>
          {globalSbatchParams.map((param, index) => (
            <div key={index} className="flex items-center space-x-2 mb-2">
              <InputGroup
                value={param.key}
                placeholder="flag (e.g. reservation)"
                onChange={(e) => {
                  const updated = [...globalSbatchParams];
                  updated[index] = { ...updated[index], key: e.target.value };
                  setGlobalSbatchParams(updated);
                }}
                className="flex-1"
              />
              <span className="text-gray-500 font-mono px-1">=</span>
              <InputGroup
                value={param.value}
                placeholder="value (e.g. biomero)"
                onChange={(e) => {
                  const updated = [...globalSbatchParams];
                  updated[index] = { ...updated[index], value: e.target.value };
                  setGlobalSbatchParams(updated);
                }}
                className="flex-1"
              />
              <Button
                icon="delete"
                minimal
                intent="danger"
                onClick={() => setGlobalSbatchParams(globalSbatchParams.filter((_, i) => i !== index))}
              />
            </div>
          ))}
          <Button
            icon="add"
            minimal
            intent="primary"
            onClick={() => setGlobalSbatchParams([...globalSbatchParams, { key: "", value: "" }])}
          >
            Add Parameter
          </Button>
        </CollapsibleSection>
      </CollapsibleSection>
      <CollapsibleSection title={<span className="inline-flex items-center gap-1">UI Settings <RuntimeIcon /></span>} errorCount={getMaxBatchJobsError() ? 1 : 0}>
        <div className="bp5-form-group">
          <div className="bp5-form-content">
            <div className="bp5-form-helper-text">
              Settings that control the user interface behavior and limits.
            </div>
          </div>
        </div>
        <H6>Batch Processing Limits</H6>
        <div className="bp5-form-group">
          <div className="bp5-form-content">
            <div className="bp5-form-helper-text">
              Configure the maximum number of parallel batch jobs users can create when processing large datasets.
              Lower values reduce server load but may limit processing capability for very large datasets.
            </div>
            <div className="bp5-form-helper-text">
              <strong>Note:</strong> Users can still choose fewer jobs than this maximum. This only sets the upper limit.
            </div>
          </div>
        </div>
        <H6>Dangerous Jobs Control</H6>
        <div className="bp5-form-group">
          <div className="bp5-form-content">
            <div className="bp5-form-helper-text">
              Control whether users can enable processing with more than 10 jobs. When disabled, users will be limited to the safe range (2-10 jobs).
            </div>
            <div className="bp5-form-helper-text font-bold text-red-500">
              <strong>Caution:</strong> Enabling dangerous jobs allows users to create many parallel jobs, which can overwhelm the SLURM cluster and affect other users. It also increases the chance of errors in (BI)OMERO scripts, possibly causing job failures.
            </div>
            <div className="bp5-form-helper-text">
              <strong>Recommendation:</strong> Keep this enabled for power users who understand the implications, disable for safer general usage.
            </div>
          </div>
        </div>
        <Switch
          checked={settingsForm.UI?.allow_dangerous_jobs !== "false"}
          label="Allow users to enable dangerous jobs (>10)"
          onChange={(e) =>
            handleInputChange("UI.allow_dangerous_jobs", e.target.checked ? "true" : "false")
          }
        />
        <H6>Maximum Batch Jobs Limit</H6>
        <div className="bp5-form-group">
          <div className="bp5-form-content">
            <div className="bp5-form-helper-text">
              Set the absolute maximum number of parallel batch jobs when dangerous jobs are enabled above. This setting applies regardless of dataset size.
            </div>
            <div className="bp5-form-helper-text font-bold text-orange-500">
              <strong>Note:</strong> This limit is only relevant when "Allow dangerous jobs" is enabled. When disabled, users are limited to 2-10 jobs regardless of this setting.
            </div>
            <div className="bp5-form-helper-text">
              Lower values reduce server load but may limit processing capability for very large datasets.
            </div>
          </div>
        </div>
        <FormGroup
          label="Max Batch Jobs (when dangerous jobs enabled)"
          helperText="Maximum number of parallel batch jobs allowed (10-1000). Default: 100. Only applies when dangerous jobs are enabled."
          intent={getMaxBatchJobsError() ? "danger" : "primary"}
        >
          <InputGroup
            id="UI.max_batch_jobs"
            placeholder="100"
            value={settingsForm.UI?.max_batch_jobs || ""}
            onChange={(e) => handleInputChange("UI.max_batch_jobs", e.target.value)}
            intent={getMaxBatchJobsError() ? "danger" : "none"}
          />
          {getMaxBatchJobsError() && (
            <div className="text-red-500 text-sm mt-1">
              {getMaxBatchJobsError()}
            </div>
          )}
        </FormGroup>
      </CollapsibleSection>
      <CollapsibleSection title={<span className="inline-flex items-center gap-1">Analytics Settings <SlurmInitIcon /></span>}>
        <div className="bp5-form-group">
          <div className="bp5-form-content">
            <div className="bp5-form-helper-text">
              General settings to control workflow tracking and listeners for
              detailed monitoring and insights.
            </div>
          </div>
        </div>
        <H6>Workflow Tracker Settings</H6>
        <div className="bp5-form-group">
          <div className="bp5-form-content">
            <div className="bp5-form-helper-text">
              The workflow tracker collects and logs information on workflow
              execution, job statuses, and related analytics. This is the main
              switch to enable or disable workflow tracking as a whole.
            </div>
            <div className="bp5-form-helper-text font-bold text-red-500">
              Note that this tracking data is a requirement for adding metadata
              in OMERO and viewing the dashboard in the Status tab (above).
            </div>
            <div className="bp5-form-helper-text font-bold text-red-500">
              If disabled, none of the listeners below will be activated,
              regardless of their individual settings.
            </div>
          </div>
        </div>
        <Switch
          checked={settingsForm.ANALYTICS.track_workflows}
          label="Track Workflows"
          onChange={(e) =>
            handleInputChange("ANALYTICS.track_workflows", e.target.checked)
          }
        />
        <H6>Database configuration</H6>
        {renderEditableField(
          "SQLAlchemy URL",
          "ANALYTICS.sqlalchemy_url",
          settingsForm.ANALYTICS.sqlalchemy_url,
          "",
          <>
            PostgreSQL connection URL for analytics storage. Prefer setting the{" "}
            <code>SQLALCHEMY_URL</code> environment variable instead (safer — it takes priority). See{" "}
            <a href="https://docs.sqlalchemy.org/en/20/core/engines.html#database-urls" target="_blank" rel="noopener noreferrer">SQLAlchemy docs</a>.
            <ExampleNote>postgresql+psycopg2://user:password@localhost:5432/db</ExampleNote>
            <EnvVarNote vars={["SQLALCHEMY_URL"]} />
          </>,
          "danger"
        )}
        <H6>Listener Settings</H6>
        <div className="bp5-form-group">
          <div className="bp5-form-content">
            <div className="bp5-form-helper-text">
              Listeners provide detailed monitoring and insights for specific
              aspects of workflow execution. Each listener can be enabled or
              disabled independently.
            </div>
            <div className="bp5-form-helper-text">
              Note that listeners can be retroactively updated with (historic)
              workflow tracking data. So you can turn on a listener later, and
              it will read all the previous workflow events. This does not work
              the other way around: if you do not track workflow data, you can
              never listen to it.
            </div>
          </div>
        </div>
        <b>Job Accounting Listener</b>
        <div className="bp5-form-group">
          <div className="bp5-form-content">
            <div className="bp5-form-helper-text">
              Monitors job accounting data such as resource usage (CPU, memory)
              and SLURM job states (completed, failed).
            </div>
            <div className="bp5-form-helper-text">
              Useful if you need to know Slurm resource usage per OMERO user.
              E.g. for cost forwarding.
            </div>
          </div>
        </div>
        <Switch
          checked={settingsForm.ANALYTICS.enable_job_accounting}
          label="Enable Job Accounting"
          onChange={(e) =>
            handleInputChange(
              "ANALYTICS.enable_job_accounting",
              e.target.checked
            )
          }
        />
        <b>Job Progress Listener</b>
        <div className="bp5-form-group">
          <div className="bp5-form-content">
            <div className="bp5-form-helper-text">
              Tracks the progress of SLURM jobs, capturing intermediate statuses
              for real-time insights into job execution.
            </div>
            <div className="bp5-form-helper-text">
              Required for the `Status` dashboard progress graph.
            </div>
          </div>
        </div>
        <Switch
          checked={settingsForm.ANALYTICS.enable_job_progress}
          label="Enable Job Progress"
          onChange={(e) =>
            handleInputChange("ANALYTICS.enable_job_progress", e.target.checked)
          }
        />
        <b>Workflow Analytics Listener</b>
        <div className="bp5-form-group">
          <div className="bp5-form-content">
            <div className="bp5-form-helper-text">
              Provides detailed insights into workflow performance, including
              execution times, bottlenecks, and overall efficiency.
            </div>
            <div className="bp5-form-helper-text">
              Required for the `Status` dashboard analytics graphs.
            </div>
          </div>
        </div>
        <Switch
          checked={settingsForm.ANALYTICS.enable_workflow_analytics}
          label="Enable Workflow Analytics"
          onChange={(e) =>
            handleInputChange(
              "ANALYTICS.enable_workflow_analytics",
              e.target.checked
            )
          }
        />
        <H6>Analytics Rebuild Window</H6>
        <div className="bp5-form-group">
          <div className="bp5-form-content">
            <div className="bp5-form-helper-text">
              Caps how far back the event replay goes during SLURM Init. Useful
              on large installations where a full rebuild is slow.{" "}
              <strong>Caution:</strong> view tables built from partial history
              will not show older jobs. Leave both blank for full rebuild (default).
            </div>
          </div>
        </div>
        {renderEditableField(
          "Rebuild From Date",
          "ANALYTICS.analytics_rebuild_start_time",
          settingsForm.ANALYTICS?.analytics_rebuild_start_time,
          "",
          <>
            Absolute cutoff date (YYYY-MM-DD). Leave blank for full rebuild.
            <ExampleNote>2026-01-01</ExampleNote>
            <EnvVarNote vars={["BIOMERO_ANALYTICS_REBUILD_START_TIME"]} />
          </>
        )}
        {renderEditableField(
          "Rebuild From Days Ago",
          "ANALYTICS.analytics_rebuild_days_ago",
          settingsForm.ANALYTICS?.analytics_rebuild_days_ago,
          "",
          <>
            Rolling window in days (relative to today). Overrides Rebuild From Date if both are set. Leave blank for full rebuild.
            <ExampleNote>30</ExampleNote>
            <EnvVarNote vars={["BIOMERO_ANALYTICS_REBUILD_DAYS_AGO"]} />
          </>
        )}
      </CollapsibleSection>
      <CollapsibleSection title={<span className="inline-flex items-center gap-1">Converters Settings <SlurmInitIcon /></span>}>
        <ConfigSection
          items={converters}
          onItemChange={handleConverterChange}
          onAddItem={handleAddConverter}
          onDeleteItem={handleRemoveConverter}
          onResetItem={resetConverter}
          CardComponent={ConverterCard}
          title="Converter"
          description={[
            "Settings for linking to external data format converters for running on Slurm.",
            "By default, BIOMERO exports images as ZARR to the HPC. But, the workflow you want to execute might require a different filetype. E.g. most of our example workflows require TIFF input files. This is the default for BIAFLOWS.",
            "If you provide nothing, BIOMERO will build a converter on Slurm for you. Instead, you can add converters here to pull those instead. These should be available on DockerHub as a container image. If you don't have singularity build rights on Slurm, you can also use this field instead to pull.",
            "Please pin it to a specific version to reduce unforeseen errors. Key should be the types 'X_to_Y' and value should be the docker image, for example `zarr_to_tiff=cellularimagingcf/convert_zarr_to_tiff:2.0.0-alpha.9`",
          ]}
          errors={errors} // Pass errors to ConfigSection
          validateField={validateField} // Pass validation function to ConfigSection
        />
      </CollapsibleSection>
      <CollapsibleSection 
        title={<span className="inline-flex items-center gap-1">Workflows Settings <SlurmInitIcon /></span>} 
        versionSummary={getVersionSummary()}
        versionCheckLoading={versionCheckLoading}
        onRefresh={manualRefreshVersions}
        errorCount={Object.keys(modelErrors).length}
      >
        <ConfigSection
          items={settingsForm.WORKFLOWS}
          onItemChange={(index, field, value, options = {}) =>
            handleModelChange(index, field, value, options)
          }
          onAddItem={addModel}
          onAddParam={(index, key, value) => {
            const updatedModels = structuredClone(settingsForm.WORKFLOWS);

            if (!key) {
              console.error("Key is required to add or delete parameters.");
              return;
            }

            if (!updatedModels[index].extraParams) {
              updatedModels[index].extraParams = {};
            }

            if (value === null || value === "") {
              delete updatedModels[index].extraParams[key];
            } else {
              const modelName =
                updatedModels[index].name?.toLowerCase().replace(/\s+/g, "_") ||
                `model_${index + 1}`;
              const formattedKey = key.startsWith(`${modelName}_job_`)
                ? key
                : `${modelName}_job_${key}`;

              updatedModels[index].extraParams[formattedKey] = value;
            }

            setSettingsForm((prev) => ({ ...prev, WORKFLOWS: updatedModels }));
          }}
          onDeleteItem={handleDeleteModel}
          onResetItem={resetModel}
          CardComponent={ModelCard}
          title="Workflow"
          description={[
            "Settings for workflows/singularity images that we want to run on Slurm.",
            "Workflow names have to be unique, and require a GitHub repository as well.",
            "Versions for the GitHub repository are highly encouraged! Latest/master can change and cause issues with reproducability! BIOMERO picks up the container version based on the version of the repository. If you provide no version, BIOMERO will pick up the generic latest container.",
            "⚠️ Adding, removing, or renaming workflows requires running the SLURM Init script so job scripts are generated and container images are pulled.",
          ]}
          errors={modelErrors}
          validateField={null} // Per-field live validation not needed; duplicate check runs via useEffect
          versionStatus={versionStatus} // Pass version check results
          versionCheckLoading={versionCheckLoading} // Pass loading state
          config={state.config} // Pass config for workflow type detection
          onRepoBlur={handleRepoUrlBlur} // Pass repo blur handler
          descriptorMetadata={descriptorMetadata} // Descriptor flags from already-fetched workflow metadata
          gpuSettings={{
            gpu_partition: settingsForm.SLURM?.gpu_partition || "",
            gpu_gres: settingsForm.SLURM?.gpu_gres || "",
            gpu_gpus: settingsForm.SLURM?.gpu_gpus || "",
          }}
          globalJobParams={{
            sbatchParams: globalSbatchParams,
            defaultPartition: settingsForm.SLURM?.slurm_default_partition || "",
          }}
        />
      </CollapsibleSection>
      <H5>Note on saving BIOMERO settings</H5>
      <div className="bp5-form-group">
        <div className="bp5-form-content">
          <div className="bp5-form-helper-text">
            {state.configMode === "authoritative" ? (
              <>
                This admin page manages BIOMERO's authoritative configuration
                file. Adding, changing, and deleting settings here affects the
                shared file directly. Environment variables on runtime workers
                can still override saved values; OMERO.web cannot inspect or
                display those worker-local overrides.
              </>
            ) : (
              <>
                This deployment uses BIOMERO's legacy layered configuration.
                Values from system configuration files can reappear after they
                are removed here. Set <code>BIOMERO_SLURM_CONFIG_FILE</code> in
                both OMERO.web and the BIOMERO worker to enable authoritative
                configuration management.
              </>
            )}
          </div>
        </div>
      </div>
      <ButtonGroup>
        <Tooltip
          content={hasValidationErrors() ? "Please fix validation errors before saving" : "Please save your changes"}
          intent={hasValidationErrors() ? "danger" : "none"}
          isOpen={(hasChanges && showSaveTooltip) || hasValidationErrors()}
          compact={true}
          placement="bottom"
        >
          <Button
            icon={loading ? <Spinner size={16} /> : "floppy-disk"}
            intent={hasValidationErrors() ? "danger" : (hasChanges && showSaveTooltip ? "primary" : "none")}
            disabled={hasValidationErrors()}
            onClick={() => {
              if (!hasValidationErrors()) {
                submitConfig();
              }
            }}
          >
            Save Settings
          </Button>
        </Tooltip>
        <Tooltip
          content="You can still reset (and save again!) if you made a mistake"
          intent="none"
          isOpen={hasChanges && showResetTooltip}
          compact={true}
          placement="bottom"
        >
          <Button
            icon="reset"
            intent={hasChanges ? "warning" : "none"}
            disabled={!hasChanges}
            onClick={resetForm}
          >
            Undo All Changes
          </Button>
        </Tooltip>
      </ButtonGroup>
    </Card>
  );
};

export default SettingsForm;
