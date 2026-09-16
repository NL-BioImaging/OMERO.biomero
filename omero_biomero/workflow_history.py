"""Read-only history and translation into the existing workflow dialog format."""
from contextlib import contextmanager
import logging
import os
from uuid import UUID

from biomero import SlurmClient, WorkflowTracker
from biomero.constants import workflow as wf, results, transfer, workflow_batched, slurm_env
from biomero.database import WorkflowProgressView
from django.http import JsonResponse
from django.views.decorators.http import require_GET
from eventsourcing.application import AggregateNotFoundError
from omeroweb.webclient.decorators import login_required
from sqlalchemy import select, or_, cast, String

logger = logging.getLogger(__name__)


class HistoryConfigurationError(ValueError):
    """An actionable, non-sensitive limitation of a recorded run."""


@contextmanager
def history_tracker():
    # No SSH connection, analytics runner, projection rebuild or table creation.
    configs = SlurmClient.load_config()
    url = os.environ.get(slurm_env.SQLALCHEMY_URL,
                         configs.get('ANALYTICS', 'sqlalchemy_url', fallback=None))
    if not url:
        raise RuntimeError('Workflow tracking is not configured')
    tracker = WorkflowTracker(env={
            'PERSISTENCE_MODULE': 'eventsourcing_sqlalchemy',
            'SQLALCHEMY_URL': url,
            'SQLALCHEMY_SCOPED_SESSION_TOPIC': '',
            'CREATE_TABLE': 'no', 'WORKFLOWTRACKER_CREATE_TABLE': 'no',
    })
    try:
        yield tracker
    finally:
        tracker.close()
        tracker.factory.datastore.engine.dispose()


def run_configuration(run, tasks):
    """Copy only one selected workflow, never unrelated workflow defaults."""
    launcher = next((t.params for t in tasks
                     if t.task_name.endswith(('SLURM_Run_Workflow.py', 'SLURM_Run_Workflow_Batched.py'))
                     and isinstance(t.params, dict) and t.params.get('workflows')), {})
    names = launcher.get('workflows') or list(dict.fromkeys(
        t.task_name for t in tasks
        if not t.task_name.startswith(('_', 'CONVERT_')) and not t.task_name.endswith('.py')))
    if len(names) != 1:
        raise HistoryConfigurationError('History reuse requires a single workflow in the run.')
    name = names[0]
    analysis = next((t for t in tasks if t.task_name == name), None)
    version = launcher.get(f'{name}_Version') or (analysis.task_version if analysis else None)
    if not version:
        raise HistoryConfigurationError('This run did not record a workflow version.')
    source = launcher or next((t.params for t in tasks if isinstance(t.params, dict)
                               and transfer.DATA_TYPE in t.params
                               and transfer.IDS in t.params), {})
    ids, data_type = source.get(transfer.IDS), source.get(transfer.DATA_TYPE)
    if data_type not in ('Image', 'Plate') or not isinstance(ids, (list, tuple)) or not ids:
        raise HistoryConfigurationError('This run has no reusable Image or Plate input selection.')
    prefix = f'{name}_|_'
    scientific = ({k[len(prefix):]: v for k, v in launcher.items() if k.startswith(prefix)}
                  if launcher else dict(analysis.params or {}))
    # These internal descriptor fields must never become editable history settings.
    scientific = {k: v for k, v in scientific.items()
                  if not k.startswith(('cytomine', '_'))}
    form = dict(scientific, IDs=[int(i) for i in ids], Data_Type=data_type,
                workflowMode='plates' if data_type == 'Plate' else 'images', version=version)
    for key in list(form):
        if key.startswith('FILE_'):
            value = form.pop(key)
            form[key[5:]] = value if isinstance(value, list) else [value]
    # Import task parameters provide output options for pre-detached runs.
    output = {}
    for task in tasks:
        if task.task_name.endswith(('SLURM_Import_Results.py', 'SLURM_Get_Results.py')):
            output.update(task.params or {})
    output.update(launcher)
    # Inline import tasks use result-script names rather than launcher names.
    result_names = {
        wf.OUTPUT_ATTACH: results.OUTPUT_ATTACH_OG_IMAGES,
        wf.OUTPUT_CSV_TABLE: results.OUTPUT_ATTACH_TABLE,
        wf.OUTPUT_ATTACH_FILE_OUTPUTS: results.OUTPUT_ATTACH_FILE_OUTPUTS,
        wf.OUTPUT_ATTACH_FILE_OUTPUTS_TARGET: results.OUTPUT_ATTACH_FILE_OUTPUTS_TARGET,
        wf.OUTPUT_CREATE_ROIS: results.OUTPUT_CREATE_ROIS,
        wf.ROI_LABEL_PATTERN: results.ROI_LABEL_PATTERN,
        wf.ROI_SHAPE: results.ROI_SHAPE, wf.ROI_COLOR: results.ROI_COLOR,
    }
    for launcher_key, result_key in result_names.items():
        if launcher_key not in output and result_key in output:
            output[launcher_key] = output[result_key]
    if wf.OUTPUT_PARENT not in output:
        output[wf.OUTPUT_PARENT] = any(output.get(key, False) for key in (
            results.OUTPUT_ATTACH_PROJECT, results.OUTPUT_ATTACH_DATASET, results.OUTPUT_ATTACH_PLATE))
    for launcher_key, enabled_key, name_key in (
        (wf.OUTPUT_NEW_DATASET, results.OUTPUT_ATTACH_NEW_DATASET, results.OUTPUT_ATTACH_NEW_DATASET_NAME),
        (wf.OUTPUT_NEW_SCREEN, results.OUTPUT_ATTACH_NEW_SCREEN, results.OUTPUT_ATTACH_NEW_SCREEN_NAME),
    ):
        if launcher_key not in output and output.get(enabled_key):
            output[launcher_key] = output.get(name_key)
    if wf.USE_ZARR_FORMAT not in output:
        output[wf.USE_ZARR_FORMAT] = source.get(transfer.FORMAT) in ('OME-ZARR', 'ZARR')
    if transfer.OME_VERSION not in output and transfer.OME_VERSION in source:
        output[transfer.OME_VERSION] = source[transfer.OME_VERSION]
    mapping = {
        'receiveEmail': wf.EMAIL, 'useZarrFormat': wf.USE_ZARR_FORMAT,
        'omeZarrVersion': transfer.OME_VERSION, 'importAsZip': wf.OUTPUT_PARENT,
        'attachToOriginalImages': wf.OUTPUT_ATTACH, 'uploadCsv': wf.OUTPUT_CSV_TABLE,
        'attachFileOutputs': wf.OUTPUT_ATTACH_FILE_OUTPUTS,
        'fileOutputTarget': wf.OUTPUT_ATTACH_FILE_OUTPUTS_TARGET,
        'createRois': wf.OUTPUT_CREATE_ROIS, 'roiLabelPattern': wf.ROI_LABEL_PATTERN,
        'roiShape': wf.ROI_SHAPE, 'roiColor': wf.ROI_COLOR,
        'importPlateLabelPreview': results.IMPORT_PLATE_LABEL_PREVIEW,
        'plateLabelPreviewName': results.PLATE_LABEL_PREVIEW_NAME,
    }
    for frontend, recorded in mapping.items():
        if recorded in output:
            form[frontend] = output[recorded]
    for frontend, recorded in [('selectedDatasets', wf.OUTPUT_NEW_DATASET),
                                ('selectedScreens', wf.OUTPUT_NEW_SCREEN)]:
        value = output.get(recorded)
        form[frontend] = [value] if value and value != wf.NO else []
    pattern = output.get(wf.OUTPUT_RENAME)
    form.update(enableRename=bool(pattern and pattern != wf.NO),
                renamePattern=pattern if pattern and pattern != wf.NO else '')
    batch_size = source.get(workflow_batched.BATCH_SIZE)
    form.update(batchEnabled=bool(batch_size), batchSize=batch_size or 1,
                clearExistingRois=False, deleteLabelImagesAfterRois=False)
    return {'workflow_id': str(run.id), 'workflow_name': name, 'form': form,
            'warnings': ['Review output destinations and file attachments before submitting. '
                         'ROI clearing and label deletion are not enabled automatically.']}


