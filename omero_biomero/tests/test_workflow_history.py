from types import SimpleNamespace
from unittest.mock import Mock, MagicMock, patch
from uuid import uuid4
import datetime

import pytest
from django.test import RequestFactory

from omero_biomero import workflow_history as history


def fixture():
    run = SimpleNamespace(id=uuid4(), user=1, group=2, tasks=[])
    params = {'workflows': ['segment'], 'segment_Version': 'v1',
              'segment_|_diameter': 12, 'other_|_diameter': 99,
              'Data_Type': 'Plate', 'IDs': [15], 'Batch_Size': 2}
    task = SimpleNamespace(task_name='SLURM_Run_Workflow.py', params=params,
                           task_version='2.9', input_data=[15])
    return run, [task]


def test_configuration_restores_selected_workflow_only():
    run, tasks = fixture()
    result = history.run_configuration(run, tasks)
    assert result['workflow_name'] == 'segment'
    assert result['form']['diameter'] == 12
    assert result['form']['version'] == 'v1'
    assert result['form']['IDs'] == [15]
    assert result['form']['batchSize'] == 2
    assert 'other_|_diameter' not in result['form']
    assert not result['form']['clearExistingRois']


@pytest.mark.parametrize('kind,field,id_field', [
    ('Screen', 'selectedScreens', 'selectedScreenId'),
    ('Dataset', 'selectedDatasets', 'selectedDatasetId'),
])
def test_destination_restored_from_unique_provenance_not_name(kind, field, id_field):
    config = {'workflow_id': str(uuid4()), 'warnings': [],
              'form': {field: ['Original name']}}
    conn = Mock()
    conn.getQueryService.return_value.projection.return_value = [[SimpleNamespace(val=51)]]
    obj = conn.getObject.return_value
    obj.getId.return_value = 51
    obj.getName.return_value = 'Renamed destination'
    obj.canLink.return_value = True
    history._restore_destinations(conn, config)
    assert config['form'][field] == ['Renamed destination']
    assert config['form'][id_field] == 51
    conn.getObject.assert_called_once_with(kind, 51)
    query, params, _ = conn.getQueryService.return_value.projection.call_args.args
    assert 'mv.value = :uuid' in query
    assert 'obj.name' not in query
    assert params.map['uuid'].val == config['workflow_id']


@pytest.mark.parametrize('count', [0, 2])
def test_missing_or_ambiguous_destination_requires_selection(count):
    config = {'workflow_id': str(uuid4()), 'warnings': [],
              'form': {'selectedScreens': ['Results']}}
    conn = Mock()
    conn.getQueryService.return_value.projection.return_value = [
        [SimpleNamespace(val=i)] for i in range(count)]
    history._restore_destinations(conn, config)
    assert config['form']['selectedScreens'] == []
    assert config['form']['selectedScreenId'] is None
    assert len(config['warnings']) == 1
    conn.getObject.assert_not_called()


@pytest.mark.parametrize('accessible', [False, True])
def test_recorded_destination_id_wins_and_requires_link_permission(accessible):
    config = {'workflow_id': str(uuid4()), 'warnings': [],
              'form': {'selectedDatasets': ['Results'], 'selectedDatasetId': 51}}
    conn = Mock()
    obj = conn.getObject.return_value
    obj.canLink.return_value = accessible
    obj.getId.return_value = 51
    obj.getName.return_value = 'Results'
    history._restore_destinations(conn, config)
    assert config['form']['selectedDatasetId'] == (51 if accessible else None)
    conn.getQueryService.assert_not_called()


def test_ambiguous_pipeline_is_not_guessed():
    run, tasks = fixture()
    tasks[0].params['workflows'] = ['segment', 'measure']
    with pytest.raises(ValueError, match='single workflow'):
        history.run_configuration(run, tasks)


def test_missing_analysis_settings_are_not_reported_as_multiple_workflows():
    run, _ = fixture()
    with pytest.raises(ValueError, match='No analysis workflow settings were recorded'):
        history.run_configuration(run, [])


@pytest.mark.parametrize('enabled', [False, True])
def test_destructive_source_options_are_preserved_only_as_advice(enabled):
    run, tasks = fixture()
    tasks[0].params[history.wf.ROI_CLEAR_EXISTING] = enabled
    tasks[0].params[history.wf.ROI_DELETE_LABEL_IMAGES] = enabled
    result = history.run_configuration(run, tasks)
    assert result['source_options']['clearExistingRois'] is enabled
    assert result['source_options']['deleteLabelImagesAfterRois'] is enabled
    assert result['form']['clearExistingRois'] is False
    assert result['form']['deleteLabelImagesAfterRois'] is False
    assert result['warnings'] == []


