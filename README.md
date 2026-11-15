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

The QIDI uses an attached Logitech C920 and mjpg-streamer. On November 15, the working stream was upgraded from 320×240 at 30 fps / JPEG quality 40 to **1280×720 at 10 fps / JPEG quality 50**. The current `webcam.txt` setting is `camera_usb_options="-d /dev/video4 -r 1280x720 -f 10 -y -q 50"`. Only `webcamd` was restarted; the active print continued.

Camera comparison: the original stream delivered about 30 fps at 1.23 Mbps directly; 640×480 / 15 fps / quality 60 delivered about 12 fps at 1.88 Mbps through the public dashboard; 720p / 10 fps / quality 50 delivered about 10 fps at 2.69 Mbps through the public dashboard in a 15-second sample. Native-MJPEG 720p tests were too choppy (about 1–2.6 fps) on this setup and were rejected. A subsequent 30-second public-stream check delivered 291 frames (about 10 fps) at 2.81 Mbps, with one maximum inter-frame gap of 1.06 seconds. These measurements describe delivery cadence and bandwidth, not camera-to-screen latency. The user visually checked the upgraded stream on November 15 and confirmed that it works well; 720p at 10 fps / JPEG quality 50 is the accepted setting.

Original and tested camera configs are backed up under `~/qidimonitor/backups/camera-20261115/`. To roll back, upload `webcam-original.txt` as `config/webcam.txt` via Moonraker and restart only `webcamd`. The previous November 14 snapshot outage was not reproduced during these tests.

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

## Automatic monitoring

The **Automatic monitoring** card appears below Print status in both the overview and each printer's Monitor tab. Click **Enable automatic checks** or **Disable automatic checks**. Enter a whole-number interval from **1 to 1440 minutes** and click **Save interval**; editing the field alone sends no request. **Check now** starts a due-independent check when enabled and prevents overlapping analyses for that printer.

The card shows whether monitoring is off, waiting for a print, checking the printer/camera, analyzing, scheduled, or in error, plus the last successful check, next scheduled check, and latest saved automatic result. Save and connection errors are visible. A printer address and snapshot camera must be configured before enabling. Vision/camera failures can be retried explicitly with Check now.

Enabling checks the printer immediately. While enabled, the scheduler observes printer state roughly every 15 seconds; an idle observation does not consume the diagnosis interval. A detected new/resumed print starts a check promptly. Subsequent diagnosis intervals are measured after each attempt finishes, so long-running AI requests cannot cause overlapping or back-to-back automatic analyses. The service begins monitoring enabled printers at startup. Printer schedules and failures remain isolated.

Disabling prevents new analyses. A camera fetch that has not reached analysis is stopped from proceeding; an AI analysis already underway may finish and save its result, with that state shown in the card. Automatic diagnoses never apply printer changes. Review recommendations in the printer's AI Diagnosis panel and use Apply fix explicitly.

`GET /api/printers/:printerId/monitor` returns live state and the latest saved automatic result; `POST /api/printers/:printerId/monitor/check` starts a nonblocking check. Enable and interval settings remain in the printer-scoped config API. Runtime progress and scheduling reset on service restart; saved enable/interval settings and diagnosis history persist.

## Manual flow rate

In Print status during a print, use the **− / +** stepper or number field to adjust flow in **1 percentage-point steps**, then click **Apply flow**. The manual range remains 50–150%. Editing the selected value does not send commands; the current reported flow is shown below it. **Reset** retains its existing behavior of applying 100%. This makes 1–2% AI-recommended adjustments easy to enter precisely.

## Manual nozzle temperature

During an active or paused QIDI print, open **Monitor → Print status → Nozzle temperature**, enter a whole-number target in °C, and click **Apply temperature**. This control also appears in the all-printers overview. Actual temperature and current target are displayed separately; typing does not send a command. No diagnosis or AI approval is needed.

Manual targets allow 180–300°C, narrowed by the printer's reported minimum/maximum heater and minimum extrusion temperatures (with a 5°C margin). The detected material baseline is shown as a reference; manual entry can follow the filament manufacturer's settings rather than the narrower AI-fix range. Missing heater limits disable the control. Idle preheating and heater-off actions are not supported by this control.

`POST /api/printers/qidi/printer/nozzle` accepts `target`, `expected_target`, `extruder`, and `filename`. Before sending a single named-extruder command, it checks the current print, toolhead, target, and hardware limits. Target confirmation tolerates slow command acknowledgments; it does not wait for actual temperature to settle or retry an uncertain command. Simulated-printer tests cover invalid/stale targets, printer isolation, printing, paused prints, and stopped-print rejection. The manual control is QIDI-only for now.

## Reviewed diagnosis fixes

Open **QIDI → Monitor → AI Diagnosis** and run **Diagnose Now**. Eligible new diagnoses show **Review a suggested adjustment**, with the setting at diagnosis, proposed value with % or °C units, reason, and **Apply fix** button. Nothing changes automatically. After applying, live readings confirm the result and the manual controls refresh. **Recent adjustments** preserves the log and **Undo** across page reloads and newer diagnoses. Automatic monitoring results appear in the diagnosis panel within fifteen seconds, but still require an explicit Apply click.

