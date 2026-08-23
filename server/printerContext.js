import fetch from 'node-fetch';
import { lookupMaterial, checkDeviations } from './materialProfiles.js';

export async function getPrinterContext(config) {
  const base = config.moonraker_url || (config.printer_ip ? `http://${config.printer_ip}:7125` : null);
  if (!base) return null;

  try {
    const [objRes, cfgRes] = await Promise.all([
      fetch(
        `${base}/printer/objects/query?print_stats&display_status&toolhead&gcode_move&extruder&heater_bed&heater_generic+hot&output_pin+fan0&filament_switch_sensor+fila&motion_report`,
        { signal: AbortSignal.timeout(5000) }
      ),
      fetch(`${base}/printer/objects/query?configfile`, { signal: AbortSignal.timeout(5000) }),
    ]);

    if (!objRes.ok) return null;
    const status = (await objRes.json()).result?.status || {};

    let printerCfg = null;
    if (cfgRes.ok) {
      const cfg = (await cfgRes.json()).result?.status?.configfile?.config || {};
      printerCfg = {
        nozzle_diameter: cfg.extruder?.nozzle_diameter,
        filament_diameter: cfg.extruder?.filament_diameter,
        pressure_advance: cfg.extruder?.pressure_advance,
        max_velocity: cfg.printer?.max_velocity,
        max_accel: cfg.printer?.max_accel,
        kinematics: cfg.printer?.kinematics,
        input_shaper_x: cfg.input_shaper ? `${cfg.input_shaper.shaper_type_x} @ ${cfg.input_shaper.shaper_freq_x}Hz` : null,
        input_shaper_y: cfg.input_shaper ? `${cfg.input_shaper.shaper_type_y} @ ${cfg.input_shaper.shaper_freq_y}Hz` : null,
      };
    }

    // File metadata contains slicer settings (layer height, filament type, etc.)
    let fileMeta = null;
    const filename = status.print_stats?.filename;
    if (filename) {
      try {
        const metaRes = await fetch(`${base}/server/files/metadata?filename=${encodeURIComponent(filename)}`, {
          signal: AbortSignal.timeout(3000),
        });
        if (metaRes.ok) fileMeta = (await metaRes.json()).result;
      } catch { /* metadata not available */ }
    }

    const fan = status['output_pin fan0'];
    const chamber = status['heater_generic hot'];
    const filSensor = status['filament_switch_sensor fila'];

    const ctx = {
      print_state: status.print_stats?.state,
      filename,
      progress_pct: status.display_status?.progress != null ? Math.round(status.display_status.progress * 100) : null,
      print_duration_min: status.print_stats?.print_duration ? Math.round(status.print_stats.print_duration / 60) : null,
      print_duration_sec: status.print_stats?.print_duration ?? null,
      filament_used_mm: status.print_stats?.filament_used ? Math.round(status.print_stats.filament_used) : null,
      nozzle_temp: status.extruder?.temperature != null ? +status.extruder.temperature.toFixed(1) : null,
      nozzle_target: status.extruder?.target,
      bed_temp: status.heater_bed?.temperature != null ? +status.heater_bed.temperature.toFixed(1) : null,
      bed_target: status.heater_bed?.target,
      chamber_temp: chamber?.temperature != null ? +chamber.temperature.toFixed(1) : null,
      chamber_target: chamber?.target,
      fan_pct: fan?.value != null ? Math.round(fan.value * 100) : null,
      speed_factor_pct: status.gcode_move?.speed_factor != null ? Math.round(status.gcode_move.speed_factor * 100) : null,
      flow_pct: status.gcode_move?.extrude_factor != null ? Math.round(status.gcode_move.extrude_factor * 100) : null,
      pressure_advance: status.extruder?.pressure_advance,
      z_mm: status.motion_report?.live_position?.[2] != null ? +status.motion_report.live_position[2].toFixed(3) : null,
      live_velocity: status.motion_report?.live_velocity != null ? +status.motion_report.live_velocity.toFixed(1) : null,
      filament_detected: filSensor?.filament_detected,
      layer_height: fileMeta?.layer_height,
      first_layer_height: fileMeta?.first_layer_height,
      filament_type: fileMeta?.filament_type?.[0] ?? fileMeta?.filament_name?.[0] ?? null,
      slicer: fileMeta?.slicer ? `${fileMeta.slicer}${fileMeta.slicer_version ? ' ' + fileMeta.slicer_version : ''}` : null,
      slicer_nozzle_temp: fileMeta?.first_layer_extr_temp ?? fileMeta?.nozzle_temperature_range_low ?? null,
      slicer_bed_temp: fileMeta?.first_layer_bed_temp ?? null,
      estimated_total_sec: fileMeta?.estimated_time ?? null,
      printer_config: printerCfg,
    };

    // Time remaining: prefer slicer estimate adjusted by progress; fall back to elapsed-based projection.
    // Adjust for speed factor override — the slicer estimate assumes 100% speed.
    const progress = status.display_status?.progress;
    const elapsed = ctx.print_duration_sec;
    const speedRatio = (ctx.speed_factor_pct ?? 100) / 100;
    if (progress != null && progress > 0.01 && elapsed != null) {
      if (ctx.estimated_total_sec) {
        const rawRemaining = ctx.estimated_total_sec * (1 - progress);
        ctx.time_remaining_sec = Math.max(0, Math.round(rawRemaining / speedRatio));
      } else {
        ctx.time_remaining_sec = Math.max(0, Math.round((elapsed / progress) - elapsed));
      }
    } else {
      ctx.time_remaining_sec = null;
    }

    ctx.material_profile = lookupMaterial(ctx.filament_type);
    ctx.deviations = checkDeviations(ctx, ctx.material_profile);

    return ctx;
  } catch {
    return null;
  }
}