def test_detail_checks_owner_before_loading_tasks():
    run, _ = fixture()
    run.user = 99
    tracker = Mock()
    tracker.repository.get.return_value = run
    conn = Mock()
    conn.getEventContext.return_value = SimpleNamespace(userId=1, groupId=2)
    with patch.object(history, 'history_tracker') as factory:
        factory.return_value.__enter__.return_value = tracker
        response = history.workflow_history_detail(
            RequestFactory().get('/history/'), workflow_id=run.id, conn=conn)
    assert response.status_code == 404
    tracker.repository.get.assert_called_once_with(run.id)


def test_invalid_search_is_rejected_before_database_access():
    conn = Mock()
    with patch.object(history, 'history_tracker') as factory:
        response = history.workflow_history_list(
            RequestFactory().get('/history/', {'q': 'x' * 129}), conn=conn)
    assert response.status_code == 400
    factory.assert_not_called()


def test_empty_run_can_be_inspected_but_not_restored():
    import json
    run, _ = fixture()
    run.name = 'Incomplete run'
    run.created_on = datetime.datetime(2026, 1, 1, tzinfo=datetime.timezone.utc)
    tracker = Mock()
    tracker.repository.get.return_value = run
    tracker.recorder.select_events.return_value = []
    tracker.factory.datastore.engine = MagicMock()
    tracker.factory.datastore.engine.connect.return_value.__enter__.return_value.execute.return_value.scalar_one_or_none.return_value = 'FAILED'
    conn = Mock()
    conn.getEventContext.return_value = SimpleNamespace(userId=1, groupId=2)
    with patch.object(history, 'history_tracker') as factory, patch.object(history, '_outputs', return_value=([], False)):
        factory.return_value.__enter__.return_value = tracker
        response = history.workflow_history_detail(RequestFactory().get('/history/'), workflow_id=run.id, conn=conn)
    assert response.status_code == 200
    data = json.loads(response.content)
    assert data['rerun_error']
    assert data['ended'] is None
    assert data['inputs'] == []


def test_list_is_scoped_and_sorted_in_database():
    from sqlalchemy import create_engine
    from biomero.database import WorkflowProgressView
    engine = create_engine('sqlite://')
    table = WorkflowProgressView.__table__
    table.create(engine)
    with engine.begin() as db:
        for user, group, day in [(1, 2, 1), (1, 2, 2), (99, 2, 3), (1, 3, 4)]:
            db.execute(table.insert().values(workflow_id=uuid4(), user=user, group=group,
                start_time=datetime.datetime(2026, 1, day), main_task_name='segment', status='DONE'))
    tracker = Mock()
    tracker.factory.datastore.engine = engine
    conn = Mock()
    conn.getEventContext.return_value = SimpleNamespace(userId=1, groupId=2)
    with patch.object(history, 'history_tracker') as factory:
        factory.return_value.__enter__.return_value = tracker
        response = history.workflow_history_list(RequestFactory().get('/history/'), conn=conn)
    import json
    data = json.loads(response.content)
    assert len(data['runs']) == 2
    assert data['total'] == 2
    with patch.object(history, 'history_tracker') as factory:
        factory.return_value.__enter__.return_value = tracker
        response = history.workflow_history_list(RequestFactory().get('/history/', {'q': 'seg', 'offset': 1}), conn=conn)
        filtered = json.loads(response.content)
        assert filtered['total'] == 2
        assert len(filtered['runs']) == 1
        response = history.workflow_history_list(RequestFactory().get('/history/', {'q': 'missing'}), conn=conn)
        assert json.loads(response.content)['total'] == 0
    assert data['runs'][0]['started'].startswith('2026-01-02')
    assert data['runs'][0]['started'].endswith('Z')
    engine.dispose()


def test_projection_timestamp_retains_utc_meaning_and_aware_offsets():
    naive = datetime.datetime(2026, 9, 16, 16, 47, 38)
    aware = naive.replace(tzinfo=datetime.timezone.utc)
    assert history._utc_timestamp(naive) == aware
    assert history._utc_timestamp(aware) is aware
    assert history._utc_timestamp(None) is None


