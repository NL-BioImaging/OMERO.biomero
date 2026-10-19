export const validateWorkflowRows = (rows = []) => {
  const errors = {};
  rows.forEach((row, index) => {
    const fields = {};
    if (!/^[a-z0-9][a-z0-9_-]*$/.test(row.name || "") || /_(use_gpu|job_|repo$|job$)/.test(row.name)) {
      fields.name = "Enter a unique lowercase name using letters, numbers, underscores or hyphens; avoid reserved _repo, _job and _use_gpu suffixes.";
    }
    if (rows.some((other, i) => i !== index && other.name === row.name)) {
      fields.name = "Each workflow must have a unique name.";
    }
    try {
      const url = new URL(row.repo);
      const parts = url.pathname.replace(/^\/+|\/+$/g, "").split("/");
      if (/\s/.test(row.repo) || url.protocol !== "https:" || url.host !== "github.com" ||
          url.username || url.password || url.search || url.hash || parts.length < 2 ||
          !parts.slice(0, 2).every(part => /^[A-Za-z0-9_.-]+$/.test(part)) ||
          (parts.length !== 2 && !(parts.length >= 4 && parts[2] === "tree" && parts.slice(3).every(Boolean)))) {
        throw new Error("invalid repository");
      }
    } catch {
      fields.repo = "Enter a GitHub repository URL, optionally followed by /tree/<ref>.";
    }
    if (!row.job?.trim() || /[\r\n\0]/.test(row.job)) {
      fields.job = "Enter a nonempty, single-line job script path.";
    }
    if (Object.keys(fields).length) errors[index] = fields;
  });
  return errors;
};

export const getDeletedConfigOptions = (previousConfig = {}, nextConfig = {}) => {
  const deleted = [];
  Object.entries(previousConfig).forEach(([section, previousSettings]) => {
    if (!previousSettings || typeof previousSettings !== "object" || Array.isArray(previousSettings)) {
      return;
    }
    const nextSettings = nextConfig[section];
    const comparableNext = (
      nextSettings && typeof nextSettings === "object" && !Array.isArray(nextSettings)
    ) ? nextSettings : {};
    Object.keys(previousSettings).forEach((option) => {
      if (!Object.prototype.hasOwnProperty.call(comparableNext, option)) {
        deleted.push({ section, option });
      }
    });
  });
  return deleted;
};
