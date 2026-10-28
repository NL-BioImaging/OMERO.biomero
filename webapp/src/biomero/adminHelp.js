const ADMIN_GUIDE = 'https://nl-bioimaging.github.io/NL-BIOMERO/latest/sysadmin/omero-biomero-admin.html';
const SLURM_GUIDE = 'https://nl-bioimaging.github.io/biomero/slurm-configuration.html';

// Keep anchors aligned with the corresponding NL-BIOMERO/core documentation.
export const ADMIN_HELP = {
  manual: { href: `${ADMIN_GUIDE}#analyzer-admin-configuration`, label: 'Administrator manual' },
  ssh: { href: `${ADMIN_GUIDE}#ssh-settings`, label: 'SSH settings documentation' },
  slurm: { href: SLURM_GUIDE, label: 'Slurm settings documentation' },
  paths: { href: `${SLURM_GUIDE}#core-path-settings`, label: 'Slurm paths documentation' },
  history: { href: `${SLURM_GUIDE}#sacct-history-window`, label: 'SACCT history documentation' },
  repositories: { href: `${SLURM_GUIDE}#workflow-and-model-configuration`, label: 'Workflow repositories documentation' },
  processing: { href: `${SLURM_GUIDE}#processing-settings`, label: 'Processing settings documentation' },
  gpu: { href: `${SLURM_GUIDE}#default-gpu-fallback-settings`, label: 'GPU settings documentation' },
  imagePull: { href: `${SLURM_GUIDE}#image-pull-execution-mode`, label: 'Image acquisition documentation' },
  zip: { href: `${SLURM_GUIDE}#zip-command`, label: 'ZIP command documentation' },
  sbatch: { href: `${SLURM_GUIDE}#global-sbatch-parameters`, label: 'Slurm job parameters documentation' },
  sbatchOptions: { href: 'https://slurm.schedmd.com/sbatch.html#SECTION_OPTIONS', label: 'Slurm SBATCH options reference' },
  shallow: { href: 'https://nl-bioimaging.github.io/NL-BIOMERO/latest/sysadmin/remote-shallower.html', label: 'Shallow Zarr documentation' },
  ui: { href: `${ADMIN_GUIDE}#ui-settings`, label: 'UI settings documentation' },
  platePreview: { href: `${ADMIN_GUIDE}#plate-mask-preview`, label: 'Plate mask preview documentation' },
  analytics: { href: `${SLURM_GUIDE}#analytics-and-provenance-settings`, label: 'Analytics settings documentation' },
  converters: { href: `${ADMIN_GUIDE}#converters-settings`, label: 'Converters documentation' },
  workflows: { href: `${ADMIN_GUIDE}#workflows-settings`, label: 'Workflow settings documentation' },
  zarr: { href: `${ADMIN_GUIDE}#zarr-and-plate-workflow-types`, label: 'Zarr and plate input documentation' },
};
