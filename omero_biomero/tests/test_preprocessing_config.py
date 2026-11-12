import os

from django.test import SimpleTestCase

from omero_biomero import settings


class PreprocessingDefaultsTests(SimpleTestCase):
    def test_converter_routes_pin_output_format(self):
        # biomero-converter's own default output format changes between releases
        # (OME-Zarr 0.5 since 0.2.5), so each default converter route pins its
        # format: updating the image must not change the stores it creates.
        if os.path.exists(settings.CONFIG_FILE_PATH):
            self.skipTest("a JSON configuration overrides the built-in defaults")
        routes = {
            key: route
            for key, route in settings.PREPROCESSING_CONFIG.items()
            if "biomero-converter" in route["container"]
        }
        self.assertTrue(routes)
        for key, route in routes.items():
            with self.subTest(route=key):
                self.assertEqual(route.get("extra_params", {}).get("outputformat"), "omezarr04")
