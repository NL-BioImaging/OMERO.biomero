import React, { useEffect, useState } from "react";
import { FormGroup, Switch, Slider, Divider, Tooltip, Intent, Callout, Button } from "@blueprintjs/core";
import { useAppContext } from "../../AppContext";

const InputOptions = () => {
  const { state, updateState } = useAppContext();
  const [batchEnabled, setBatchEnabled] = useState(false);
  const [unlockDangerousJobs, setUnlockDangerousJobs] = useState(false);
  
  // Calculate batch size from job count
  const calculateBatchSizeFromJobCount = (totalImages, jobCount) => {
    if (jobCount <= 1) return totalImages;
    return Math.ceil(totalImages / jobCount);
  };

  // Calculate job count from batch size  
  const calculateJobCountFromBatchSize = (totalImages, batchSize) => {
    if (batchSize <= 0) return 1;
    return Math.ceil(totalImages / batchSize);
  };

  // Get smart default job count
  const getDefaultJobCount = (totalImages) => {
    if (totalImages <= 1) return 1;
    if (totalImages <= 10) return Math.min(2, totalImages);
    if (totalImages <= 64) return Math.min(4, Math.ceil(totalImages / 16));
    if (totalImages <= 200) return 5; // Sweet spot for medium datasets
    return 6; // Conservative for large datasets (matches recommendation)
  };

  const totalImages = state.formData?.IDs?.length || 0;
  const [selectedJobCount, setSelectedJobCount] = useState(() => {
    return totalImages > 0 ? getDefaultJobCount(totalImages) : 2;
  });
  
  const batchSize = calculateBatchSizeFromJobCount(totalImages, selectedJobCount);
  const slurmOnline = state.slurmStatus === "online";

  // Update selected job count when IDs change
  useEffect(() => {
    const currentTotalImages = state.formData?.IDs?.length || 0;
    if (currentTotalImages > 0) {
      const optimalJobCount = getDefaultJobCount(currentTotalImages);
      if (optimalJobCount !== selectedJobCount || totalImages !== currentTotalImages) {
        setSelectedJobCount(optimalJobCount);
      }
    }
  }, [state.formData?.IDs?.length]);

  useEffect(() => {
    // Update the global form data with batch settings
    const currentTotalImages = state.formData?.IDs?.length || 0;
    const calculatedBatchCount = batchEnabled && currentTotalImages > 0 ? selectedJobCount : 1;
    const calculatedBatchSize = calculateBatchSizeFromJobCount(currentTotalImages, selectedJobCount);
    
    updateState({ 
      formData: { 
        ...state.formData, 
        batchEnabled: batchEnabled,
        batchCount: calculatedBatchCount,
        batchSize: calculatedBatchSize
      } 
    });
  }, [batchEnabled, selectedJobCount, state.formData?.IDs]);

  const handleInputChange = (id, value) => {
    updateState({
      formData: {
        ...state.formData,
        [id]: value,
      },
    });
  };

  const handleBatchToggle = (enabled) => {
    setBatchEnabled(enabled);
  };

  const handleJobCountChange = (jobCount) => {
    setSelectedJobCount(jobCount);
  };

  // Get recommendation based on image count
  const getProcessingRecommendation = (imageCount) => {
    if (imageCount <= 100) {
      return { 
        text: `Default: Process all ${imageCount} images in a single SLURM job`,
        shouldRecommendBatch: false,
        intent: Intent.NONE 
      };
    } else if (imageCount <= 400) {
      return { 
        text: `Default: Process all ${imageCount} images in a single SLURM job (batching available for better performance)`,
        shouldRecommendBatch: false,
        intent: Intent.NONE 
      };
    } else {
      return { 
        text: `${imageCount} images is a large dataset - consider batch processing to avoid timeouts`,
        shouldRecommendBatch: true,
        intent: Intent.WARNING 
      };
    }
  };

  const recommendation = getProcessingRecommendation(totalImages);

  return (
    <form>
      <p className="text-sm text-gray-600 mb-4">
        These settings are optional. You can safely click "Next" without changing anything to use default processing.
      </p>
      
      {/* Show recommendation callout for large datasets */}
      {recommendation.shouldRecommendBatch && !batchEnabled && (
        <Callout intent={Intent.WARNING} className="mb-4">
          <strong>Large Dataset Detected:</strong> With {totalImages} images, batch processing is recommended 
          to avoid SLURM timeouts and improve reliability. Consider enabling batch processing below.
        </Callout>
      )}
      
      {/* Batch Processing Section */}
      <FormGroup
        label="Batch Processing Options"
        helperText={batchEnabled ? 
          `Split ${totalImages} images across ${selectedJobCount} parallel SLURM jobs` :
          recommendation.text
        }
      >
        <Switch
          checked={batchEnabled}
          onChange={(e) => handleBatchToggle(e.target.checked)}
          label={
            <Tooltip
              content="Batch processing splits your images across multiple smaller jobs instead of one large job. This can improve performance but adds overhead."
              placement="top"
              intent={Intent.PRIMARY}
            >
              <span>Enable batch processing for large datasets</span>
            </Tooltip>
          }
          disabled={!slurmOnline || totalImages < 2}
        />
        
        {batchEnabled && totalImages > 1 && (
          <div className="mt-3">
            <FormGroup>
              <div className="flex items-center justify-between mb-2">
                <span className="font-bold">
                  {selectedJobCount} parallel jobs ({batchSize} images each)
                </span>
                
                {totalImages > 10 && (
                  <Switch
                    checked={unlockDangerousJobs}
                    onChange={(e) => {
                      const unlock = e.target.checked;
                      setUnlockDangerousJobs(unlock);
                      // Reset to safe value when locking
                      if (!unlock && selectedJobCount > 10) {
                        setSelectedJobCount(10);
                      }
                    }}
                    label={
                      <span className={`text-red-600 ${unlockDangerousJobs ? 'font-bold' : 'font-normal'}`}>
                        Allow >10 jobs (dangerous)
                      </span>
                    }
                    intent={Intent.DANGER}
                  />
                )}
              </div>
              
              <div className={unlockDangerousJobs ? 'p-2 bg-red-50 border border-red-400 rounded' : ''}>
                <Slider
                  min={2}
                  max={unlockDangerousJobs ? Math.min(100, totalImages) : Math.min(10, totalImages)}
                  stepSize={1}
                  value={selectedJobCount}
                  onChange={handleJobCountChange}
                  showTrackFill={true}
                  labelStepSize={unlockDangerousJobs ? Math.max(10, Math.floor(totalImages / 8)) : 1}
                  labelRenderer={(value) => {
                    const imagesPerJob = calculateBatchSizeFromJobCount(totalImages, value);
                    return `${value}`;
                  }}
                  intent={unlockDangerousJobs && selectedJobCount > 10 ? Intent.DANGER : Intent.PRIMARY}
                />
              </div>
            </FormGroup>
            
            {(() => {
              const jobCount = selectedJobCount;
              
              // Practical warnings about job failure likelihood
              if (jobCount > 50) {
                return (
                  <Callout intent={Intent.DANGER} style={{ marginTop: '8px' }}>
                    <strong>CRITICAL:</strong> {jobCount} jobs significantly increases likelihood of job failures and data loss. 
                    High server resource usage may affect other users.
                  </Callout>
                );
              }
              
              if (jobCount > 20) {
                return (
                  <Callout intent={Intent.DANGER} className="mt-2">
                    <strong>HIGH RISK:</strong> {jobCount} jobs greatly increases chance of job failures and result data loss.
                  </Callout>
                );
              }
              
              if (jobCount > 10) {
                return (
                  <Callout intent={Intent.WARNING} className="mt-2">
                    <strong>CAUTION:</strong> {jobCount} jobs increases likelihood of job failures compared to fewer, larger jobs.
                  </Callout>
                );
              }
              
              // Performance suggestions
              if (batchSize === 1) {
                return (
                  <Callout intent={Intent.WARNING} className="mt-2">
                    One image per job creates maximum overhead. Consider fewer jobs for better efficiency.
                  </Callout>
                );
              }
              
              if (totalImages > 64 && jobCount >= 4 && jobCount <= 6) {
                return (
                  <Callout intent={Intent.SUCCESS} className="mt-2">
                    Excellent choice! {jobCount} jobs is optimal for {totalImages} images - good balance of speed and reliability.
                  </Callout>
                );
              }
              
              if (totalImages > 64 && jobCount <= 3) {
                return (
                  <Callout intent={Intent.SUCCESS} className="mt-2">
                    Conservative choice! For {totalImages} images, you might try 4-6 jobs for better performance.
                  </Callout>
                );
              }
              
              return null;
            })()}
          </div>
        )}
      </FormGroup>
      
      <Divider />
      
      {/* ZARR Format Option - Moved to bottom as experimental */}
      <FormGroup
        label="Experimental Input Format"
        helperText="⚠️ Advanced users only - can break your workflow if used incorrectly"
      >
        <Switch
          id="useZarrFormat"
          checked={state.formData?.useZarrFormat || false}
          onChange={(e) => handleInputChange('useZarrFormat', e.target.checked)}
          label={
            <Tooltip
              content="Skip TIFF conversion and use ZARR format directly. Only use if your workflow explicitly supports ZARR input and you understand the implications."
              placement="top"
              intent={Intent.DANGER}
            >
              <span>Use ZARR Format (Experimental) ⚠️</span>
            </Tooltip>
          }
        />
        
        {state.formData?.useZarrFormat && (
          <Callout intent={Intent.DANGER} className="mt-2">
            <strong>EXPERIMENTAL FEATURE:</strong> You are bypassing standard TIFF conversion. 
            This may cause workflow failures if your selected workflow doesn't support ZARR input. 
            Only proceed if you know your workflow explicitly supports ZARR format.
          </Callout>
        )}
      </FormGroup>
    </form>
  );
};

export default InputOptions;