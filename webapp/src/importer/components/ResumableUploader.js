import React, { useEffect, useRef, useState } from "react";
import Uppy from "@uppy/core";
import Dashboard from "@uppy/dashboard";
import Tus from "@uppy/tus";
import "@uppy/core/dist/style.min.css";
import "@uppy/dashboard/dist/style.min.css";
import { importUploadedFile } from "../../apiService";
import { Callout, Intent } from "@blueprintjs/core";

const ResumableUploader = ({ datasetId, datasetType, group }) => {
  const dashboardRef = useRef(null);
  const uppyRef = useRef(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    // Create Uppy instance
    const uppyInstance = new Uppy({
      id: "uppy-uploader",
      debug: true,
      autoProceed: false,
      restrictions: {
        maxNumberOfFiles: null,
        minNumberOfFiles: 1,
      },
    }).use(Tus, {
      endpoint: "/omero_biomero/upload/",
      chunkSize: 2 * 1024 * 1024, // 2MB - smaller to avoid Django request size limits
      retryDelays: [0, 1000, 3000, 5000],
    });

    uppyRef.current = uppyInstance;
    setIsReady(true);

    return () => {
      uppyInstance.close();
    };
  }, []);

  useEffect(() => {
    if (!isReady || !dashboardRef.current || !uppyRef.current) return;

    // Mount Dashboard plugin
    uppyRef.current.use(Dashboard, {
      inline: true,
      target: dashboardRef.current,
      width: "100%",
      height: 500,
      showProgressDetails: true,
      proudlyDisplayPoweredByUppy: false,
      note: "Drag and drop files here or click to browse",
    });

    // Handle upload success
    const onUploadSuccess = async (file, response) => {
      console.log("Upload success:", file, response);
      if (!datasetId) {
        console.warn("No dataset selected, skipping import trigger");
        return;
      }
      try {
        await importUploadedFile(file.name, datasetId, datasetType, group);
        uppyRef.current.info(`Import queued for ${file.name}`, "success", 3000);
      } catch (error) {
        console.error("Import trigger failed", error);
        uppyRef.current.info(
          `Import failed for ${file.name}: ${error.message}`,
          "error",
          5000
        );
      }
    };

    uppyRef.current.on("upload-success", onUploadSuccess);

    return () => {
      if (uppyRef.current) {
        uppyRef.current.off("upload-success", onUploadSuccess);
        // Remove Dashboard plugin on cleanup
        const dashboardPlugin = uppyRef.current.getPlugin("Dashboard");
        if (dashboardPlugin) {
          uppyRef.current.removePlugin(dashboardPlugin);
        }
      }
    };
  }, [isReady, datasetId, datasetType, group]);

  if (!datasetId) {
    return (
      <Callout intent={Intent.WARNING}>
        Please select a dataset to upload to.
      </Callout>
    );
  }

  return (
    <div className="resumable-uploader p-4">
      <div ref={dashboardRef} style={{ minHeight: "500px" }} />
    </div>
  );
};

export default ResumableUploader;
