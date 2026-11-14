# Multi-printer preparation

Scope: remove History navigation (retain data), preserve QIDI settings/history, seed an unconfigured Snapmaker U1, printer-scoped APIs and UI, simultaneous overview and independent automatic monitoring, explicit connection checks, toolhead-aware telemetry, isolated slicing/job access. U1 slicing stays unavailable until a verified U1 profile is installed; externally sliced files remain supported. Discovery must never replace one printer with another discovered device.

Acceptance: old QIDI settings and records survive migration; U1 never inherits QIDI addresses or machine profiles; every UI request and server action has stable printer identity; both printer cards run independently; failed/unknown IDs do not fall back to QIDI; tests cover isolation, migration, concurrent routing, U1 toolheads, monitoring overlap and disabled slicing. Build and browser checks before restarting the existing service. No printer control commands during verification.
