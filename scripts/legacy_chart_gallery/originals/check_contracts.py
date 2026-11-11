"""Validate examples, published metadata, chart identity and relative site assets."""
import argparse
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
from jsonschema import Draft202012Validator, FormatChecker

ROOT = Path(__file__).resolve().parent.parent

class Assets(HTMLParser):
    def __init__(self):
        super().__init__()
        self.paths = []
        self.chart_cards = 0
    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if "chart-card" in attrs.get("class", "").split():
            self.chart_cards += 1
        for key in ("src", "href", "data-image"):
            value = attrs.get(key, "")
            if value and not value.startswith(("http:", "https:", "#", "./")):
                self.paths.append(value)

def validate(site=None):
    schema = json.loads((ROOT / "data/version.schema.json").read_text())
    Draft202012Validator.check_schema(schema)
    validator = Draft202012Validator(schema, format_checker=FormatChecker())
    validator.validate(json.loads((ROOT / "data/version.example.json").read_text()))
    repo_schema = json.loads((ROOT / "data/repos.schema.json").read_text())
    from jsonschema import validators
    validators.validator_for(repo_schema)(repo_schema, format_checker=FormatChecker()).validate(json.loads((ROOT / "refs/.repos.json").read_text()))
    if site:
        site = Path(site)
        version = json.loads((site / "version.json").read_text())
        validator.validate(version)
        meta = json.loads((site / "charts/sources_and_scope.json").read_text())
        assert meta["snapshot"] == version["snapshot"]
        assert len(meta["charts"]) == 14
        assert len({c["file"] for c in meta["charts"]}) == 14
        for chart in meta["charts"]:
            assert chart["snapshot"] == version["snapshot"]
            assert chart["title"] and chart["notes"] and chart["datasets"]
            assert all("snapshot=" + version["snapshot"] in u for u in chart["source_urls"])
            assert hashlib.sha256((site / "charts" / chart["file"]).read_bytes()).hexdigest() == chart["sha256"]
        document = (site / "index.html").read_text()
        assert "{{" not in document
        parser = Assets()
        parser.feed(document)
        assert parser.chart_cards == 14
        for path in parser.paths:
            assert (site / path).is_file(), path
    print("Contract and site checks passed" + (f": {site}" if site else ""))

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--site")
    validate(parser.parse_args().site)
