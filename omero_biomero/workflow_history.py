"""Read-only history and translation into the existing workflow dialog format."""
from contextlib import contextmanager
import logging
import os
import re
from uuid import UUID

from biomero import SlurmClient, WorkflowTracker
from biomero.constants import workflow as wf, results, transfer, workflow_batched, slurm_env
from biomero.database import WorkflowProgressView
from django.http import JsonResponse
from django.urls import reverse, NoReverseMatch
from django.views.decorators.http import require_GET
from eventsourcing.application import AggregateNotFoundError
from omeroweb.webclient.decorators import login_required
from sqlalchemy import select, or_, cast, String, func

logger = logging.getLogger(__name__)


class HistoryConfigurationError(ValueError):
    """An actionable, non-sensitive limitation of a recorded run."""


@contextmanager
def history_tracker():
    # No SSH connection, analytics runner, projection rebuild or table creation.
    configs = SlurmClient.load_config()
    # NL-BIOMERO web already receives the shared tracking database under the
    # importer setting. Prefer an explicitly configured workflow database.
    url = (os.environ.get(slurm_env.SQLALCHEMY_URL)
           or configs.get('ANALYTICS', 'sqlalchemy_url', fallback=None)
           or os.environ.get('INGEST_TRACKING_DB_URL'))
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
    for field, key in [('selectedDatasetId', results.OUTPUT_ATTACH_NEW_DATASET_ID),
                       ('selectedScreenId', results.OUTPUT_ATTACH_NEW_SCREEN_ID)]:
        form[field] = output.get(key) or None
    pattern = output.get(wf.OUTPUT_RENAME)
    form.update(enableRename=bool(pattern and pattern != wf.NO),
                renamePattern=pattern if pattern and pattern != wf.NO else '')
    batch_size = source.get(workflow_batched.BATCH_SIZE)
    source_options = dict(form)
    source_options['clearExistingRois'] = bool(output.get(wf.ROI_CLEAR_EXISTING, output.get(results.ROI_CLEAR_EXISTING, False)))
    source_options['deleteLabelImagesAfterRois'] = bool(output.get(wf.ROI_DELETE_LABEL_IMAGES, output.get(results.ROI_DELETE_LABEL_IMAGES, False)))
    form.update(batchEnabled=bool(batch_size), batchSize=batch_size or 1,
                clearExistingRois=False, deleteLabelImagesAfterRois=False)
    return {'workflow_id': str(run.id), 'workflow_name': name, 'form': form,
            'source_options': source_options, 'warnings': []}


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


def _outputs(conn, config, after=None, limit=5):
    """Bounded, permission-filtered provenance links, not inferred destinations."""
    from omero.sys import ParametersI
    outputs = []
    kinds = ('Plate', 'Dataset', 'Image')
    for kind in kinds:
        if after and kinds.index(kind) < kinds.index(after[0]):
            continue
        params = ParametersI()
        params.addString('uuid', config['workflow_id'])
        params.page(0, limit + 1 - len(outputs))
        exclude = ''
        if after and kind == after[0]:
            params.addLong('after', after[1])
            exclude += 'AND obj.id > :after '
        if kind == config['form']['Data_Type']:
            params.addLongs('inputs', config['form']['IDs'])
            exclude += 'AND obj.id NOT IN (:inputs) '
        rows = conn.getQueryService().projection(
            f'SELECT DISTINCT obj.id, obj.name FROM {kind} obj '
            'JOIN obj.annotationLinks link JOIN link.child ann JOIN ann.mapValue mv '
            "WHERE TYPE(ann) = MapAnnotation AND (mv.name = 'Workflow_ID' OR "
            "(ann.ns = 'biomero/workflow/batch' AND mv.name = 'Batch_Supervisor_Workflow_ID')) "
            'AND mv.value = :uuid ' + exclude + 'ORDER BY obj.id', params, conn.SERVICE_OPTS)
        for row in rows:
            object_id = row[0].val
            if kind == config['form']['Data_Type'] and object_id in config['form']['IDs']:
                continue
            outputs.append({'id': object_id, 'name': row[1].val, 'type': kind})
        if len(outputs) > limit:
            break
    return outputs[:limit], len(outputs) > limit


def _viewer_links(conn, objects, default_type=None):
    """Use readable per-object provenance, never a workflow-format guess."""
    from omero.sys import ParametersI
    try:
        viewer = reverse('biomero_zarr_viewer_index')
    except NoReverseMatch:
        return  # Viewer is optional; don't offer broken links when absent.
    for kind in ('Plate', 'Image'):
        selected = {obj['id']: obj for obj in objects
                    if obj.get('type', default_type) == kind}
        if not selected:
            continue
        params = ParametersI()
        params.addLongs('ids', list(selected))
        try:
            rows = conn.getQueryService().projection(
                f'SELECT DISTINCT obj.id, mv.value FROM {kind} obj '
                'JOIN obj.annotationLinks link JOIN link.child ann JOIN ann.mapValue mv '
                "WHERE obj.id IN (:ids) AND TYPE(ann) = MapAnnotation "
                "AND ann.ns = 'biomero.import' AND mv.name IN ('Imported_from', 'Filepath')",
                params, conn.SERVICE_OPTS)
            for row in rows:
                if row[0].val in selected and re.search(r'\.zarr(?:[/\\]|$)', row[1].val or '', re.I):
                    selected[row[0].val]['viewer_url'] = f'{viewer}?{kind.lower()}={row[0].val}'
        except Exception:
            logger.exception('Could not determine history Zarr viewer links')


