// Material baselines from qidislicer.com, for QIDI X-Plus 3 (direct drive, 0.4mm nozzle)
export const MATERIAL_PROFILES = {
  PLA: {
    nozzle: { min: 200, max: 210 },
    bed: { min: 55, max: 65 },
    cooling: 'high',        // ~100%
    speed_max: 120,
    notes: 'Easy & stable. Great for models and fixtures.',
  },
  PETG: {
    nozzle: { min: 230, max: 245 },
    bed: { min: 70, max: 85 },
    cooling: 'medium',      // ~50%
    speed_max: 100,
    notes: 'Tough and slightly flexible. Dry well to reduce stringing.',
  },
  ABS: {
    nozzle: { min: 235, max: 255 },
    bed: { min: 90, max: 110 },
    cooling: 'low',         // ~0–20%
    speed_max: 100,
    notes: 'Needs enclosure; strong and heat-resistant; watch for warping.',
  },
  ASA: {
    nozzle: { min: 235, max: 255 },
    bed: { min: 90, max: 110 },
    cooling: 'low',
    speed_max: 100,
    notes: 'Needs enclosure; strong and heat-resistant; watch for warping.',
  },
  TPU: {
    nozzle: { min: 210, max: 225 },
    bed: { min: 40, max: 55 },
    cooling: 'low',
    speed_max: 35,
    notes: 'Slow speeds (20–35 mm/s), minimal retraction; ensure clean filament path.',
  },
};

// Layer height recommendations (for 0.4mm nozzle)
export const LAYER_PROFILES = {
  fine:    { min: 0.12, max: 0.16 },
  standard:{ min: 0.18, max: 0.22 },
  draft:   { min: 0.24, max: 0.28 },
};

// Retraction (direct drive)
export const RETRACTION = { distance_mm: { min: 0.8, max: 1.2 }, speed_mms: { min: 25, max: 35 } };

export function lookupMaterial(filamentType) {
  if (!filamentType) return null;
  const key = filamentType.toUpperCase().split(/[\s_-]/)[0]; // "PLA+" → "PLA"
  return MATERIAL_PROFILES[key] || null;
}

export function checkDeviations(ctx, profile) {
  if (!profile) return [];
  const warnings = [];

  const nozzle = ctx.nozzle_temp;
  const bed = ctx.bed_temp;
  const fan = ctx.fan_pct;

  if (nozzle != null && ctx.nozzle_target > 0) {
    if (nozzle < profile.nozzle.min - 5) warnings.push(`Nozzle ${nozzle}°C is below recommended ${profile.nozzle.min}–${profile.nozzle.max}°C range`);
    if (nozzle > profile.nozzle.max + 5) warnings.push(`Nozzle ${nozzle}°C is above recommended ${profile.nozzle.min}–${profile.nozzle.max}°C range`);
  }
  if (bed != null && ctx.bed_target > 0) {
    if (bed < profile.bed.min - 5) warnings.push(`Bed ${bed}°C is below recommended ${profile.bed.min}–${profile.bed.max}°C range`);
    if (bed > profile.bed.max + 5) warnings.push(`Bed ${bed}°C is above recommended ${profile.bed.min}–${profile.bed.max}°C range`);
  }
  if (fan != null && ctx.nozzle_target > 0) {
    if (profile.cooling === 'high' && fan < 50) warnings.push(`Fan at ${fan}% — ${ctx.filament_type || 'this material'} needs high cooling (recommended ~100%)`);
    if (profile.cooling === 'low' && fan > 30) warnings.push(`Fan at ${fan}% — ${ctx.filament_type || 'this material'} needs low cooling (recommended <20%)`);
  }

  return warnings;
}
