# Multi-printer verification — 2026-11-14

Implemented on feature/multi-printer-u1 from main 4d1067d. Existing untracked 00000.log and funnel-watchdog.sh were preserved and excluded.

- npm test: 3 passing integration groups, no skips. Disposable legacy SQLite fixture and two HTTP printer simulators cover repeatable migration, diagnosis/job partitioning, simultaneous request routing, unknown IDs, invalid settings, connection checks, relative camera URL normalization, four toolheads/active extruder, U1 slicing rejection, controls targeting and per-printer monitoring overlap/failure isolation. Printer controls were exercised only against fixture HTTP servers.
- npm run build: passed. Existing Vite CJS deprecation and large bundle warnings remain.
- git diff --check: passed.
- Running service restarted through existing PM2 setup; localhost frontend and two-printer API respond successfully.
- Live QIDI read-only status/context: successful, standby, reported temperatures and original sensors.
- Database backup: ~/qidimonitor/backups/pre-multi-printer-20261114-185346.db (SQLite backup API before migration). All 42 diagnoses, 2 slicer jobs and all legacy config values verified preserved. Integrity check: ok.
- U1 remains unconfigured, automatic monitoring off, controls off. No real printer control commands issued.

Open verification:

- Physical U1 network/API/camera/toolhead compatibility awaits delivery. U1 requires HTTP snapshots/MJPEG for the existing camera viewer. Other camera transports require a compatible endpoint.
- Built-in U1 slicing is deliberately unavailable pending verified U1 profiles; use external U1 slicing plus printer-scoped upload.
- QIDI camera snapshot request times out via app and directly at its unchanged original URL. Status/context work. Camera recovery was not attempted in this software task.
- README's existing public hostname could not resolve from this environment; localhost works.
- Visual desktop/mobile browser QA could not run: no connected browsers available and native Safari could not provide a window. Responsive CSS and production build are present; visual appearance remains unverified.