export function formatContextForPrompt(ctx) {
  if (!ctx) return '';
  const lines = ['--- Printer Context ---'];

  if (ctx.print_state) lines.push(`State: ${ctx.print_state}`);
  if (ctx.filename) lines.push(`File: ${ctx.filename}`);
  if (ctx.progress_pct != null) lines.push(`Progress: ${ctx.progress_pct}%`);
  if (ctx.print_duration_min != null) lines.push(`Duration: ${ctx.print_duration_min} min`);
  if (ctx.filament_used_mm != null) lines.push(`Filament used: ${ctx.filament_used_mm}mm`);

  lines.push('');
  lines.push('Temperatures:');
  if (ctx.nozzle_temp != null) lines.push(`  Nozzle: ${ctx.nozzle_temp}°C → target ${ctx.nozzle_target}°C`);
  if (ctx.bed_temp != null) lines.push(`  Bed: ${ctx.bed_temp}°C → target ${ctx.bed_target}°C`);
  if (ctx.chamber_temp != null) lines.push(`  Chamber: ${ctx.chamber_temp}°C → target ${ctx.chamber_target}°C`);

  lines.push('');
  lines.push('Active settings:');
  if (ctx.fan_pct != null) lines.push(`  Part cooling fan: ${ctx.fan_pct}%`);
  if (ctx.speed_factor_pct != null && ctx.speed_factor_pct !== 100) lines.push(`  Speed override: ${ctx.speed_factor_pct}%`);
  if (ctx.flow_pct != null && ctx.flow_pct !== 100) lines.push(`  Flow override: ${ctx.flow_pct}%`);
  if (ctx.pressure_advance != null) lines.push(`  Pressure advance: ${ctx.pressure_advance}`);
  if (ctx.z_mm != null) lines.push(`  Z height: ${ctx.z_mm}mm`);

  if (ctx.layer_height) lines.push(`  Layer height: ${ctx.layer_height}mm`);
  if (ctx.first_layer_height) lines.push(`  First layer height: ${ctx.first_layer_height}mm`);
  if (ctx.filament_type) lines.push(`  Filament type: ${ctx.filament_type}`);
  if (ctx.slicer) lines.push(`  Slicer: ${ctx.slicer}`);
  if (ctx.slicer_nozzle_temp) lines.push(`  Slicer nozzle target: ${ctx.slicer_nozzle_temp}°C`);
  if (ctx.slicer_bed_temp) lines.push(`  Slicer bed target: ${ctx.slicer_bed_temp}°C`);

  if (ctx.printer_config) {
    const pc = ctx.printer_config;
    lines.push('');
    lines.push('Printer config:');
    if (pc.nozzle_diameter) lines.push(`  Nozzle: ${pc.nozzle_diameter}mm`);
    if (pc.max_velocity) lines.push(`  Max velocity: ${pc.max_velocity}mm/s`);
    if (pc.max_accel) lines.push(`  Max accel: ${pc.max_accel}mm/s²`);
    if (pc.kinematics) lines.push(`  Kinematics: ${pc.kinematics}`);
    if (pc.input_shaper_x) lines.push(`  Input shaper X: ${pc.input_shaper_x}`);
    if (pc.input_shaper_y) lines.push(`  Input shaper Y: ${pc.input_shaper_y}`);
  }

  if (ctx.material_profile) {
    const mp = ctx.material_profile;
    lines.push('');
    lines.push(`QIDI recommended ranges for ${ctx.filament_type}:`);
    lines.push(`  Nozzle: ${mp.nozzle.min}–${mp.nozzle.max}°C`);
    lines.push(`  Bed: ${mp.bed.min}–${mp.bed.max}°C`);
    lines.push(`  Cooling: ${mp.cooling} | Max speed: ${mp.speed_max}mm/s`);
    lines.push(`  Note: ${mp.notes}`);
  }

  if (ctx.deviations?.length) {
    lines.push('');
    lines.push('SETTING DEVIATIONS FROM QIDI RECOMMENDATIONS:');
    for (const w of ctx.deviations) lines.push(`  ⚠ ${w}`);
  }

  if (ctx.filament_detected === false) {
    lines.push('');
    lines.push('WARNING: Filament runout sensor reports no filament!');
  }

  lines.push('--- End Printer Context ---');
  return lines.join('\n');
}
