# PYQ Export Viewer (GitHub Pages)

This folder contains a small static viewer for the GetMarks PYQ exporter output.

## Files
- `index.html` — UI
- `styles.css` — styling
- `app.js` — client-side logic
- `make_catalog.py` — generates `catalog.json` required by the viewer

## How to use (quick)
1. Copy these files into the **same folder that contains your export** (the folder that has exam directories).
2. Run:
   ```bash
   python make_catalog.py
   ```
   This creates `catalog.json`.
3. Open `index.html` locally (or deploy to GitHub Pages).

## GitHub Pages
- Put these files at your repository root (or `/docs`).
- Ensure your exported data folders are committed alongside.
- Generate `catalog.json` before pushing.

If you deploy from `/docs`, put everything (data + viewer files) into `/docs`.
