# qidimonitor

AI-powered 3D print monitor and slicer dashboard for the QIDI X-Plus 3. Streams live camera feed, runs AI print quality diagnosis via Ollama, slices STL files with OrcaSlicer, and manages G-code files on the printer — all from a single web UI.

## Features

- **Live camera feed** — MJPEG stream via client-side parser (28fps, no freezing); zoom in up to 4× with +/− buttons, drag to pan when zoomed, fullscreen toggle (⤢)
- **Print status** — real-time temps, progress bar with time remaining, elapsed time, filament used, live speed/flow override sliders
- **Speed & flow control** — M220 (print speed 25–200%) and M221 (flow rate 50–150%) sliders applied live mid-print via Moonraker gcode endpoint; independent controls, values sync from printer each poll
- **AI diagnosis** — Ollama vision model (`llava:13b`) analyzes snapshots for stringing, warping, under-extrusion, spaghetti, etc.; each issue includes what was observed + a specific fix; runs manually or on a timer
- **AI chat** — after any diagnosis, chat with the AI to understand root cause (settings vs. file vs. material vs. mechanical); full printer context and issue details injected into every message
- **Printer context** — injects live printer state + material profiles into AI prompts for better diagnosis
- **STL slicer** — drag-and-drop STL → OrcaSlicer CLI → G-code uploaded directly to printer; 3D WebGL model preview with X/Y/Z rotation controls (rotation baked into STL before slicing)
- **Re-slice** — sliced STLs are stored server-side; G-code files with a stored STL show a "Re-slice" button that reopens the slicer pre-filled with original settings
- **File manager** — list, upload, and delete G-code files on the printer; start/pause/resume/cancel prints
- **Auto-discovery** — TCP-scans the subnet for Moonraker when the printer's DHCP IP changes
- **Diagnosis history** — saved snapshots, printer context, and AI findings per run; collapsed cards show which issues triggered each warning

## Stack

| Layer | Tech |
|---|---|
| Frontend | React 18 + Vite + Three.js (STL viewer) |
| Backend | Node.js + Express (ESM) |
| Database | SQLite via `node:sqlite` (requires `--experimental-sqlite`) |
| AI | Ollama `/api/generate` for vision diagnosis; `/api/chat` for follow-up conversation |
| Slicer | OrcaSlicer 2.4+ CLI with built-in QIDI X-Plus 3 profiles |
| Printer API | Moonraker at `http://PRINTER_IP:7125` |
| Camera | mjpg-streamer on printer (YUYV + software JPEG, 320×240 @ ~28fps) |

## Running

Runs on the Mac mini via PM2. Public at `https://ais-mac-mini.tailb97cdb.ts.net/`.

```bash
pm2 restart qidimonitor   # restart service
pm2 logs qidimonitor      # tail logs
```

PM2 config: `ecosystem.config.cjs` — sets CWD, DB path, snapshots dir, port.

Runtime data lives at `~/qidimonitor/` (gitignored):
- `qidimonitor.db` — config + diagnosis history + slicer job records
- `snapshots/` — saved images from each diagnosis run
- `stls/` — original STL files stored for re-slicing

## Deploy

```bash
./deploy.sh
```

Builds the React client (`npm run build`) and restarts PM2.

## Setup

### Printer

Set the printer IP in the Settings tab (default `192.168.4.41`). The app derives all other URLs from it:

| Service | URL |
|---|---|
| Moonraker | `http://PRINTER_IP:7125` |
| Camera stream | `http://PRINTER_IP/webcam/?action=stream` |
| Camera snapshot | `http://PRINTER_IP/webcam/?action=snapshot` |

Override any URL in Settings if your camera is on a non-standard path.

**Auto-discovery:** when the printer becomes unreachable, the app TCP-scans the local subnet on port 7125 and updates the IP automatically. A "Find Printer" button in the Monitor tab triggers this manually.

### Camera

A Logitech C920 is plugged into the QIDI X-Plus 3's USB port. mjpg-streamer on the printer captures in YUYV mode with software JPEG encoding at quality 40, 320×240 — this keeps frames at ~5KB each and achieves ~28fps over the printer's WiFi link.

To adjust quality, SSH into the printer and edit `~/klipper_config/webcam.txt`:

```
camera_usb_options="-d /dev/video4 -r 320x240 -f 30 -y -q 40"
```

