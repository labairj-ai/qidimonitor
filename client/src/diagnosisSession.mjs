function estimatedStart(ctx) {
  const elapsed = ctx.print_total_duration_sec ?? ctx.print_duration_sec;
  return Number.isFinite(elapsed) ? ctx.captured_at - elapsed * 1000 : NaN;
}

export function belongsToPrint(result, ctx) {
  const captured = result.printer_context;
  if ((captured?.filename || result.print_file || null) !== (ctx?.filename || null)) return false;
  if (!ctx?.filename) return true;

  if (captured?.print_job_id != null && ctx.print_job_id != null) {
    return captured.print_job_id === ctx.print_job_id &&
      captured.print_started_at === ctx.print_started_at;
  }

  // Older records and printers without Moonraker history use elapsed time.
  const at = captured?.captured_at ?? Date.parse(result.timestamp);
  const active = ['printing', 'paused'].includes(ctx.print_state);
  const start = ctx.print_started_at ?? estimatedStart(ctx);
  const tolerance = ctx.print_started_at == null ? 2000 : 0;
  if (!Number.isFinite(at) || !Number.isFinite(start) || at < start - tolerance) return false;
  if (active && Number.isFinite(captured?.print_duration_sec) &&
      ctx.print_duration_sec < captured.print_duration_sec) return false;
  return true;
}

export function currentPrintAdjustments(data, ctx) {
  // Do not flash historical entries while the current printer context loads.
  if (!ctx?.filename) return { fixes: [], events: [] };
  const fixes = data.fixes.filter(fix => fix.baseline && belongsToPrint({
    printer_context: fix.baseline,
    timestamp: new Date(fix.created_at).toISOString(),
  }, ctx));
  const ids = new Set(fixes.map(fix => fix.id));
  return { fixes, events: data.events.filter(event => ids.has(event.fix_id)) };
}
