import axios from "axios";
import { getDjangoConstants } from "./constants";

// General API request function
export const apiRequest = async (
  endpoint,
  method = "GET",
  data = null,
  options = {}
) => {
  try {
    // Include CSRF token for methods that modify data
    const csrfToken = window.csrftoken;
    const headers = options.headers || {};
    if (
      ["POST", "PUT", "PATCH", "DELETE"].includes(method.toUpperCase()) &&
      csrfToken
    ) {
      headers["X-CSRFToken"] = csrfToken;
    }

    const response = await axios({
      url: `${window.location.origin}${endpoint}`,
      method,
      data,
      headers,
      ...options,
    });
    return response.data;
  } catch (error) {
    console.error("API Request Error in apiService:", error);
    throw error;
  }
};

// Specific API calls
export const fetchWorkflowHistory = (query = "", offset = 0, signal) =>
  apiRequest(getDjangoConstants().urls.workflow_history, "GET", null,
    { params: { q: query, offset }, signal });

export const fetchWorkflowHistoryDetail = (id, signal) =>
  apiRequest(`${getDjangoConstants().urls.workflow_history}${encodeURIComponent(id)}/`,
    "GET", null, { signal });

export const fetchomeroFileTreeData = async () => {
  const { user, urls } = getDjangoConstants();
  const params = {
    id: user.active_user.id,
    experimenter_id: user.active_user.id,
    page: 0,
    group: user.active_group_id,
    _: new Date().getTime(),
  };
  return apiRequest(urls.tree_top_level, "GET", null, { params });
};

export const fetchProjectData = async (item) => {
  const projectId = item.id;
  const { urls, user } = getDjangoConstants();
  const params = {
    id: projectId,
    page: 0,
    group: user.active_group_id,
    _: new Date().getTime(),
  };
  return apiRequest(urls.api_datasets, "GET", null, { params });
};

export const fetchFolderData = (itemId = null, isFolder = true) => {
  const { urls, user } = getDjangoConstants();
  const params = {
    item_id: itemId,
    page: 0,
    group: user.active_group_id,
    is_folder: isFolder,
    _: new Date().getTime(),
  };
  return apiRequest(urls.api_get_folder_contents, "GET", null, { params });
};

export const fetchGroups = async () => {
  const { urls } = getDjangoConstants();
  return apiRequest(urls.api_get_groups, "GET");
};

// Fetch scripts from the server
export const fetchScripts = async () => {
  const { urls } = getDjangoConstants(); // Get the URLs from Django constants
  try {
    const response = await apiRequest(urls.scripts, "GET");
    return response;
  } catch (error) {
    console.error("Error fetching scripts:", error);
    throw error; // Rethrow the error to be handled by the caller
  }
};

// Fetch script menu data
export const fetchScriptData = async (scriptId, directory) => {
  const { urls } = getDjangoConstants();
  const params = {
    script_ids: scriptId,
    directory: directory, // Include the directory as a query parameter
  };

  return apiRequest(urls.get_workflows, "GET", null, { params });
};

// Fetch available workflows
export const fetchWorkflows = async () => {
  const { urls } = getDjangoConstants();
  return apiRequest(urls.workflows, "GET");
};

export const fetchConfig = async () => {
  const { urls } = getDjangoConstants();
  return apiRequest(urls.api_config, "GET", null, { params: { _: new Date().getTime() } });
};

export const fetchSlurmStatus = async () => {
  const { urls } = getDjangoConstants();
  return apiRequest(urls.api_slurm_status, "GET");
};

/**
 * Fetch OMERO file annotations (attachments) accessible to the current user.
 * @param {string[]} formats - Optional list of file extensions to filter by (e.g. ["csv", "parquet"])
 * @param {string}   search  - Optional substring to filter by filename
 * @param {number}   groupId - Optional OMERO group ID to scope the query
 * @returns {Promise<{attachments: Array}>}
 */

