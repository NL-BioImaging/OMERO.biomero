const ADMIN_GUIDE = 'https://nl-bioimaging.github.io/NL-BIOMERO/latest/sysadmin/omero-biomero-admin.html';

// Keep anchors aligned with the NL-BIOMERO administrator manual.
export const ADMIN_HELP = {
  manual: { href: `${ADMIN_GUIDE}#analyzer-admin-configuration`, label: 'Administrator manual' },
  ssh: { href: `${ADMIN_GUIDE}#ssh-settings`, label: 'SSH settings documentation' },
  slurm: { href: `${ADMIN_GUIDE}#slurm-settings`, label: 'Slurm settings documentation' },
  paths: { href: `${ADMIN_GUIDE}#paths`, label: 'Slurm paths documentation' },
  history: { href: `${ADMIN_GUIDE}#sacct-history-window`, label: 'SACCT history documentation' },
  repositories: { href: `${ADMIN_GUIDE}#repositories`, label: 'Workflow repositories documentation' },
  processing: { href: `${ADMIN_GUIDE}#processing-settings`, label: 'Processing settings documentation' },
  gpu: { href: `${ADMIN_GUIDE}#partition-and-gpu-fallback`, label: 'GPU settings documentation' },
  imagePull: { href: `${ADMIN_GUIDE}#image-pull-settings`, label: 'Image acquisition documentation' },
  zip: { href: `${ADMIN_GUIDE}#zip-command`, label: 'ZIP command documentation' },
  sbatch: { href: `${ADMIN_GUIDE}#global-sbatch-parameters`, label: 'Slurm job parameters documentation' },
  sbatchOptions: { href: 'https://slurm.schedmd.com/sbatch.html#SECTION_OPTIONS', label: 'Slurm SBATCH options reference' },
  shallow: { href: `${ADMIN_GUIDE}#shallow-zarr`, label: 'Shallow Zarr documentation' },
  ui: { href: `${ADMIN_GUIDE}#ui-settings`, label: 'UI settings documentation' },
  platePreview: { href: `${ADMIN_GUIDE}#plate-mask-preview`, label: 'Plate mask preview documentation' },
  analytics: { href: `${ADMIN_GUIDE}#analytics-settings`, label: 'Analytics settings documentation' },
  converters: { href: `${ADMIN_GUIDE}#converters-settings`, label: 'Converters documentation' },
  workflows: { href: `${ADMIN_GUIDE}#workflows-settings`, label: 'Workflow settings documentation' },
  zarr: { href: `${ADMIN_GUIDE}#zarr-and-plate-workflow-types`, label: 'Zarr and plate input documentation' },
};
