from types import SimpleNamespace
from unittest.mock import Mock, patch
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


def test_ambiguous_pipeline_is_not_guessed():
    run, tasks = fixture()
    tasks[0].params['workflows'] = ['segment', 'measure']
    with pytest.raises(ValueError, match='single workflow'):
        history.run_configuration(run, tasks)


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
    assert data['runs'][0]['started'].startswith('2026-01-02')
    engine.dispose()


def test_backend_failure_does_not_expose_connection_details():
    with patch.object(history, 'history_tracker', side_effect=RuntimeError('postgres://secret')):
        response = history.workflow_history_list(RequestFactory().get('/history/'), conn=Mock())
    assert response.status_code == 503
    assert b'secret' not in response.content


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
    writer.save(stored_run, stored_task)
    before = inspect(writer.factory.datastore.engine).get_table_names()
    monkeypatch.delenv('SQLALCHEMY_URL', raising=False)
    monkeypatch.setenv(url_variable, url)
    monkeypatch.setattr(history.SlurmClient, 'get_config_paths', lambda *args: [])
    with patch.object(history.SlurmClient, 'from_config', side_effect=AssertionError('Must not initialize a Slurm client')):
        with history.history_tracker() as reader:
            run = reader.repository.get(workflow_id)
            config = history.run_configuration(run, [reader.repository.get(i) for i in run.tasks])
            assert config['form']['diameter'] == 12
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