// Module-level cache so multiple OmeroAttachmentBrowser instances that render
// at the same time (one per file-type param) share a single HTTP request.
// Keyed by group ID, expires after 60 s.
const _attachmentsCache = {}; // { [groupKey]: { ts, promise } }
const ATTACHMENTS_TTL_MS = 60_000;

export const fetchAttachments = (groupId = null) => {
  const { urls, user } = getDjangoConstants();
  const resolvedGroup = groupId !== null ? groupId : user.active_group_id;
  const key = String(resolvedGroup);
  const now = Date.now();
  const cached = _attachmentsCache[key];
  if (cached && now - cached.ts < ATTACHMENTS_TTL_MS) {
    return cached.promise;
  }
  const promise = apiRequest(
    `${urls.api_attachments}?group=${resolvedGroup}&_=${now}`,
    "GET"
  );
  _attachmentsCache[key] = { ts: now, promise };
  return promise;
};

/** Invalidate the attachment cache (call when user manually refreshes). */
export const invalidateAttachmentsCache = (groupId = null) => {
  if (groupId !== null) {
    delete _attachmentsCache[String(groupId)];
  } else {
    Object.keys(_attachmentsCache).forEach((k) => delete _attachmentsCache[k]);
  }
};

/**
 * Fetch file annotations attached to a single OMERO object.
 * Used by the By-Parent tree browser to lazily load attachments per node.
 *
 * @param {string} objectType - "Project" | "Dataset" | "Image" | "Plate" | "Screen"
 * @param {number} objectId
 * @returns {Promise<{annotations: Array}>}
 */
export const fetchObjectAnnotations = async (objectType, objectId) => {
  const { urls } = getDjangoConstants();
  return apiRequest(
    `${urls.api_object_annotations}?object_type=${encodeURIComponent(objectType)}&object_id=${objectId}`,
    "GET"
  );
};

// Fetch metadata for a specific workflow, or descriptor info for an unsaved repo URL.
// - fetchWorkflowMetadata(workflowName)  → GET /api/analyzer/workflows/<name>/
// - fetchWorkflowMetadata(null, repoUrl) → GET /api/analyzer/workflows/_/?repo=<url>  (urls.workflow_metadata)
//   Returns the full biomero-schema descriptor dict including 'requires-zarr',
//   'requires-plate', and 'name' (tool name from descriptor).
export const fetchWorkflowMetadata = async (workflow, repoUrl = null) => {
  const { urls } = getDjangoConstants();
  if (repoUrl) {
    return apiRequest(
      `${urls.workflow_metadata}?repo=${encodeURIComponent(repoUrl)}`, "GET"
    );
  }
  return apiRequest(`${urls.workflows}${workflow}/`, "GET");
};

// GitHub URL is included in fetchWorkflowMetadata().githubUrl

// Fetch thumbnails for imageids
export const fetchThumbnails = async (imageIds) => {
  const { urls } = getDjangoConstants(); // Get the URLs from Django constants
  const validImageIds = imageIds.filter((id) => id != null); // Removes undefined and null

  if (!validImageIds || validImageIds.length === 0) {
    console.warn("No (valid) image IDs provided, skipping thumbnail fetch.");
    return []; // Skip the API call if the array is empty
  }

  try {
    const queryString = validImageIds.map((id) => `id=${id}`).join("&");
    const endpoint = `${urls.api_thumbnails}?${queryString}`;
    const response = await apiRequest(endpoint, "GET");
    return response || [];
  } catch (error) {
    console.error("Error fetching thumbnails:", error);
    throw error; // Rethrow the error to be handled by the caller
  }
};