Then `sudo systemctl restart webcamd`. Raise `-q` for sharper frames at the cost of fps; raise `-r` for larger resolution (requires much lower `-q` to maintain throughput).

**SSH credentials:** `mks@PRINTER_IP`, password `makerbase`

### Ollama

Ollama runs on the Mac Studio (`100.73.128.40:11434`). Must be started with `OLLAMA_HOST=0.0.0.0:11434` so it accepts remote connections, and a vision-capable model must be pulled:

```bash
ssh labairj64@100.73.128.40
OLLAMA_HOST=0.0.0.0:11434 ollama serve &
ollama pull llava:13b        # ~8 GB
```

**Important:** the app uses `/api/generate` (not `/api/chat`) for image diagnosis — `/api/chat` with images returns empty responses on llava:13b with Ollama 0.32.x. Follow-up chat uses `/api/chat` (text-only, works fine).

If the model returns empty responses, re-pull it: `ollama pull llava:13b`. A corrupted mmproj (vision encoder) from an incomplete download is the usual cause.

Change the active model and Ollama URL in Settings. The model must support image inputs.

### OrcaSlicer (slicer feature)

OrcaSlicer must be installed on the Mac mini:

```bash
brew install --cask orcaslicer
```

The slicer route calls `/Applications/OrcaSlicer.app/Contents/MacOS/OrcaSlicer` with the built-in `Qidi X-Plus 3 0.4 nozzle` machine profile. A single override JSON that `inherits` the quality preset is passed — loading two process JSONs causes a "duplicate process config" error.

**Supported materials:** PLA, PLA+, PETG, ABS, ASA, TPU, PA-CF

**Configurable settings:** quality preset (0.12–0.28mm), supports (none/normal/tree, build-plate-only option), brim type + width, infill density + pattern, wall loops, top/bottom shell layers, ironing (none/top/topmost/all solid), seam position (aligned/back/random/nearest)

**Model rotation:** X/Y/Z rotation controls appear below the 3D viewer after loading an STL. Rotation is baked into the geometry (via Three.js STLExporter) before sending to OrcaSlicer, so the model slices in the correct orientation.

**Re-slice:** after each successful slice the original STL is saved to `~/qidimonitor/stls/`. G-code files in the file manager that originated from the slicer show a "Re-slice" button — clicking it pre-fills all prior settings in the Slicer panel so you can tweak and re-run without re-uploading the STL.

## Network

The Mac mini sits on the `192.168.4.x` subnet with the printer. The Optiplex (wired, `192.168.1.x`) cannot route to the printer subnet — that's why this service runs on the Mac mini instead of the Optiplex.

## Project structure

```
server/
  index.js            — Express app + auto-monitor loop
  db.js               — SQLite setup, config, diagnosis CRUD, slicer job CRUD
  discovery.js        — subnet TCP scan for auto-discovery
  printerContext.js   — fetch full printer state; computes time remaining from slicer estimate + progress
  materialProfiles.js — QIDI recommended temp/speed ranges per filament
  routes/
    config.js         — GET/POST /api/config
    printer.js        — status, snapshot, stream, discover, context, gcode (M220/M221)
    diagnose.js       — POST /api/diagnose (vision), POST /api/diagnose/chat (follow-up), GET /api/history
    files.js          — list, upload, delete, print controls
    slicer.js         — STL slice + re-slice via OrcaSlicer CLI; stores STLs + job records; uploads G-code to printer

client/src/
  App.jsx             — tab layout (Monitor / Files / History / Settings)
  components/
    LiveFeed.jsx      — MJPEG stream parser, reconnect, watchdog; zoom (1–4×) with drag-to-pan and fullscreen
    PrintStatus.jsx   — temps, progress + time remaining, speed/flow sliders, print controls
    DiagnosePanel.jsx — diagnosis trigger, issue cards with description + fix, AI chat thread
    AutoMonitor.jsx   — auto-diagnosis toggle + interval
    FileManager.jsx   — file list, upload with progress, delete, print; Re-slice button for STL-backed files
    Slicer.jsx        — STL drop zone, 3D viewer, rotation controls, full settings, slice + upload; re-slice support
    STLViewer.jsx     — Three.js WebGL viewer with OrbitControls; exposes getTransformedSTL() via ref
    History.jsx       — diagnosis history; collapsed cards show triggered issues; expanded shows description + fix
    Settings.jsx      — printer IP, camera URL, Ollama config
```
