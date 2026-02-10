#!/usr/bin/env python3
"""
make_catalog.py

Generate catalog.json used by the static PYQ Export Viewer (GitHub Pages compatible).

Usage:
  python make_catalog.py --root ./pyq_export
  # or run inside export root:
  python make_catalog.py

What it does:
- Walks: root/<exam>/<subject>/<chapter>/chapter_index.json
- Builds a compact catalog.json with stable paths to each chapter_index.json
- Does NOT load every payload.json (fast)

Notes:
- GitHub Pages cannot list directories at runtime, so catalog.json is required.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from datetime import datetime, timezone

def read_json(path: Path):
  return json.loads(path.read_text(encoding="utf-8"))

def main() -> int:
  ap = argparse.ArgumentParser()
  ap.add_argument("--root", default=".", help="Export root containing exam folders (default: current dir)")
  ap.add_argument("--out", default="catalog.json", help="Output catalog filename (default: catalog.json)")
  args = ap.parse_args()

  root = Path(args.root).resolve()
  out = Path(args.out).resolve()

  if not root.exists():
    print(f"Root does not exist: {root}")
    return 1

  exams = []
  for exam_dir in sorted([p for p in root.iterdir() if p.is_dir()]):
    subjects = []
    for subj_dir in sorted([p for p in exam_dir.iterdir() if p.is_dir()]):
      chapters = []
      for chap_dir in sorted([p for p in subj_dir.iterdir() if p.is_dir()]):
        ci = chap_dir / "chapter_index.json"
        if not ci.exists():
          continue
        try:
          meta = read_json(ci)
        except Exception:
          meta = {}

        rel_ci = ci.relative_to(root).as_posix()
        rel_chap = chap_dir.relative_to(root).as_posix()

        chapters.append({
          "name": chap_dir.name,
          "display": meta.get("chapter_name") or chap_dir.name,
          "path": rel_chap,
          "chapter_index": rel_ci,
        })

      if chapters:
        subjects.append({
          "name": subj_dir.name,
          "display": chapters[0].get("display_subject") if False else None,
          "chapters": chapters
        })

    if subjects:
      # best-effort display: use first chapter_index.json metadata if available
      display = None
      try:
        first_ci = Path(subjects[0]["chapters"][0]["chapter_index"])
        meta = read_json(root / first_ci)
        display = meta.get("exam_name") or exam_dir.name
      except Exception:
        display = exam_dir.name

      exams.append({
        "name": exam_dir.name,
        "display": display,
        "subjects": subjects
      })

  catalog = {
    "generated_at": datetime.now(timezone.utc).isoformat(),
    "root": root.name,
    "exams": exams
  }

  out.write_text(json.dumps(catalog, ensure_ascii=False, indent=2), encoding="utf-8")
  print(f"Wrote {out} with {len(exams)} exams")
  return 0

if __name__ == "__main__":
  raise SystemExit(main())