// Fetch images for a dataset
export const fetchImages = async (
  datasetId,
  page = 1,
  sizeXYZ = false,
  date = false,
  group = -1
) => {
  const { urls } = getDjangoConstants(); // Get the URLs from Django constants

  if (!datasetId) {
    datasetId = 51; //6;
    console.warn("No dataset ID provided, fetching example:", datasetId);
    // return []; // Skip the API call if the dataset ID is not provided
  }

  try {
    // Construct the query string
    const queryString = new URLSearchParams({
      id: datasetId,
      page: page,
      sizeXYZ: sizeXYZ.toString(),
      date: date.toString(),
      group: group.toString(),
    }).toString();

    // Construct the endpoint URL
    const endpoint = `${urls.api_images}?${queryString}`;

    // Make the API call
    const response = await apiRequest(endpoint, "GET");

    return response.images || []; // Return the response or an empty array if no response
  } catch (error) {
    console.error("Error fetching images:", error);
    throw error; // Rethrow the error to be handled by the caller
  }
};

export const runWorkflow = async (workflowName, params = {}) => {
  const { urls } = getDjangoConstants(); // Base URL for the API from Django constants

  try {
    // Use the global csrftoken directly from window object
    const csrfToken = window.csrftoken;

    // Prepare the payload with script_name and optional params
    const payload = { workflow_name: workflowName, params };
    const endpoint = `${urls.api_run_workflow}${workflowName}/jobs/`;
    const response = await apiRequest(endpoint, "POST", payload, {
      headers: {
        "X-CSRFToken": csrfToken, // Include CSRF token in request headers
      },
    });

    return response; // Return the API response
  } catch (error) {
    console.error("Error running workflow:", error);
    throw error;
  }
};

export const postConfig = async (config, deleted = []) => {
  const { urls } = getDjangoConstants(); // Base URL for the API from Django constants

  try {
    // Use the global csrftoken directly from window object
    const csrfToken = window.csrftoken;

    // Prepare the payload with script_name and optional params
    const payload = { config, deleted };

    const response = await apiRequest(urls.api_config, "POST", payload, {
      headers: {
        "X-CSRFToken": csrfToken, // Include CSRF token in request headers
      },
    });

    return response; // Return the API response
  } catch (error) {
    console.error("Error saving config:", error);
    throw error;
  }
};

export const postUpload = async (upload) => {
  const { urls } = getDjangoConstants(); // Base URL for the API from Django constants

  try {
    // Use the global csrftoken directly from window object
    const csrfToken = window.csrftoken;

    // Prepare the payload with script_name and optional params
    const payload = { upload };

    const response = await apiRequest(
      urls.api_import_selected,
      "POST",
      payload,
      {
        headers: {
          "X-CSRFToken": csrfToken, // Include CSRF token in request headers
        },
      }
    );

    return response; // Return the API response
  } catch (error) {
    console.error("Error saving config:", error);
    throw error;
  }
};

export const createContainer = async (
  type,
  name,
  description,
  targetContainerId,
  targetContainerType
) => {
  const { urls } = getDjangoConstants(); // Base URL for the API from Django constants

  try {
    // Use the global csrftoken directly from window object
    const csrfToken = window.csrftoken;

    // Prepare the form data payload
    const formData = new FormData();
    formData.append("name", name);
    formData.append("description", description);
    formData.append("folder_type", type);
    formData.append("owner", "");

    const url = targetContainerId
      ? `${urls.api_addnewcontainer}${targetContainerType}/${targetContainerId}/`
      : urls.api_addnewcontainer;

    const response = await apiRequest(url, "POST", formData, {
      headers: {
        "X-CSRFToken": csrfToken,
        // Let browser set Content-Type for FormData
      },
    });

    return response; // Return the API response
  } catch (error) {
    console.error("Error creating container:", error);
    throw error;
  }
};

export const fetchGroupMappings = async () => {
  const { urls } = getDjangoConstants();
  return apiRequest(urls.api_group_mappings, "GET");
};

export const postGroupMappings = async (mappings) => {
  const { urls } = getDjangoConstants();
  try {
    const csrfToken = window.csrftoken;
    const response = await apiRequest(
      urls.api_group_mappings,
      "POST",
      { mappings },
      {
        headers: {
          "X-CSRFToken": csrfToken,
        },
      }
    );
    return response;
  } catch (error) {
    console.error("Error saving group mappings:", error);
    throw error;
  }
};

