// list_scripts returns filenames; script details replace them with display names.
const ADMIN_SCRIPT_FILES = {
  'Slurm Init (Admin Only)': 'SLURM_Init_environment.py',
  'Slurm Check Setup (Admin Only)': 'SLURM_check_setup.py',
};

const matchesName = (script, name) => script.name === name || script.name === ADMIN_SCRIPT_FILES[name];

export const findScript = (scripts = [], name) => {
  for (const script of scripts || []) {
    if (matchesName(script, name) && script.id) return script;
    const found = findScript(script.ul || [], name);
    if (found) return found;
  }
  return null;
};

// Settings shortcuts and sidebar cards must use the same popup and tracking.
export const launchScript = (script, { openScriptWindow, markSlurmInitExecuted, markSlurmCheckExecuted }) => {
  if (matchesName(script, 'Slurm Init (Admin Only)')) {
    markSlurmInitExecuted();
  } else if (matchesName(script, 'Slurm Check Setup (Admin Only)')) {
    markSlurmCheckExecuted();
  }
  openScriptWindow(`/webclient/script_ui/${script.id}`);
};
