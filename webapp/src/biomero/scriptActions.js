export const findScript = (scripts = [], name) => {
  for (const script of scripts || []) {
    if (script.name === name && script.id) return script;
    const found = findScript(script.ul || [], name);
    if (found) return found;
  }
  return null;
};

// Settings shortcuts and sidebar cards must use the same popup and tracking.
export const launchScript = (script, { openScriptWindow, markSlurmInitExecuted, markSlurmCheckExecuted }) => {
  if (script.name === 'Slurm Init (Admin Only)') {
    markSlurmInitExecuted();
  } else if (script.name === 'Slurm Check Setup (Admin Only)') {
    markSlurmCheckExecuted();
  }
  openScriptWindow(`/webclient/script_ui/${script.id}`);
};
