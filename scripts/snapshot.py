"""Stable interface used by the preserved fourteen-chart renderer."""
import os
from archive import Archive

archive = Archive(os.environ["OPENROUTER_ARCHIVE_ROOT"], os.environ["OPENROUTER_SNAPSHOT"])
manifest = archive.manifest
reports = archive.reports
load = archive.load
