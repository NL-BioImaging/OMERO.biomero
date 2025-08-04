import logging

from django.apps import AppConfig

from .plugin_settings import INGEST_TRACKING_DB_URL

logger = logging.getLogger(__name__)


class OmeroBiomeroConfig(AppConfig):
    name = 'omero_biomero'
    verbose_name = 'OMERO Biomero'

    def ready(self):
        db_url = INGEST_TRACKING_DB_URL
        if not db_url:
            logger.error("Environment variable 'INGEST_TRACKING_DB_URL' not set")
            return

        config = {'ingest_tracking_db': db_url}
        try:
            from omero_adi.utils.ingest_tracker import initialize_ingest_tracker

            if initialize_ingest_tracker(config):
                logger.info("IngestTracker initialized successfully")
            else:
                logger.error("Failed to initialize IngestTracker")
        except Exception:
            logger.error(
                "Unexpected error during IngestTracker initialization",
                exc_info=True,
            )