def test_backend_failure_does_not_expose_connection_details():
    with patch.object(history, 'history_tracker', side_effect=RuntimeError('postgres://secret')):
        response = history.workflow_history_list(RequestFactory().get('/history/'), conn=Mock())
    assert response.status_code == 503
    assert b'secret' not in response.content


def test_result_links_are_bounded_and_exclude_input_objects():
    conn = Mock()
    row = lambda i: [SimpleNamespace(val=i), SimpleNamespace(val=f'result {i}')]
    conn.getQueryService.return_value.projection.side_effect = [
        [row(15), row(99)], [], [row(i) for i in range(200, 207)]]
    config = {'workflow_id': str(uuid4()), 'form': {'Data_Type': 'Plate', 'IDs': [15]}}
    from omero.sys import ParametersI
    with patch('omero.sys.ParametersI', wraps=ParametersI) as parameters:
        outputs, more = history._outputs(conn, config)
        assert len(outputs) == 5
        assert more
        assert outputs[0] == {'id': 99, 'name': 'result 99', 'type': 'Plate'}
        assert parameters.call_count == 3
        params = conn.getQueryService.return_value.projection.call_args_list[0].args[1]
        assert params.map['inputs'].val[0].val == 15
    assert all(output['id'] != 15 for output in outputs)
    query = conn.getQueryService.return_value.projection.call_args_list[0].args[0]
    assert "Batch_Supervisor_Workflow_ID" in query
    assert "biomero/workflow/batch" in query


def test_result_cursor_crosses_types_and_limits_each_query():
    conn = Mock()
    row = lambda i: [SimpleNamespace(val=i), SimpleNamespace(val=f'result {i}')]
    conn.getQueryService.return_value.projection.side_effect = [[row(99)], [row(200), row(201)]]
    config = {'workflow_id': str(uuid4()), 'form': {'Data_Type': 'Image', 'IDs': [15]}}
    outputs, more = history._outputs(conn, config, after=('Dataset', 98), limit=2)
    assert [(obj['type'], obj['id']) for obj in outputs] == [('Dataset', 99), ('Image', 200)]
    assert more
    calls = conn.getQueryService.return_value.projection.call_args_list
    assert len(calls) == 2
    assert 'obj.id > :after' in calls[0].args[0]
    assert calls[0].args[1].map['after'].val == 98
    assert 'obj.id > :after' not in calls[1].args[0]
    assert 'obj.id NOT IN (:inputs)' in calls[1].args[0]


@pytest.mark.parametrize('cursor', ['Bad:1', 'Image:-1', 'Image:bad', 'Image:1:2'])
def test_invalid_result_cursor_does_not_open_tracking_database(cursor):
    with patch.object(history, 'history_tracker') as tracker:
        response = history.workflow_history_outputs(RequestFactory().get('/results/', {'cursor': cursor}),
                                                    workflow_id=uuid4(), conn=Mock())
    assert response.status_code == 400
    tracker.assert_not_called()


def test_results_page_rechecks_run_owner():
    run, _ = fixture()
    run.user = 99
    tracker = Mock()
    tracker.repository.get.return_value = run
    conn = Mock()
    conn.getEventContext.return_value = SimpleNamespace(userId=1, groupId=2)
    with patch.object(history, 'history_tracker') as factory:
        factory.return_value.__enter__.return_value = tracker
        response = history.workflow_history_outputs(RequestFactory().get('/results/'), workflow_id=run.id, conn=conn)
    assert response.status_code == 404
    conn.getQueryService.assert_not_called()


def test_results_page_returns_next_results_for_owned_run():
    import json
    run, tasks = fixture()
    run.tasks = [uuid4()]
    tracker = Mock()
    tracker.repository.get.side_effect = [run, tasks[0]]
    conn = Mock()
    conn.getEventContext.return_value = SimpleNamespace(userId=1, groupId=2)
    objects = [{'type': 'Image', 'id': 30, 'name': 'result'}]
    with patch.object(history, 'history_tracker') as factory, \
            patch.object(history, '_outputs', return_value=(objects, False)) as outputs, \
            patch.object(history, '_viewer_links'):
        factory.return_value.__enter__.return_value = tracker
        response = history.workflow_history_outputs(RequestFactory().get('/results/', {'cursor': 'Plate:9'}),
                                                    workflow_id=run.id, conn=conn)
    assert response.status_code == 200
    assert json.loads(response.content) == {'objects': objects, 'has_more': False}
    assert outputs.call_args.kwargs == {'after': ('Plate', 9), 'limit': 20}