def _owned(run, conn):
    context = conn.getEventContext()
    return run.user == context.userId and run.group == context.groupId


def _inputs(conn, config):
    form = config['form']
    objects = list(conn.getObjects(form['Data_Type'], ids=form['IDs']))
    visible = {obj.getId(): obj for obj in objects}
    return [{'id': object_id, 'name': visible[object_id].getName(),
             'data': visible[object_id].getName(),
             'category': 'plates' if form['Data_Type'] == 'Plate' else 'images'}
            for object_id in form['IDs'] if object_id in visible]


@login_required()
@require_GET
def workflow_history_detail(request, workflow_id, conn=None, **kwargs):
    try:
        with history_tracker() as tracker:
            run = tracker.repository.get(UUID(str(workflow_id)))
            if not _owned(run, conn):
                return JsonResponse({'error': 'Run not found.'}, status=404)
            config = run_configuration(run, [tracker.repository.get(i) for i in run.tasks])
            config['inputs'] = _inputs(conn, config)
            config['inputs_available'] = len(config['inputs']) == len(config['form']['IDs'])
            return JsonResponse(config)
    except AggregateNotFoundError:
        return JsonResponse({'error': 'Run not found.'}, status=404)
    except HistoryConfigurationError as exc:
        return JsonResponse({'error': str(exc)}, status=400)
    except Exception:
        logger.exception('Could not read workflow history')
        return JsonResponse({'error': 'Workflow history is unavailable.'}, status=503)


@login_required()
@require_GET
def workflow_history_list(request, conn=None, **kwargs):
    query = request.GET.get('q', '').strip()
    try:
        offset = int(request.GET.get('offset', 0))
        if not 0 <= offset <= 10000 or len(query) > 128:
            raise ValueError
    except ValueError:
        return JsonResponse({'error': 'Invalid history search or page.'}, status=400)
    context = conn.getEventContext()
    table = WorkflowProgressView.__table__
    statement = select(table).where(table.c.user == context.userId,
                                    table.c.group == context.groupId)
    if query:
        statement = statement.where(or_(
            table.c.main_task_name.icontains(query, autoescape=True),
            table.c.name.icontains(query, autoescape=True),
            cast(table.c.workflow_id, String).icontains(query, autoescape=True)))
    statement = statement.order_by(table.c.start_time.desc(), table.c.workflow_id.desc())
    try:
        with history_tracker() as tracker:
            with tracker.factory.datastore.engine.connect() as db:
                rows = list(db.execute(statement.offset(offset).limit(21)).mappings())
            items = [{'workflow_id': str(row['workflow_id']),
                      'workflow_name': row['main_task_name'] or row['name'],
                      'status': row['status'], 'started': row['start_time'],
                      'name': row['name']} for row in rows[:20]]
        return JsonResponse({'runs': items, 'has_more': len(rows) > 20, 'offset': offset})
    except Exception:
        logger.exception('Could not list workflow history')
        return JsonResponse({'error': 'Workflow history is unavailable.'}, status=503)