export const fetchPlatesData = async (item) => {
  const screenId = item.id;
  const { urls, user } = getDjangoConstants();
  const params = {
    id: screenId,
    page: 0,
    group: user.active_group_id,
    _: new Date().getTime(),
  };
  return apiRequest(urls.api_plates, "GET", null, { params });
};

export const fetchPlateImages = async (plateId) => {
  const { urls } = getDjangoConstants();

  let allImages = [];
  let keepFetching = true;
  let offset = 0;
  const limit = 200; // Default API limit

  while (keepFetching) {
    // Get paginated wells
    const response = await apiRequest(
      `${urls.api_wells}?plate=${plateId}&offset=${offset}&limit=${limit}`,
      "GET"
    );

    // Extract images from wells
    const images = response.data
      .flatMap((well) => well.WellSamples || [])
      .map((sample) => ({
        id: sample.Image["@id"],
        name: sample.Image.Name,
        index: `image-${sample.Image["@id"]}`,
        source: "omero",
      }))
      .filter((img) => img.id != null);

    allImages.push(...images);

    // Check if we need to fetch more
    if (offset + limit >= response.meta.totalCount) {
      keepFetching = false;
    } else {
      offset += limit;
    }
  }

  return allImages;
};

export const importUploadedFile = async (
  filename,
  datasetId,
  datasetType,
  group,
  groupId
) => {
  const { urls } = getDjangoConstants();
  console.log("importUploadedFile calling:", urls.api_import_uploaded_file, {
    filename,
    datasetId,
    datasetType,
    group,
    groupId,
  });
  return apiRequest(urls.api_import_uploaded_file, "POST", {
    filename,
    datasetId,
    datasetType,
    group,
    groupId,
  });
};

export const fetchPlateGridData = async (plateId, signal) => {
  try {
    // Use the same endpoint as OMERO webclient for plate grid data
    const response = await fetch(
      `${window.location.origin}/webgateway/plate/${plateId}/0/`, { signal }
    );
    const text = await response.text();
    
    // Parse both JSONP and plain JSON responses
    let plateData;
    if (text.includes('jQuery') && text.includes('({') && text.includes('})')) {
      // JSONP format: jQuery123({...})
      const jsonStart = text.indexOf('({') + 1;
      const jsonEnd = text.lastIndexOf('})');
      plateData = JSON.parse(text.substring(jsonStart, jsonEnd));
    } else {
      // Plain JSON format
      plateData = JSON.parse(text);
    }
    
    return plateData;
  } catch (error) {
    console.error("Error fetching plate grid data:", error);
    throw error;
  }
};

// GitHub API functions for version checking
/**
 * Extracts GitHub repository information from a URL
 * @param {string} repoUrl - GitHub repository URL
 * @returns {Object|null} Repository info with owner, repo, and current version
 */
export const extractGitHubInfo = (repoUrl) => {
  if (!repoUrl || typeof repoUrl !== 'string') {
    return null;
  }
  
  // Match GitHub URLs like https://github.com/owner/repo/tree/v1.0.0
  // Use [^\/]+ for the version segment so that an optional file path after the
  // branch (e.g. /tree/v0.0.3/descriptor.json) is NOT captured as part of the
  // version — only the branch/tag itself is extracted as currentVersion.
  const match = repoUrl.match(/github\.com\/([^\/]+)\/([^\/]+)(?:\/tree\/([^\/]+))?/);
  if (!match || !match[1] || !match[2]) {
    return null;
  }
  
  return {
    owner: match[1],
    repo: match[2],
    currentVersion: match[3] || null
  };
};

export const slugify = (name) => name.toLowerCase().replace(/[\s-]+/g, '_').replace(/[^a-z0-9_]/g, '');

// In-memory cache for workflow metadata (session-scoped, keyed by repo URL).
const _metadataCache = new Map();

