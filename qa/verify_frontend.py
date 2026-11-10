"""Check served frontend assets and JavaScript syntax without claiming visual QA."""
from html.parser import HTMLParser
import json
from pathlib import Path
import subprocess
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "frontend"


class Inventory(HTMLParser):
    def __init__(self):
        super().__init__()
        self.assets = []
        self.scripts = []
        self.navigation = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag in ("script", "img", "link"):
            reference = attrs.get("src") or attrs.get("href")
            if reference:
                self.assets.append(reference)
                if tag == "script":
                    self.scripts.append(reference)
        if "data-page" in attrs:
            self.navigation.append({"page": attrs["data-page"], "keyboard_link": bool(attrs.get("href"))})


def main():
    inventory = Inventory()
    inventory.feed((WEB / "index.html").read_text(encoding="utf-8"))
    missing, syntax_errors = [], []
    script_paths = [urlsplit(item).path for item in inventory.scripts]
    duplicates = sorted({item for item in script_paths if script_paths.count(item) > 1})
    for reference in inventory.assets:
        parsed = urlsplit(reference)
        if parsed.scheme or parsed.netloc:
            continue
        if not (WEB / parsed.path.lstrip("/")).is_file():
            missing.append(reference)
    for script in inventory.scripts:
        path = WEB / urlsplit(script).path.lstrip("/")
        result = subprocess.run(["node", "--check", str(path)], capture_output=True, text=True)
        if result.returncode:
            syntax_errors.append({"script": script, "error": result.stderr})
    report = {"local_asset_count": sum(not urlsplit(item).scheme for item in inventory.assets),
              "loaded_scripts": len(inventory.scripts), "missing_assets": missing,
              "javascript_syntax_errors": syntax_errors, "duplicate_scripts": duplicates, "navigation": inventory.navigation,
              "visual_desktop_test": "blocked: browser access host and native Windows pipe unavailable",
              "visual_mobile_test": "blocked: browser access host and native Windows pipe unavailable"}
    (ROOT / "qa" / "reports").mkdir(exist_ok=True)
    (ROOT / "qa" / "reports" / "frontend-checks.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))
    if missing or syntax_errors or duplicates:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