def test_viewer_links_use_object_provenance_and_do_not_expose_storage_paths():
    conn = Mock()
    objects = [{'id': 1, 'type': 'Plate'}, {'id': 2, 'type': 'Plate'}, {'id': 3, 'type': 'Dataset'}]
    conn.getQueryService.return_value.projection.return_value = [
        [SimpleNamespace(val=1), SimpleNamespace(val='/private/processed/plate.ome.zarr')],
        [SimpleNamespace(val=2), SimpleNamespace(val='/private/input.tif')],
    ]
    with patch.object(history, 'reverse', return_value='/biomero_zarr_viewer/'):
        history._viewer_links(conn, objects)
    assert objects[0]['viewer_url'] == '/biomero_zarr_viewer/?plate=1'
    assert 'viewer_url' not in objects[1]
    assert 'viewer_url' not in objects[2]
    assert '/private' not in str(objects)
    query = conn.getQueryService.return_value.projection.call_args.args[0]
    assert "'Imported_from', 'Filepath'" in query
    assert "ann.ns = 'biomero.import'" in query


def test_viewer_absent_does_not_offer_dead_links_or_query_annotations():
    conn = Mock()
    with patch.object(history, 'reverse', side_effect=history.NoReverseMatch):
        history._viewer_links(conn, [{'id': 1, 'type': 'Image'}])
    conn.getQueryService.assert_not_called()


def test_child_reuse_disables_batching_and_retains_whole_parent_configuration():
    from sqlalchemy import create_engine
    engine = create_engine('sqlite://')
    table = history.WorkflowProgressView.__table__
    table.create(engine)
    child, child_tasks = fixture()
    parent, parent_tasks = fixture()
    parent_tasks[0].task_name = 'SLURM_Run_Workflow_Batched.py'
    parent_tasks[0].params.update(IDs=[15, 16, 17], batches=[[15, 16], [17]])
    child_tasks[0].params['IDs'] = [17]
    launcher_id, link_id = uuid4(), uuid4()
    parent.tasks = [launcher_id, link_id]
    link = SimpleNamespace(task_name='SLURM_Run_Workflow.py', params={'child_workflow_id': str(child.id), 'batch_index': 1})
    with engine.begin() as db:
        db.execute(table.insert().values(workflow_id=parent.id, user=1, group=2,
            name='Slurm Workflow (Batched)', start_time=datetime.datetime(2026, 1, 1), status='DONE'))
        db.execute(table.insert().values(workflow_id=child.id, user=1, group=2,
            name='Slurm Workflow (Batched) (batch 2/2)', start_time=datetime.datetime(2026, 1, 1), status='FAILED'))
    tracker = Mock()
    tracker.factory.datastore.engine = engine
    tracker.repository.get.side_effect = {parent.id: parent, launcher_id: parent_tasks[0], link_id: link}.__getitem__
    conn = Mock()
    conn.getEventContext.return_value = SimpleNamespace(userId=1, groupId=2)
    config = history.run_configuration(child, child_tasks)
    with patch.object(history, '_inputs', return_value=[{'id': i} for i in [15, 16, 17]]):
        history._batch_context(tracker, child, child_tasks, config, conn)
    assert config['batch'] == {'role': 'child', 'parent_id': str(parent.id), 'index': 2, 'total': 2,
                               'children': [{'workflow_id': str(child.id), 'index': 2, 'status': 'FAILED'}]}
    assert config['form']['IDs'] == [17]
    assert not config['form']['batchEnabled']
    assert config['parent_run']['form']['IDs'] == [15, 16, 17]
    assert config['parent_run']['form']['batchEnabled']
    assert config['parent_run']['status'] == 'DONE'
    engine.dispose()


def test_inline_run_reads_original_transfer_inputs_and_output_options():
    from biomero.constants import results
    run, _ = fixture()
    task = lambda name, params, version='v1': SimpleNamespace(task_name=name, params=params, task_version=version)
    config = history.run_configuration(run, [
        task('_SLURM_Image_Transfer.py', {'IDs': [3], 'Data_Type': 'Image', 'Format': 'OME-ZARR'}),
        task('CONVERT_OME-ZARR_TO_TIFF', {}),
        task('segment', {'diameter': 20}),
        task('SLURM_Import_Results.py', {results.OUTPUT_ATTACH_NEW_DATASET: True,
             results.OUTPUT_ATTACH_NEW_DATASET_NAME: 'results', results.OUTPUT_ATTACH_TABLE: True}),
    ])
    assert config['form']['IDs'] == [3]
    assert config['form']['diameter'] == 20
    assert config['form']['selectedDatasets'] == ['results']
    assert config['form']['uploadCsv'] is True
    assert config['form']['useZarrFormat'] is True