export const fetchWorkflowMetadataCached = async (repoUrl) => {
  if (_metadataCache.has(repoUrl)) return _metadataCache.get(repoUrl);
  const result = await fetchWorkflowMetadata(null, repoUrl);
  _metadataCache.set(repoUrl, result);
  return result;
};

/**
 * Fetches the container image reference via the backend (cached).
 * Returns the full image string e.g. "cellularimagingcf/w_cellpose:v1.0.0", or null.
 */
export const fetchContainerImage = async (repoUrl) => {
  if (!repoUrl) return null;
  try {
    const metadata = await fetchWorkflowMetadataCached(repoUrl);
    return metadata?.['container-image']?.image ?? null;
  } catch {
    return null;
  }
};

// GitHub API persistent caching utilities
const DEFAULT_CACHE_TTL = 5 * 60 * 1000; // 5 minutes in milliseconds
const GITHUB_CACHE_PREFIX = 'github_';

/**
 * Generates a cache key for GitHub repositories
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @returns {string} Cache key
 */
const getGitHubCacheKey = (owner, repo) => `${GITHUB_CACHE_PREFIX}${owner}_${repo}`;

/**
 * Safe localStorage operations utility
 */
const localStorageUtils = {
  getItem: (key) => {
    try {
      return localStorage.getItem(key);
    } catch (error) {
      console.warn('Error reading from localStorage:', error);
      return null;
    }
  },
  
  setItem: (key, value) => {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch (error) {
      console.warn('Error writing to localStorage:', error);
      return false;
    }
  },
  
  removeItem: (key) => {
    try {
      localStorage.removeItem(key);
      return true;
    } catch (error) {
      console.warn('Error removing from localStorage:', error);
      return false;
    }
  },
  
  /**
   * Clears items with specific prefix from localStorage
   * @param {string} prefix - Prefix to match for removal
   */
  clearByPrefix: (prefix) => {
    try {
      const keysToRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(prefix)) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach(key => localStorage.removeItem(key));
      return keysToRemove.length;
    } catch (error) {
      console.warn('Error clearing localStorage by prefix:', error);
      return 0;
    }
  }
};

/**
 * Retrieves data from persistent cache with TTL validation
 * @param {string} cacheKey - The cache key
 * @param {number} ttl - Time to live in milliseconds (optional, uses default)
 * @returns {Object|null} Cached data or null if expired/not found
 */
export const getFromPersistentCache = async (cacheKey, ttl = DEFAULT_CACHE_TTL) => {
  const cached = localStorageUtils.getItem(cacheKey);
  
  if (!cached) {
    return null;
  }
  
  try {
    const parsed = JSON.parse(cached);
    const now = Date.now();
    
    // Check if cache is still valid
    if (parsed.timestamp && (now - parsed.timestamp < ttl)) {
      return parsed;
    }
    
    // Remove expired cache
    localStorageUtils.removeItem(cacheKey);
    return null;
  } catch (error) {
    console.warn('Error parsing cached data:', error);
    localStorageUtils.removeItem(cacheKey); // Remove corrupted cache
    return null;
  }
};

/**
 * Saves data to persistent cache with automatic cleanup
 * @param {string} cacheKey - The cache key
 * @param {any} data - Data to cache
 * @param {string} cleanupPrefix - Prefix for cleanup on storage full (optional)
 * @returns {boolean} Success status
 */
export const saveToPersistentCache = async (cacheKey, data, cleanupPrefix = null) => {
  const cacheData = JSON.stringify({
    ...data,
    timestamp: Date.now()
  });
  
  // Try to save
  if (localStorageUtils.setItem(cacheKey, cacheData)) {
    return true;
  }
  
  // If failed and cleanup prefix is provided, try cleanup and retry
  if (cleanupPrefix) {
    const clearedCount = localStorageUtils.clearByPrefix(cleanupPrefix);
    if (clearedCount > 0) {
      console.log(`Cleared ${clearedCount} cache entries with prefix ${cleanupPrefix}`);
      return localStorageUtils.setItem(cacheKey, cacheData);
    }
  }
  
  return false;
};

