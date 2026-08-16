# qidimonitor

AI-powered print quality monitor for the QIDI X-Plus 3. Takes snapshots from the printer camera, runs them through an Ollama vision model, and flags common FDM issues (stringing, warping, under-extrusion, spaghetti, etc.).

## Stack

- **Frontend:** React + Vite
- **Backend:** Node.js + Express (ESM, requires `--experimental-sqlite`)
- **Database:** SQLite via `node:sqlite`
- **AI:** Ollama vision model (default: `llava:13b`) — runs locally on the Mac mini
- **Printer API:** Moonraker at `http://PRINTER_IP:7125`

## Running

Runs on the Mac mini via PM2. Public at `https://ais-mac-mini.tailb97cdb.ts.net/`.

```bash
# Start / restart
pm2 restart qidimonitor

# Logs
pm2 logs qidimonitor
```

PM2 config: `ecosystem.config.cjs` — server CWD, DB path, snapshots dir all set there.

Runtime data lives at `~/qidimonitor/` (gitignored):
- `qidimonitor.db` — config + diagnosis history
- `snapshots/` — saved images from each diagnosis run

## Deploy (after code changes)

```bash
./deploy.sh
```

Builds the React client and restarts PM2.

## Setup

### Printer

Printer IP is stored in the Settings tab and seeded in `server/db.js`. Default: `192.168.4.52`.

The app auto-derives camera and Moonraker URLs from the IP:
- Moonraker: `http://PRINTER_IP:7125`
- Camera snapshot: `http://PRINTER_IP/webcam/?action=snapshot`
- Camera stream: `http://PRINTER_IP/webcam/?action=stream`

Override either URL in Settings if your camera is on a non-standard path.

### Camera

Plug a USB webcam into the QIDI X-Plus 3's USB port. The printer runs Linux with crowsnest/mjpg-streamer, which picks up USB cameras automatically at the standard `/webcam/` path.

**Recommended:** Logitech C920 (1080p, ~$70) — best image quality for AI diagnosis. Budget option: Logitech C270 (720p, ~$25).

### Ollama

Ollama runs on the Mac mini. Make sure a vision-capable model is pulled:

```bash
ollama pull llava:13b        # current default
ollama pull qwen2.5vl:7b     # lighter alternative
ollama pull qwen2.5vl:32b    # higher accuracy
```

Change the active model in the Settings tab.

## Network

The Mac mini is on the `192.168.4.0/22` WiFi subnet, same as the printer. The optiplex (wired, `192.168.1.0/24`) cannot route to the printer subnet — that's why this service runs on the Mac instead.

## First-time optiplex setup (no longer used)

Kept for reference in case deployment target changes. See the old `qidimonitor.service` file.
