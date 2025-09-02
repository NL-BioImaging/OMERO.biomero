#!/usr/bin/env python
# -*- coding: utf-8 -*-

import os
from setuptools import setup, find_packages


# Utility function to read the README file.
def read(fname):
    return open(os.path.join(os.path.dirname(__file__), fname)).read()


setup(
    name="omero-biomero",
    use_scm_version=True,
    packages=find_packages(exclude=["ez_setup"]),
    description="A Python plugin for OMERO.web combining database pages, script menu, and web importer functionality",
    long_description=read("README.md"),
    long_description_content_type="text/markdown",
    classifiers=[
        "Development Status :: 3 - Alpha",
        "Environment :: Web Environment",
        "Framework :: Django",
        "Intended Audience :: Developers",
        "Natural Language :: English",
        "Operating System :: OS Independent",
        "Programming Language :: JavaScript",
        "Programming Language :: Python :: 3",
        "Topic :: Internet :: WWW/HTTP",
        "Topic :: Internet :: WWW/HTTP :: Dynamic Content",
        "Topic :: Internet :: WWW/HTTP :: WSGI",
        "Topic :: Scientific/Engineering :: Visualization",
        "Topic :: Software Development :: Libraries :: Application Frameworks",
    ],
    author="Cellular Imaging Amsterdam UMC",
    author_email="cellularimaging@amsterdamumc.nl",
    license="AGPL-3.0",
    url="https://github.com/Cellular-Imaging-Amsterdam-UMC/OMERO.biomero",
    download_url=(
        "https://github.com/Cellular-Imaging-Amsterdam-UMC/OMERO.biomero/"
        "archive/refs/tags/v{version}.tar.gz"
    ),
    keywords=[
        "OMERO.web",
        "plugin",
        "database pages",
        "imports database",
        "workflows database",
        "script menu",
        "web importer",
    ],
    install_requires=[
        "omero-web>=5.6.0",
        "pyjwt",
        "biomero>=2.0.0-alpha.4",
        "configupdater>=3.2",
        "omero-adi==1.0.0b1",
    ],
    python_requires=">=3.12",
    include_package_data=True,
    zip_safe=False,
    package_data={
        "omero_biomero": [
            # Static files
            "static/css/*.css",
            "static/img/*.svg",
            "static/js/*.js",
            # Template files
            "templates/omero_biomero/webclientplugins/*.html",
            # Configuration files
            "*.omero",
        ],
    },
    entry_points={
        "console_scripts": [
            "omero-biomero-setup=omero_biomero.setup_integration:main",
        ],
    },
)