/**
 * Clears all GitHub-related cache entries
 * @returns {number} Number of entries cleared
 */
export const clearGitHubCache = async () => {
  const clearedCount = localStorageUtils.clearByPrefix(GITHUB_CACHE_PREFIX);
  return clearedCount;
};

/**
 * Helper function to handle GitHub API errors with proper fallback strategies
 * @param {Error} error - The error object from axios
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {string} cacheKey - Cache key for storing/retrieving data
 * @returns {Promise<Object|null>} Error response or fallback data
 */
const handleGitHubAPIError = async (error, owner, repo, cacheKey) => {
  // Handle GitHub API rate limiting
  if (error.response?.status === 403 && error.response?.data?.message?.includes('rate limit exceeded')) {
    const rateLimitInfo = {
      limit: error.response.headers['x-ratelimit-limit'],
      remaining: error.response.headers['x-ratelimit-remaining'],
      reset: error.response.headers['x-ratelimit-reset']
    };
    
    // Try to return stale cached data if available
    const staleCache = await getFromPersistentCache(cacheKey);
    if (staleCache && staleCache.data) {
      return {
        ...staleCache.data,
        _isStale: true,
        _rateLimitInfo: rateLimitInfo
      };
    }
    
    return {
      _rateLimited: true,
      _rateLimitInfo: rateLimitInfo
    };
  }
  
  // If there's no latest release, try to get the latest tag instead
  if (error.response?.status === 404) {
    try {
      const tagsResponse = await axios.get(`https://api.github.com/repos/${owner}/${repo}/tags`);
      if (tagsResponse.data && tagsResponse.data.length > 0) {
        const latestTag = tagsResponse.data[0];
        const tagData = {
          tag_name: latestTag.name,
          name: latestTag.name,
          html_url: `https://github.com/${owner}/${repo}/tree/${latestTag.name}`
        };
        
        await saveToPersistentCache(cacheKey, {
          data: tagData
        }, GITHUB_CACHE_PREFIX);
        
        return tagData;
      }
    } catch (tagError) {
      // Ignore tag fetch errors
    }
  }
  
  // For other errors, try to return stale cache if available
  const staleCache = await getFromPersistentCache(cacheKey);
  if (staleCache && staleCache.data) {
    return {
      ...staleCache.data,
      _isStale: true,
      _error: error.message
    };
  }
  
  return null;
};

/**
 * Fetches the latest release information from GitHub API with caching
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name 
 * @param {boolean} forceRefresh - Whether to bypass cache
 * @returns {Promise<Object|null>} Release data or null if not found
 */
export const fetchLatestGitHubRelease = async (owner, repo, forceRefresh = false) => {
  if (!owner || !repo) {
    return null;
  }
  
  const cacheKey = getGitHubCacheKey(owner, repo);
  
  // Check persistent cache first (unless force refresh)
  if (!forceRefresh) {
    const cached = await getFromPersistentCache(cacheKey);
    if (cached && cached.data) {
      return cached.data;
    }
  }
  
  try {
    const response = await axios.get(`https://api.github.com/repos/${owner}/${repo}/releases/latest`);
    
    const releaseData = {
      tag_name: response.data.tag_name,
      name: response.data.name,
      published_at: response.data.published_at,
      html_url: response.data.html_url
    };
    
    // Cache the successful result persistently
    await saveToPersistentCache(cacheKey, {
      data: releaseData,
      rateLimitInfo: {
        limit: response.headers['x-ratelimit-limit'],
        remaining: response.headers['x-ratelimit-remaining'],
        reset: response.headers['x-ratelimit-reset']
      }
    }, GITHUB_CACHE_PREFIX);
    
    return releaseData;
  } catch (error) {
    return handleGitHubAPIError(error, owner, repo, cacheKey);
  }
};