@login_required()
@require_GET
def workflow_history_outputs(request, workflow_id, conn=None, **kwargs):
    """Keyset-paginated result objects, scoped exactly like run detail."""
    after = None
    cursor = request.GET.get('cursor')
    if cursor:
        try:
            kind, raw_id = cursor.split(':')
            object_id = int(raw_id)
            if kind not in ('Plate', 'Dataset', 'Image') or not 0 <= object_id <= 2**63 - 1:
                raise ValueError()
            after = (kind, object_id)
        except (ValueError, TypeError):
            return JsonResponse({'error': 'Invalid result cursor.'}, status=400)
    try:
        with history_tracker() as tracker:
            run = tracker.repository.get(UUID(str(workflow_id)))
            if not _owned(run, conn):
                return JsonResponse({'error': 'Run not found.'}, status=404)
            tasks = [tracker.repository.get(i) for i in run.tasks]
            try:
                config = run_configuration(run, tasks)
            except HistoryConfigurationError:
                config = {'workflow_id': str(run.id), 'form': {'Data_Type': None, 'IDs': []}}
            objects, more = _outputs(conn, config, after=after, limit=20)
            _viewer_links(conn, objects)
            return JsonResponse({'objects': objects, 'has_more': more})
    except AggregateNotFoundError:
        return JsonResponse({'error': 'Run not found.'}, status=404)
    except Exception:
        logger.exception('Could not load workflow results page')
        return JsonResponse({'error': 'Result links are unavailable.'}, status=503)


def _restore_destinations(conn, config):
    """Resolve containers by recorded ID or result provenance, never name alone."""
    from omero.sys import ParametersI
    for kind, child_kind, field, id_field in (
        ('Dataset', 'Image', 'selectedDatasets', 'selectedDatasetId'),
        ('Screen', 'Plate', 'selectedScreens', 'selectedScreenId'),
    ):
        names = config['form'].get(field, [])
        if not names:
            continue
        selected = None
        try:
            recorded_id = config['form'].get(id_field)
            if recorded_id:
                selected = conn.getObject(kind, int(recorded_id))
            else:
                params = ParametersI()
                params.addString('uuid', config['workflow_id'])
                params.page(0, 2)
                rows = conn.getQueryService().projection(
                    f'SELECT DISTINCT obj.id FROM {kind} obj '
                    f'JOIN obj.{child_kind.lower()}Links parentLink '
                    'JOIN parentLink.child child JOIN child.annotationLinks link '
                    'JOIN link.child ann JOIN ann.mapValue mv '
                    "WHERE TYPE(ann) = MapAnnotation AND (mv.name = 'Workflow_ID' OR "
                    "(ann.ns = 'biomero/workflow/batch' AND mv.name = 'Batch_Supervisor_Workflow_ID')) "
                    'AND mv.value = :uuid ORDER BY obj.id', params, conn.SERVICE_OPTS)
                if len(rows) == 1:
                    selected = conn.getObject(kind, rows[0][0].val)
            if selected and selected.canLink():
                config['form'][field] = [selected.getName()]
                config['form'][id_field] = selected.getId()
                continue
        except Exception:
            logger.exception('Could not restore workflow %s destination', kind)
        config['form'][field] = []
        config['form'][id_field] = None
        config['warnings'].append(
            f'The previous {kind.lower()} destination could not be uniquely restored. '
            'Choose an output destination before submitting.')


def _batch_children(tracker, parent, tasks):
    links = [(UUID(str(t.params['child_workflow_id'])), int(t.params['batch_index']) + 1)
             for t in tasks if isinstance(t.params, dict)
             and 'child_workflow_id' in t.params and 'batch_index' in t.params]
    if not links:
        return []
    table = WorkflowProgressView.__table__
    with tracker.factory.datastore.engine.connect() as db:
        rows = db.execute(select(table.c.workflow_id, table.c.status).where(
            table.c.workflow_id.in_([uid for uid, _ in links]),
            table.c.user == parent.user, table.c.group == parent.group)).mappings()
        visible = {row['workflow_id']: row['status'] for row in rows}
    return [{'workflow_id': str(uid), 'index': index, 'status': visible[uid]}
            for uid, index in sorted(links, key=lambda link: link[1]) if uid in visible]