@pytest.mark.parametrize('url_variable', ['SQLALCHEMY_URL', 'INGEST_TRACKING_DB_URL'])
def test_replay_existing_event_store_without_creating_tables(tmp_path, monkeypatch, url_variable):
    from biomero import WorkflowTracker
    from biomero.eventsourcing import WorkflowRun, Task
    from sqlalchemy import inspect
    url = 'sqlite:///' + str(tmp_path / 'history.sqlite')
    writer = WorkflowTracker(env={'PERSISTENCE_MODULE': 'eventsourcing_sqlalchemy', 'SQLALCHEMY_URL': url})
    stored_run = WorkflowRun('run', '', 1, 2)
    workflow_id = stored_run.id
    _, tasks = fixture()
    stored_task = Task(workflow_id, tasks[0].task_name, '2.9', [15], tasks[0].params)
    stored_run.add_task(stored_task.id)
    stored_run.complete_workflow()
    writer.save(stored_run, stored_task)
    history.WorkflowProgressView.__table__.create(writer.factory.datastore.engine)
    before = inspect(writer.factory.datastore.engine).get_table_names()
    monkeypatch.delenv('SQLALCHEMY_URL', raising=False)
    monkeypatch.setenv(url_variable, url)
    monkeypatch.setattr(history.SlurmClient, 'get_config_paths', lambda *args: [])
    with patch.object(history.SlurmClient, 'from_config', side_effect=AssertionError('Must not initialize a Slurm client')):
        with history.history_tracker() as reader:
            run = reader.repository.get(workflow_id)
            config = history.run_configuration(run, [reader.repository.get(i) for i in run.tasks])
            assert config['form']['diameter'] == 12
            conn = Mock()
            conn.getEventContext.return_value = SimpleNamespace(userId=1, groupId=2)
            with patch.object(history, 'history_tracker') as factory, patch.object(history, '_inputs', return_value=[]), patch.object(history, '_outputs', return_value=([], False)):
                factory.return_value.__enter__.return_value = reader
                response = history.workflow_history_detail(RequestFactory().get('/history/'), workflow_id=workflow_id, conn=conn)
                import json
                detail = json.loads(response.content)
                assert response.status_code == 200
                assert detail['ended'] is not None
                assert detail['started'] <= detail['ended']
            assert inspect(reader.factory.datastore.engine).get_table_names() == before
    writer.close()
    writer.factory.datastore.engine.dispose()


def test_history_reads_actual_config_file_without_slurm_client(tmp_path, monkeypatch):
    config = tmp_path / 'slurm.ini'
    url = 'sqlite:///' + str(tmp_path / 'empty.sqlite')
    config.write_text('[ANALYTICS]\nsqlalchemy_url = ' + url)
    monkeypatch.delenv('SQLALCHEMY_URL', raising=False)
    with patch.object(history.SlurmClient, 'get_config_paths', return_value=[str(config)]):
        with history.history_tracker() as tracker:
            assert str(tracker.factory.datastore.engine.url) == url


@pytest.mark.parametrize('explicit_env,config_url,expected', [
    ('sqlite:///explicit', 'sqlite:///config', 'sqlite:///explicit'),
    (None, 'sqlite:///config', 'sqlite:///config'),
    (None, None, 'sqlite:///ingest'),
    ('', '', 'sqlite:///ingest'),
])
def test_history_database_precedence(monkeypatch, explicit_env, config_url, expected):
    from configparser import ConfigParser
    config = ConfigParser()
    if config_url is not None:
        config.read_dict({'ANALYTICS': {'sqlalchemy_url': config_url}})
    monkeypatch.delenv('SQLALCHEMY_URL', raising=False)
    if explicit_env is not None:
        monkeypatch.setenv('SQLALCHEMY_URL', explicit_env)
    monkeypatch.setenv('INGEST_TRACKING_DB_URL', 'sqlite:///ingest')
    with patch.object(history.SlurmClient, 'load_config', return_value=config), patch.object(history, 'WorkflowTracker') as factory:
        with history.history_tracker():
            assert factory.call_args.kwargs['env']['SQLALCHEMY_URL'] == expected