/**
 * Compares two version strings following semantic versioning
 * @param {string} current - Current version string
 * @param {string} latest - Latest version string
 * @returns {string} Comparison result: 'up-to-date', 'outdated', 'ahead', or 'unknown'
 */ 
export const compareVersions = (current, latest) => {
  if (!current || !latest || typeof current !== 'string' || typeof latest !== 'string') {
    return 'unknown';
  }
  
  // Remove 'v' prefix if present and normalize
  const cleanCurrent = current.replace(/^v/, '').trim();
  const cleanLatest = latest.replace(/^v/, '').trim();
  
  // Simple comparison - if they're exactly the same, it's up to date
  if (cleanCurrent === cleanLatest) {
    return 'up-to-date';
  }
  
  // Try semantic version comparison
  try {
    const currentParts = cleanCurrent.split('.').map(part => {
      const num = parseInt(part, 10);
      return isNaN(num) ? 0 : num;
    });
    const latestParts = cleanLatest.split('.').map(part => {
      const num = parseInt(part, 10);
      return isNaN(num) ? 0 : num;
    });
    
    const maxLength = Math.max(currentParts.length, latestParts.length);
    
    for (let i = 0; i < maxLength; i++) {
      const currentPart = currentParts[i] || 0;
      const latestPart = latestParts[i] || 0;
      
      if (currentPart < latestPart) {
        return 'outdated';
      }
      if (currentPart > latestPart) {
        return 'ahead';
      }
    }
    
    return 'up-to-date';
  } catch (error) {
    console.warn('Error comparing versions:', error);
    // If semantic version comparison fails, fall back to string comparison
    return cleanCurrent === cleanLatest ? 'up-to-date' : 'unknown';
  }
};

/**
 * Checks version status for multiple models against their GitHub repositories
 * @param {Array} models - Array of model objects with repo URLs
 * @param {boolean} forceRefresh - Whether to bypass cache for all checks
 * @returns {Promise<Array>} Array of version check results
 */
export const checkModelVersions = async (models, forceRefresh = false) => {
  if (!Array.isArray(models) || models.length === 0) {
    return [];
  }
  
  const versionChecks = await Promise.all(
    models.map(async (model, index) => {
      if (!model || !model.repo) {
        return { index, status: 'error', error: 'Invalid model structure' };
      }
      
      const githubInfo = extractGitHubInfo(model.repo);
      if (!githubInfo) {
        return { index, status: 'unknown', error: 'Invalid GitHub URL' };
      }
      
      try {
        const latestRelease = await fetchLatestGitHubRelease(githubInfo.owner, githubInfo.repo, forceRefresh);
        if (!latestRelease) {
          return { index, status: 'unknown', error: 'No releases found' };
        }
        
        // Check for stale data first - if we have cached data, show it as stale
        if (latestRelease._isStale) {
          const status = compareVersions(githubInfo.currentVersion, latestRelease.tag_name);
          return {
            index,
            status: `${status}-stale`,
            currentVersion: githubInfo.currentVersion,
            latestVersion: latestRelease.tag_name,
            latestReleaseUrl: latestRelease.html_url,
            isStale: true,
            rateLimitInfo: latestRelease._rateLimitInfo,
            error: latestRelease._error
          };
        }
        
        // Only show rate-limited if we have NO cached data at all
        if (latestRelease._rateLimited) {
          return {
            index,
            status: 'rate-limited',
            rateLimitInfo: latestRelease._rateLimitInfo,
            error: 'GitHub API rate limit exceeded'
          };
        }
        
        const status = compareVersions(githubInfo.currentVersion, latestRelease.tag_name);
        return {
          index,
          status,
          currentVersion: githubInfo.currentVersion,
          latestVersion: latestRelease.tag_name,
          latestReleaseUrl: latestRelease.html_url
        };
      } catch (error) {
        return { index, status: 'error', error: error.message };
      }
    })
  );
  
  return versionChecks;
};