def _batch_context(tracker, run, tasks, config, conn):
    """Resolve explicit child IDs; a candidate's name alone proves nothing."""
    parent_launcher = next((t for t in tasks if t.task_name.endswith('SLURM_Run_Workflow_Batched.py')), None)
    if parent_launcher:
        config['batch'] = {'role': 'parent', 'total': len(parent_launcher.params.get('batches', []))}
        config['batch']['children'] = _batch_children(tracker, run, tasks)
        return
    if not config['form'].get('batchEnabled'):
        return
    table = WorkflowProgressView.__table__
    # Older child launchers have no back-reference. Narrow the candidate set in
    # SQL, then verify the relationship from the parent's recorded task params.
    statement = select(table.c.workflow_id).where(
        table.c.user == run.user, table.c.group == run.group,
        table.c.name.endswith('(Batched)')).order_by(table.c.start_time.desc()).limit(100)
    with tracker.factory.datastore.engine.connect() as db:
        candidates = list(db.execute(statement).scalars())
    for parent_id in candidates:
        parent = tracker.repository.get(parent_id)
        if not _owned(parent, conn):
            continue
        parent_tasks = [tracker.repository.get(i) for i in parent.tasks]
        child = next((t for t in parent_tasks if str((t.params or {}).get('child_workflow_id')) == str(run.id)), None)
        if child is None:
            continue
        parent_config = run_configuration(parent, parent_tasks)
        parent_config['inputs'] = _inputs(conn, parent_config)
        parent_config['inputs_available'] = len(parent_config['inputs']) == len(parent_config['form']['IDs'])
        _restore_destinations(conn, parent_config)
        launcher = next(t for t in parent_tasks if t.task_name.endswith('SLURM_Run_Workflow_Batched.py'))
        config['batch'] = {'role': 'child', 'parent_id': str(parent.id),
                           'index': int(child.params['batch_index']) + 1,
                           'total': len(launcher.params.get('batches', []))}
        config['batch']['children'] = _batch_children(tracker, parent, parent_tasks)
        config['parent_run'] = parent_config
        config['form'].update(batchEnabled=False, batchSize=1)
        return


@login_required()
@require_GET
def workflow_history_detail(request, workflow_id, conn=None, **kwargs):
    try:
        with history_tracker() as tracker:
            run = tracker.repository.get(UUID(str(workflow_id)))
            if not _owned(run, conn):
                return JsonResponse({'error': 'Run not found.'}, status=404)
            tasks = [tracker.repository.get(i) for i in run.tasks]
            try:
                config = run_configuration(run, tasks)
            except HistoryConfigurationError as exc:
                # Inspection is still useful when legacy/incomplete runs cannot
                # be translated into a launchable dialog configuration.
                config = {'workflow_id': str(run.id), 'workflow_name': run.name,
                          'form': {'IDs': [], 'Data_Type': None, 'version': None},
                          'rerun_error': str(exc), 'warnings': []}
            config['started'] = run.created_on
            config['name'] = run.name
            table = WorkflowProgressView.__table__
            with tracker.factory.datastore.engine.connect() as db:
                config['status'] = db.execute(select(table.c.status).where(
                    table.c.workflow_id == run.id, table.c.user == run.user,
                    table.c.group == run.group)).scalar_one_or_none() or 'UNKNOWN'
            config['ended'] = None
            from biomero.eventsourcing import WorkflowRun
            for stored in tracker.recorder.select_events(run.id, desc=True):
                event = tracker.mapper.to_domain_event(stored)
                if isinstance(event, (WorkflowRun.WorkflowCompleted, WorkflowRun.WorkflowFailed)):
                    config['ended'] = event.timestamp
                    break
            config['inputs'] = _inputs(conn, config) if config['form']['IDs'] else []
            config['inputs_available'] = len(config['inputs']) == len(config['form']['IDs'])
            _viewer_links(conn, config['inputs'], config['form']['Data_Type'])
            _batch_context(tracker, run, tasks, config, conn)
            _restore_destinations(conn, config)
            # A missing annotation or failed result lookup must not block reuse.
            try:
                config['outputs'], config['outputs_more'] = _outputs(conn, config)
                _viewer_links(conn, config['outputs'])
            except Exception:
                logger.exception('Could not read workflow result links')
                config['outputs'] = []
                config['outputs_unavailable'] = True
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
    count = select(func.count()).select_from(statement.subquery())
    statement = statement.order_by(table.c.start_time.desc(), table.c.workflow_id.desc())
    try:
        with history_tracker() as tracker:
            with tracker.factory.datastore.engine.connect() as db:
                total = db.execute(count).scalar_one()
                rows = list(db.execute(statement.offset(offset).limit(21)).mappings())
            items = [{'workflow_id': str(row['workflow_id']),
                      'workflow_name': row['main_task_name'] or row['name'],
                      'status': row['status'], 'started': row['start_time'],
                      'name': row['name']} for row in rows[:20]]
        return JsonResponse({'runs': items, 'total': total, 'has_more': len(rows) > 20, 'offset': offset})
    except Exception:
        logger.exception('Could not list workflow history')
        return JsonResponse({'error': 'Workflow history is unavailable.'}, status=503)
