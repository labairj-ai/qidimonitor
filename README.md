# QIDI Monitor

A shared 3D-printing dashboard for the **QIDI X-Plus 3** and **Snapmaker U1**. View both printers together, or open a printer's Monitor, Files, and Settings pages. Each printer has independent configuration, camera URLs, diagnoses, files, and automatic monitoring.

The History tab has been removed. Existing saved diagnoses and slicing jobs remain in the database.

## Current deployment

- **Host:** Mac mini, managed by PM2 as `qidimonitor`.
- **Dashboard:** https://qidiprinter.tailb97cdb.ts.net/
- **Local address:** http://127.0.0.1:4200/
- **Source:** `~/Desktop/qidimonitor`
- **Runtime data:** `~/qidimonitor`
- **OptiPlex:** an old installation exists but is inactive. It is not the current application host; this release does not activate or deploy to it.

The Mac mini can reach the QIDI printer's network and has OrcaSlicer installed. Keep the service here. The OptiPlex cannot currently reach the printer subnet directly.

```bash
pm2 describe qidimonitor
pm2 restart qidimonitor
pm2 logs qidimonitor
```

`ecosystem.config.cjs` defines the PM2 process, port, and runtime database/snapshot paths. Tailscale Funnel forwards the existing HTTPS address to the local service.

## Features

- **All-printers overview:** independent camera, print status, and automatic diagnosis controls for each configured printer; setup card for the U1 before it arrives.
- **Live camera:** proxied HTTP MJPEG stream, snapshot capture, zoom/pan, fullscreen, reconnect handling, and stream watchdogs.
- **Print status:** temperatures, progress, filename, elapsed/remaining time, filament use, and available printer context. U1 context supports multiple extruders and identifies the active toolhead.
- **Controls:** printer-specific start, pause, resume, cancel, speed, flow, and available fan controls. U1 uploads and controls start disabled and can be enabled in its Settings after checking the printer's identity.
- **AI diagnosis:** manual image upload or camera snapshot, optional scheduled diagnosis while printing, and follow-up chat. Prompts use the selected printer's identity/context; QIDI material guidance is not applied to the U1.
- **Files:** list, upload, delete, and print G-code on the selected printer.
- **QIDI slicing:** STL preview/rotation, OrcaSlicer CLI, material/quality/support/infill and other settings, upload, and re-slicing of saved jobs.
- **Explicit connections:** an offline printer never silently changes its address to another Moonraker device found on the network.

## Snapmaker U1 arrival setup

The U1 workspace is prepared; its physical connection still needs verification when the printer arrives.

1. Connect the U1 to the same reachable local network as the Mac mini.
2. Open **Snapmaker U1 → Settings**, enter its local IP address/hostname, and save. If needed, provide an explicit Moonraker API URL instead of the default `http://PRINTER_IP:7125`.
3. Click **Test saved connection** and verify the reported hostname belongs to the U1. The check reads printer information and available webcam endpoints.
4. Choose **Use this camera** for a reported camera, then save. If no cameras are reported, enter the camera snapshot and stream URLs manually.
5. Verify camera, temperatures, progress, and toolheads on Monitor. Configure automatic diagnosis independently for each printer.
6. Optionally enable U1 uploads and print controls in Settings after verifying its identity.
7. Slice using Snapmaker Orca with the U1's own profiles, then upload the resulting G-code from its Files page.

**U1 built-in slicing is pending verified machine/toolhead profiles.** The app blocks use of the QIDI slicer for the U1. The existing camera viewer supports HTTP snapshots and MJPEG; another camera transport needs a compatible endpoint or further integration. Firmware-specific toolhead/camera behavior must be checked on the delivered printer.

## QIDI connection

The existing QIDI settings are retained during migration. The current configured printer address is `192.168.4.41`.

| Service | Default |
|---|---|
| Moonraker | `http://PRINTER_IP:7125` |
| Camera snapshot | `http://PRINTER_IP/webcam/?action=snapshot` |
| Camera stream | `http://PRINTER_IP/webcam/?action=stream` |

Each URL can be overridden in that printer's Settings. Use **Test saved connection** to inspect the saved target. Automatic IP reassignment is disabled for multi-printer safety; use a DHCP reservation or update the saved address if it changes.

