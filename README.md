# qidimonitor

AI-powered 3D print monitor and slicer dashboard for the QIDI X-Plus 3. Streams live camera feed, runs AI print quality diagnosis via Ollama, slices STL files with OrcaSlicer, and manages G-code files on the printer — all from a single web UI.

## Features

- **Live camera feed** — MJPEG stream via client-side parser (28fps, no freezing)
- **Print status** — real-time temps, speeds, Z height, fan%, filament type
- **AI diagnosis** — Ollama vision model analyzes snapshots for stringing, warping, under-extrusion, spaghetti, etc.; runs manually or on a timer
- **Printer context** — injects live printer state + material profiles into AI prompts for better diagnosis
- **STL slicer** — drag-and-drop STL → OrcaSlicer CLI → G-code uploaded directly to printer; supports, brim, infill, and pattern configurable; 3D WebGL model preview with orbit controls
- **File manager** — list, upload, and delete G-code files on the printer; start/pause/resume/cancel prints
- **Auto-discovery** — TCP-scans the subnet for Moonraker when the printer's DHCP IP changes
- **Diagnosis history** — saved snapshots, printer context, and AI findings per run

## Stack

| Layer | Tech |
|---|---|
| Frontend | React 18 + Vite + Three.js (STL viewer) |
| Backend | Node.js + Express (ESM) |
| Database | SQLite via `node:sqlite` (requires `--experimental-sqlite`) |
| AI | Ollama vision model on Mac Studio (`llava:13b` default) |
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
- `qidimonitor.db` — config + diagnosis history
- `snapshots/` — saved images from each diagnosis run

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

Ollama runs on the Mac Studio (`100.73.128.40:11434`). A vision-capable model must be pulled:

```bash
ssh labairj64@100.73.128.40
ollama pull llava:13b        # current default (~7.4 GB)
```

Change the active model and Ollama URL in Settings. The model must support image inputs.

### OrcaSlicer (slicer feature)

OrcaSlicer must be installed on the Mac mini:

```bash
brew install --cask orcaslicer
```

The slicer route calls `/Applications/OrcaSlicer.app/Contents/MacOS/OrcaSlicer` with the built-in `Qidi X-Plus 3 0.4 nozzle` machine profile. Supported materials: PLA, PLA+, PETG, ABS, ASA, TPU, PA-CF.

## Network

The Mac mini sits on the `192.168.4.x` subnet with the printer. The Optiplex (wired, `192.168.1.x`) cannot route to the printer subnet — that's why this service runs on the Mac mini instead of the Optiplex.

## Project structure

```
server/
  index.js            — Express app + auto-monitor loop
  db.js               — SQLite setup, config, diagnosis CRUD
  discovery.js        — subnet TCP scan for auto-discovery
  printerContext.js   — fetch full printer state for AI prompt
  materialProfiles.js — QIDI recommended temp/speed ranges per filament
  routes/
    config.js         — GET/POST /api/config
    printer.js        — status, snapshot, stream, discover, context
    diagnose.js       — POST /api/diagnose, GET /api/history
    files.js          — list, upload, delete, print controls
    slicer.js         — STL slice via OrcaSlicer CLI + upload to printer

client/src/
  App.jsx             — tab layout (Monitor / Files / History / Settings)
  components/
    LiveFeed.jsx      — MJPEG stream parser, reconnect, watchdog
    PrintStatus.jsx   — live temps, speed, filament badge, print controls
    DiagnosePanel.jsx — manual diagnosis trigger + result display
    AutoMonitor.jsx   — auto-diagnosis toggle + interval
    FileManager.jsx   — file list, upload with progress, delete, print
    Slicer.jsx        — STL drop zone, 3D viewer, settings, slice + upload
    STLViewer.jsx     — Three.js WebGL viewer with OrbitControls
    History.jsx       — diagnosis history with printer context panel
    Settings.jsx      — printer IP, camera URL, Ollama config
```
