import React, { useState, useEffect } from "react";
import {
  Card,
  FormGroup,
  InputGroup,
  Button,
  Switch,
  H3,
  H5,
  H6,
  ButtonGroup,
  Tooltip,
  Spinner,
} from "@blueprintjs/core";
import { useAppContext } from "../../AppContext";
import CollapsibleSection from "./CollapsibleSection";
import ConfigSection from "./ConfigSection";
import ModelCard from "./ModelCard.js";
import ConverterCard from "./ConverterCard.js";

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

  const [converters, setConverters] = useState([]);
  const [errors, setErrors] = useState({});

  useEffect(() => {
    if (JSON.stringify(settingsForm) !== JSON.stringify(initialFormData)) {
      setHasChanges(true);
    } else {
      if (
        JSON.stringify(converters) !==
        JSON.stringify(initialFormData?.CONVERTERS)
      ) {
        setHasChanges(true);
      } else {
        setHasChanges(false);
      }
    }
  }, [settingsForm, initialFormData, converters]);

  const fetchInitialFormState = async () => {
    if (state.config) {
      const mappedModels = Object.entries(state.config.MODELS || {})
        .filter(([key]) => key.endsWith("_repo")) // Filter for relevant keys
        .map(([key, value]) => {
          const prefix = key.replace("_repo", ""); // Extract the prefix
          return {
            name: state.config.MODELS[prefix], // e.g., "cellpose"
            repo: value, // e.g., the repo URL
            job: state.config.MODELS[`${prefix}_job`], // e.g., "jobs/cellpose.sh"
            extraParams: extractExtraParams(prefix), // Handle the extraParams here
          };
        });

      const mappedConverters = Object.entries(
        state.config.CONVERTERS || {}
      ).map(([key, value]) => ({ key, value }));
      // store a version to 'reset' to
      setInitialFormData({
        ...state.config,
        MODELS: mappedModels,
        CONVERTERS: mappedConverters,
      });
      // the living version to be changed by the UI
      setSettingsForm({
        ...state.config,
        MODELS: mappedModels,
        CONVERTERS: mappedConverters,
      });

      setConverters(mappedConverters);
    }
  };

  const extractExtraParams = (prefix) => {
    const extraParams = {};
    Object.entries(state.config.MODELS).forEach(([key, value]) => {
      if (key.startsWith(`${prefix}_job_`)) {
        const paramKey = key;
        extraParams[paramKey] = value;
      }
    });
    return extraParams;
  };

  useEffect(() => {
    loadBiomeroConfig();
  }, []); // called only once

  useEffect(() => {
    fetchInitialFormState();
  }, [state.config]); // setup our form

  const toggleEdit = (field) => {
    setEditMode((prev) => ({ ...prev, [field]: !prev[field] }));
  };

  const handleModelChange = (index, field, value) => {
    const updatedModels = structuredClone(settingsForm.MODELS);
    updatedModels[index][field] = value;

    if (field === "name" && settingsForm.SLURM.slurm_script_repo === "") {
      updatedModels[index]["job"] = `jobs/${value}.sh`;
    }

    setSettingsForm((prev) => ({ ...prev, MODELS: updatedModels }));
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
      MODELS: [...prev.MODELS, { name: "", repo: "", job: "" }],
    }));
  };

  const handleDeleteModel = (index) => {
    setSettingsForm((prev) => {
      const updatedModels = prev.MODELS.filter((_, i) => i !== index);
      return { ...prev, MODELS: updatedModels };
    });
  };

  const resetModel = (index) => {
    if (!initialFormData) return;

    setSettingsForm((prev) => {
      const updatedModels = [...prev.MODELS];
      if (initialFormData.MODELS[index]) {
        updatedModels[index] = initialFormData.MODELS[index]; // Restore model from initial data
      } else {
        updatedModels[index] = { name: "", repo: "", job: "" }; // Reset to default if it's a new model
      }

      return { ...prev, MODELS: updatedModels };
    });
  };

  const resetForm = () => {
    fetchInitialFormState();
    setShowSaveTooltip(true);
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
    setLoading(true);
    try {
      // Prepare the config with current converters for saving
      const configToSave = {
        ...settingsForm,
        CONVERTERS: converters, // Use current converters state
      };
      
      // Update the form state for UI consistency (async)
      if (Object.keys(errors).length === 0) {
        setSettingsForm((prev) => ({
          ...prev,
          CONVERTERS: converters,
        }));
      }
      
      await saveConfigData(transformSettingsFormToPayload(configToSave));
      setShowSaveTooltip(false); // Hide "Don't forget to save"
      setShowResetTooltip(true); // Show "Reload to apply changes"
    } finally {
      setLoading(false);
    }
  };

  const transformSettingsFormToPayload = (settingsForm) => {
    const models = settingsForm.MODELS.reduce((acc, model) => {
      acc[model.name] = model.name;
      acc[`${model.name}_repo`] = model.repo;
      acc[`${model.name}_job`] = model.job;
      if (model.extraParams) {
        Object.entries(model.extraParams).forEach(([key, value]) => {
          acc[key] = value;
        });
      }
      return acc;
    }, {});

    const converters = settingsForm.CONVERTERS.reduce((acc, converter) => {
      acc[converter.key] = converter.value;
      return acc;
    }, {});

    return {
      ...settingsForm,
      CONVERTERS: converters,
      MODELS: models,
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
    <FormGroup label={label} helperText={explanation} intent={intent}>
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
            Note that some settings will apply immediately (like a model's{" "}
            <i>Additional Slurm Parameters</i>), but others might require setup.
          </div>

          <div className="bp5-form-helper-text">
            I would recommend running the <b>Slurm Init</b> script after
            changing these settings. You can also use <b>Slurm Check Setup</b>{" "}
            to see if its needed.
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

      <CollapsibleSection title="SSH Settings">
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
              General settings for where to find things on the Slurm cluster.
            </div>
          </div>
        </div>
        <H6>Paths</H6>
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
          "The path on SLURM entrypoint for storing datafiles"
        )}

        {renderEditableField(
          "Slurm Images Path",
          "SLURM.slurm_images_path",
          settingsForm.SLURM.slurm_images_path,
          "/data/my-scratch/singularity_images/workflows",
          "The path on SLURM entrypoint for storing container image files"
        )}

        {renderEditableField(
          "Slurm Converters Path",
          "SLURM.slurm_converters_path",
          settingsForm.SLURM.slurm_converters_path,
          "/data/my-scratch/singularity_images/converters",
          "The path on SLURM entrypoint for storing converter image files"
        )}

        {renderEditableField(
          "Slurm Script Path",
          "SLURM.slurm_script_path",
          settingsForm.SLURM.slurm_script_path,
          "/data/my-scratch/slurm-scripts",
          "The path on SLURM entrypoint for storing the slurm job scripts"
        )}

        {renderEditableField(
          "Slurm Data Bind Path",
          "SLURM.slurm_data_bind_path",
          settingsForm.SLURM.slurm_data_bind_path,
          "/data/my-scratch/data",
          "Path to bind to containers via APPTAINER_BINDPATH environment variable. Required when default data folder is not bound to container. Configure this if your HPC administrator tells you to set APPTAINER_BINDPATH."
        )}

        {renderEditableField(
          "Slurm Conversion Partition",
          "SLURM.slurm_conversion_partition",
          settingsForm.SLURM.slurm_conversion_partition,
          "cpu-short",
          "SLURM partition to use for conversion jobs when no default partition is configured on your HPC. Leave empty to use system default."
        )}
        <H6>Repositories</H6>
        <div className="bp5-form-group">
          <div className="bp5-form-content">
            <div className="bp5-form-helper-text">
              Note: If you provide no repository (the default), BIOMERO will
              generate scripts instead! These are based on the{" "}
              <a
                href="https://github.com/NL-BioImaging/biomero/blob/main/resources/job_template.sh"
                target="_blank"
                rel="noopener noreferrer"
              >
                job_template
              </a>{" "}
              and the descriptor.json of the workflow. This is the recommended
              way of working as it will be updated with future versions of
              BIOMERO and of your workflow.
            </div>
            <div className="bp5-form-helper-text">
              Note that you can provide most sbatch parameters per
              model/workflow (settings below) and don't need new scripts for
              that.
            </div>
            <div className="bp5-form-helper-text">
              However, perhaps you need specific code in your Slurm scripts. In
              that case, you have to provide a repository here and include in it
              a jobscript for <i>every</i> workflow. The internal path (in this
              repository) has to be configured per model, e.g.{" "}
              <code className="bp5-code">cellpose_job=jobs/cellpose.sh</code>
            </div>
          </div>
        </div>
        {renderEditableField(
          "Slurm Script Repository",
          "SLURM.slurm_script_repo",
          settingsForm.SLURM.slurm_script_repo,
          "Enter repository URL",
          "The Git repository to pull the Slurm scripts from. Recommended to leave this empty (default) to work with generated job scripts.",
          "danger"
        )}
      </CollapsibleSection>
      <CollapsibleSection title="Analytics Settings">
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
        <div className="bp5-form-group">
          <div className="bp5-form-content">
            <div className="bp5-form-helper-text">
              SQLAlchemy database connection URL for persisting workflow
              analytics data. This setting allows configuring the database
              connection for storing the tracking and analytics data.
              Environment variables will be used as the default, which is a bit
              safer.
            </div>
            <div className="bp5-form-helper-text">
              See{" "}
              <a
                href="https://docs.sqlalchemy.org/en/20/core/engines.html#database-urls"
                target="_blank"
                rel="noopener noreferrer"
              >
                SQLAlchemy docs
              </a>{" "}
              for more info and examples of database URLs supported by
              sqlalchemy. E.g.
              postgresql+psycopg2://user:password@localhost:5432/db.
            </div>
            <div className="bp5-form-helper-text font-bold text-red-500">
              Note: If SQLALCHEMY_URL is set as an environment variable on the
              BIOMERO server, it will override this setting. That is the
              recommended approach, but you could also set it here.
            </div>
            <div className="bp5-form-helper-text">
              Note2: This has to be a postgresql database.
            </div>
          </div>
        </div>
        {renderEditableField(
          "SQLAlchemy URL",
          "ANALYTICS.sqlalchemy_url",
          settingsForm.ANALYTICS.sqlalchemy_url,
          "postgresql+psycopg2://user:password@localhost:5432/db",
          "Database connection string for SQLAlchemy.",
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
      </CollapsibleSection>
      <CollapsibleSection title="Converters Settings">
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
      <CollapsibleSection title="Models Settings">
        <ConfigSection
          items={settingsForm.MODELS}
          onItemChange={(index, field, value) =>
            handleModelChange(index, field, value)
          }
          onAddItem={addModel}
          onAddParam={(index, key, value) => {
            const updatedModels = structuredClone(settingsForm.MODELS);

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

            setSettingsForm((prev) => ({ ...prev, MODELS: updatedModels }));
          }}
          onDeleteItem={handleDeleteModel}
          onResetItem={resetModel}
          CardComponent={ModelCard}
          title="Model"
          description={[
            "Settings for models/singularity images that we want to run on Slurm.",
            "Model names have to be unique, and require a GitHub repository as well.",
            "Versions for the GitHub repository are highly encouraged! Latest/master can change and cause issues with reproducability! BIOMERO picks up the container version based on the version of the repository. If you provide no version, BIOMERO will pick up the generic latest container.",
          ]}
          errors={null} // No error handling for models yet
          validateField={null} // No validation for models yet
        />
      </CollapsibleSection>
      <H5>Note on saving BIOMERO settings</H5>
      <div className="bp5-form-group">
        <div className="bp5-form-content">
          <div className="bp5-form-helper-text">
            Note that there are possibly <b>multiple</b> config files that
            BIOMERO reads from and combines into 1 final configuration.
          </div>
          <div className="bp5-form-helper-text">
            By default (in this order):
            <ol>
              <li>
                {" "}
                (1) <code>/etc/slurm-config.ini</code>{" "}
              </li>
              <li>
                {" "}
                (2) and <code>~/slurm-config.ini</code>{" "}
              </li>
              <li> (3) and environment variables that you set </li>
            </ol>
          </div>
          <div className="bp5-form-helper-text">
            We write these values in (2) the local{" "}
            <code>~/slurm-config.ini</code>, but read also from (1) the
            system-wide <code>/etc/slurm-config.ini</code>. So it could be that{" "}
            <b>removing</b> some setting here doesn't work because they are set
            in <code>/etc/slurm-config.ini</code>: if so, please contact your
            system administrator to change that file. <b>Adding</b> and/or{" "}
            <b>overwriting</b> values should always work, because{" "}
            <code>~/slurm-config.ini</code> is read and applied last (but before
            environment variables).
          </div>
        </div>
      </div>
      <ButtonGroup>
        <Tooltip
          content="Please save your changes"
          intent="none"
          isOpen={hasChanges && showSaveTooltip}
          compact={true}
          placement="bottom"
        >
          <Button
            icon={loading ? <Spinner size={16} /> : "floppy-disk"}
            intent={hasChanges && showSaveTooltip ? "primary" : "none"}
            onClick={() => {
              submitConfig();
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