The QIDI uses an attached Logitech C920 and mjpg-streamer. At the November 14 verification, status/context worked but snapshots timed out both through the app and directly at the unchanged printer camera URL. Camera recovery remains a separate operational issue.

## AI configuration

Each printer has its own saved vision/chat settings. Existing values are preserved, and the initial U1 AI settings copy the QIDI values without copying printer/camera addresses.

The current vision configuration uses local Ollama at `http://127.0.0.1:11434` with `qwen2.5vl:7b`. Configure a different reachable Ollama endpoint or vision model in Settings if required. Localhost refers to the Mac mini running the backend, not the browser's device.

Vision diagnosis uses Ollama `/api/generate` with an image and printer context. Follow-up chat uses an OpenAI-compatible `/v1/chat/completions` endpoint; chat URL/model settings are separate. The vision context window is 8192 tokens. Diagnosis failures are reported without issuing printer commands.

## QIDI slicing

Requires OrcaSlicer installed at:

```text
/Applications/OrcaSlicer.app/Contents/MacOS/OrcaSlicer
```

The app uses its bundled `Qidi X-Plus 3 0.4 nozzle` machine profile and QIDI quality presets. Supported material selections are PLA, PLA+, PETG, ABS, ASA, TPU, and PA-CF. Rotation is baked into exported STL geometry before slicing. Original STLs and settings are retained for re-slicing.

## Development and deployment

Requires Node with `node:sqlite` support (current Mac deployment: Node 26), npm, and OrcaSlicer for built-in QIDI slicing.

```bash
npm ci
npm test
npm run build
./deploy.sh
```

`deploy.sh` builds the client and restarts the existing Mac PM2 process. It does not deploy to the OptiPlex. For separate development instances, set a different `PORT`, `DB_PATH`, `SNAPSHOTS_DIR`, and `STLS_DIR` to avoid using live data. `npm run dev` starts the development server/client; configure isolated runtime paths first.

Before a database-changing release, take a consistent SQLite backup of the runtime database (use SQLite's backup API rather than copying an active WAL database alone). The initial multi-printer backup is `~/qidimonitor/backups/pre-multi-printer-20261114-185346.db`.

Runtime files, excluded from Git:

| Path under `~/qidimonitor` | Contents |
|---|---|
| `qidimonitor.db` | Printer settings, retained diagnoses, and slicing jobs |
| `snapshots/` | Diagnosis images |
| `stls/` | Original STL files for re-slicing |
| `backups/` | Database backups |

The transactional migration assigns old records to `qidi` and creates an unconfigured `u1`. Migration is repeatable and preserves existing QIDI setting values. The November 14 migration preserved 42 diagnoses and two slicing jobs; database integrity passed.

## API and architecture

Printer-specific endpoints use `/api/printers/:printerId/...` with stable IDs `qidi` and `u1`. `GET /api/printers` lists both configurations; `POST /api/printers/:printerId/test` checks a saved connection. Existing `/api/...` routes remain QIDI-only compatibility aliases. Unknown printer IDs return 404. Selection in one browser does not change another browser's request target.

```text
server/
  index.js             Express routing, static client, monitor startup
  printers.js          Printer scope, validation, saved connection checks
  monitor.js           Independent automatic schedules and overlap guards
  db.js                SQLite migration and printer-scoped records/settings
  printerContext.js    Available objects, toolheads, material/context data
  materialProfiles.js  QIDI material guidance
  routes/              Config, printer/camera, diagnosis/chat, files, slicer
client/src/
  App.jsx              Overview and per-printer Monitor / Files / Settings
  printerApi.jsx       Stable printer-scoped fetch and upload URLs
  components/          Camera, status, diagnosis/chat, files, slicing, settings
```

`npm test` uses temporary databases and simulated HTTP printers to check migration, isolation, concurrent routing, U1 toolheads, control targeting, camera URL normalization, slicing restrictions, and automatic-monitor overlap/failure isolation. `npm run build` validates the production bundle. Physical U1 acceptance and visual browser QA remain open; see [verification notes](docs/multi-printer-verification.md).
