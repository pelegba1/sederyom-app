"""
Builds the ZIP that goes to OpenAI's plugin portal: chatgpt-plugin/, with plugin.json at the
archive's root, into chatgpt-plugin/dist/. Python's zipfile and not PowerShell's Compress-Archive,
whose Windows entries can carry backslashes, which the portal rejects.

    npm run chat:plugin
"""
import json
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent / "chatgpt-plugin"
DIST = ROOT / "dist"


def main() -> None:
    version = json.loads((ROOT / "plugin.json").read_text(encoding="utf-8"))["version"]
    DIST.mkdir(exist_ok=True)
    target = DIST / f"sederyom-plugin-{version}.zip"
    files = sorted(p for p in ROOT.rglob("*") if p.is_file() and DIST not in p.parents)
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as archive:
        for path in files:
            archive.write(path, path.relative_to(ROOT).as_posix())

    with zipfile.ZipFile(target) as archive:
        names = archive.namelist()
        if archive.testzip() is not None:
            raise SystemExit("the archive is corrupt")
    if any("\\" in name for name in names):
        raise SystemExit("an entry has a backslash")
    for needed in ("plugin.json", "mcp.json", "skills/get-started/SKILL.md", "assets/logo.png", "assets/icon.png"):
        if needed not in names:
            raise SystemExit(f"{needed} is not in the archive")

    print(target)
    print("\n".join(f"  {name}" for name in names))


if __name__ == "__main__":
    main()
