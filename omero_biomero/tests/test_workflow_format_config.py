from django.test import SimpleTestCase

from omero_biomero.config_validation import ConfigValidationError, validate_ini_sections


class WorkflowFormatConfigTests(SimpleTestCase):
    def test_rejects_malformed_workflow_lists(self):
        for value in ('true', '{}', '[1]', '"seg"', 'seg', '["bad name"]'):
            with self.subTest(value=value), self.assertRaises(ConfigValidationError):
                validate_ini_sections({"UI": {"zarr_v3_workflows": value}})

    def test_accepts_empty_and_named_workflows(self):
        for value in ('', '[]', '["seg", "plate-test"]', None):
            with self.subTest(value=value):
                validate_ini_sections({"UI": {"zarr_v3_workflows": value}})