The first version supports one modest adjustment per diagnosis on the QIDI only:

| Control | Limits |
|---|---|
| Speed | Reduce by 5–10 percentage points for ghosting or under-extrusion; final override 50–100% |
| Nozzle target | Change by at most 10°C; final target within the detected material baseline and hardware limits; actual temperature must be within 5°C of the current target before applying |
| Flow | Change by 1–2 percentage points; current and final override 95–105%; direction must match under/over-extrusion |
| Part cooling fan | Increase by at most 10 percentage points, after the first two layer heights; final PLA 50–100%, PETG 20–50%, ABS/ASA/TPU 0–20% |

Nozzle, flow, and fan proposals require a recognized material from file metadata. Missing telemetry, uploaded images, critical/severe findings, spaghetti, warping, bed adhesion failures, and layer delamination offer advice rather than executable changes. Nozzle fixes decrease the target for stringing, blobs, or over-extrusion and increase it only for under-extrusion. Baselines are PLA 200–210°C, PETG 230–245°C, ABS/ASA 235–255°C, and TPU 210–225°C; changes also require reported heater limits and remain within 180–280°C. Undo can restore the original verified target within a 10°C margin around its material baseline, subject to hardware limits. Retraction, calibration, motion, power, bed/chamber temperature, and other heater changes are not part of reviewed fixes. A suggested adjustment is an experiment to inspect, not a guaranteed repair.

Proposals expire ten minutes after the captured readings. Before Apply or Undo, the server rechecks the active print/session, toolhead, material, existing control value, and adjustment limits. Allow at least one minute between fixes and run a new diagnosis after the previous change. Undo is available for ten minutes after a verified application while the same print and unchanged adjusted value are still present. Slicer commands can subsequently override fan settings or nozzle targets; Undo then requires manual review.

Every submitted action and outcome is stored in SQLite (`diagnosis_fixes` and `diagnosis_fix_events`). The vision request uses [Ollama structured output](https://ollama.com/blog/structured-outputs) without a sample diagnosis for the model to copy. Requests identify a saved proposal; arbitrary AI or client G-code is never executed. Duplicate clicks cannot resend it. Nozzle confirmation verifies the requested target, not instantaneous measured temperature; allow the nozzle to settle before assessing quality. The app uses an explicitly named extruder heater command and never waits for heating inside the print command queue. Slow acknowledgments are checked against actual settings; uncertain changes are not retried, including after a service restart. Inspect live controls and acknowledge an unconfirmed result before submitting a fresh fix. Acknowledgement sends no printer command.

API: `GET /api/printers/:printerId/diagnose/:diagnosisId/fixes`, `GET /api/printers/:printerId/diagnose/fixes/recent`, and `POST /api/printers/:printerId/diagnose/fixes/:fixId/apply|undo|dismiss`. Fixes, logs, and requests are scoped to their printer. Existing diagnoses remain readable; only new eligible diagnoses generate proposals.

The pre-release runtime backup is `~/qidimonitor/backups/pre-reviewed-fixes-20261115-082742.db` (integrity checked, 45 existing diagnoses retained). Live diagnosis/API smoke checks succeeded without applying controls; visual browser QA was unavailable.

Integration tests use disposable databases, a simulated vision model, and simulated printers. They cover bounded proposals, missing data, uploaded-image rejection, stale/changed print rejection, per-printer isolation, duplicate submission, cooldowns, delayed setting updates/acknowledgments, apply/undo, and unconfirmed-action handling. No physical printer settings are changed by the tests.

## Chamber light

Use **Chamber light** directly below the camera on the overview or printer Monitor tab, or open **Settings → Chamber light**. Click **Turn on** or **Turn off**; changes take effect immediately without saving Settings. The control reads the printer's actual state every two seconds and shows **Updating…** while a change is being confirmed. Disconnected or unsupported printers report their status; U1 controls must be enabled before switching its light.

The light API (`GET/POST /api/printers/:printerId/printer/light`, POST body `{"on":true}`) detects the explicit `output_pin caselight` object and uses Klipper's `SET_PIN` command. It never guesses fan, heater, or power pins. See [Klipper's command reference](https://www.klipper3d.org/G-Codes.html#set_pin).

Klipper can apply the light command before acknowledging it. The server checks actual pin state while the command is in flight and sends each requested change only once. The UI ignores stale refreshes during a toggle and disables further toggles until confirmation. If confirmation takes longer than twelve seconds, the API returns HTTP 202 with a pending state and the UI continues checking; after thirty more seconds it allows another attempt with an unconfirmed-state message. HTML pages are served without caching so reloads fetch the latest UI.

Verification on November 15, 2026: integration tests passed for delayed command acknowledgments, delayed pin changes, repeated off/on toggles, invalid requests, unsupported printers, and printer isolation. The production build passed. Four consecutive physical-printer toggles confirmed successfully in about 1–1.5 seconds each, restoring the original light state. Visual browser QA was unavailable.

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
