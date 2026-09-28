"""Package only extension assets; run after changing extension files."""
import json
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile
from shutil import copyfile

root = Path(__file__).resolve().parent
source = root / "extension"
version = json.loads((source / "manifest.json").read_text(encoding="utf-8"))["version"]
files = sorted(path for path in source.iterdir() if path.suffix in {".js", ".json", ".html", ".css", ".svg", ".png"})
with ZipFile(root / "edge-homework-import.zip", "w", ZIP_DEFLATED) as archive:
    for path in files:
        archive.write(path, "extension/" + path.name)
with ZipFile(root / "edge-homework-import.zip") as archive:
    assert archive.testzip() is None
    assert all(archive.read("extension/" + path.name) == path.read_bytes() for path in files)
copyfile(root / "edge-homework-import.zip", root / "static" / "extension.zip")
print(f"Extension {version}: {len(files)} files packaged and verified.")
