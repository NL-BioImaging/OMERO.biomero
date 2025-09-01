#!/usr/bin/env python
import os
import sys


def main():
    # Use dedicated lightweight settings for running the app's tests
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "omero_biomero.test_settings")
    from django.core.management import execute_from_command_line

    execute_from_command_line(sys.argv)


if __name__ == "__main__":  # pragma: no cover
    main()
