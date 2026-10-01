import json, sys
from pathlib import Path

if len(sys.argv) != 2:
    print("Usage: python scripts/bump-version.py 1.5.2")
    raise SystemExit(1)

version = sys.argv[1].lstrip("v")
path = Path("manifest.json")
data = json.loads(path.read_text(encoding="utf-8"))
data["version"] = version
path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
print(f"manifest.json -> {version}")
