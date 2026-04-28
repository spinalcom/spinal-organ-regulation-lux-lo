import { SpinalNode } from 'spinal-env-viewer-graph-service';
import { SpinalAttribute } from 'spinal-models-documentation';
import { logger } from './logger';
import { getEndpointCurrentValue, setEndpointCurrentValue } from './endpointHelpers';

export type MicroZoneInfo = {
  valueEndpoint: SpinalNode<any>;
  modeAttribute: SpinalAttribute;
};

export type MacroZoneEntry = {
  modeFonctionnement: SpinalNode<any>;
  regulationProfileType: string | undefined;
  luminosityEndpoints: SpinalNode<any>[];
  microZones: Map<SpinalNode<any>, MicroZoneInfo>;
};

export type MacroZoneMap = Map<SpinalNode<any>, MacroZoneEntry>;

const LUX_UPDATE_THRESHOLD = 50;       // Retarget when avg lux moves more than this vs the lux that drove the last retarget.
const MAX_RAMP_PERCENT_PER_SECOND = 1; // Cap on ramp speed (applies to each microzone).

type MicroZoneRamp = { targetPercent: number };

type MacroZoneRegulationState = {
  lastAppliedAvgLux: number | null;
  microZoneTargets: Map<SpinalNode<any>, MicroZoneRamp>;
};

/**
 * Calculates target luminosity % from lux value and regulation profile type.
 *
 * Profile 1:
 *   L < 100          => P = 70%
 *   100 <= L <= 1500 => P = -0.0357 * L + 73.57
 *   L > 1500         => P = 0%
 *
 * Profile 2:
 *   L < 100          => P = 70%
 *   100 <= L <= 700  => P = -0.0833 * L + 78.33
 *   700 < L <= 1500  => P = 20%
 *   L > 1500         => P = 0%
 */
export function calculateTargetPercent(lux: number, profileType: string): number {
  let result: number;
  if (profileType === '1') {
    if (lux < 100) result = 70;
    else if (lux <= 1500) result = -0.0357 * lux + 73.57;
    else result = 0;
  } else if (profileType === '2') {
    if (lux < 100) result = 70;
    else if (lux <= 700) result = -0.0833 * lux + 78.33;
    else if (lux <= 1500) result = 20;
    else result = 0;
  } else {
    logger.warning(`Unknown regulation profile type: ${profileType}, defaulting to profile 1`);
    return calculateTargetPercent(lux, '1');
  }
  return Math.round(result * 100) / 100;
}

export function macroZoneMapLog(macroZoneMap: MacroZoneMap) {
  logger.map('\n========== MacroZone Map ==========\n');
  for (const [macroZone, { modeFonctionnement, regulationProfileType, luminosityEndpoints, microZones }] of macroZoneMap) {
    logger.map(`MacroZone: ${macroZone.getName().get()}`);
    logger.map(`  └─ Mode Fonctionnement: ${modeFonctionnement.getName().get()}`);
    logger.map(`  └─ Regulation Profile Type: ${regulationProfileType ?? '(unknown)'}`);
    logger.map(`  └─ Luminosity Endpoints (${luminosityEndpoints.length}):`);
    for (const ep of luminosityEndpoints) {
      logger.map(`      ├─ ${ep.getName().get()} | ${ep._server_id}`);
    }
    logger.map(`  └─ MicroZones (${microZones.size}):`);
    for (const [microZone, { valueEndpoint, modeAttribute }] of microZones) {
      logger.map(`      ├─ ${microZone.getName().get()} -> endpoint: ${valueEndpoint.getName().get()} | ${valueEndpoint._server_id} | mode=${modeAttribute.value.get()}`);
    }
    logger.map('');
  }
  logger.map(`Total: ${macroZoneMap.size} macrozones`);
}

export async function resetAllModeFonctionnement(macroZoneMap: MacroZoneMap): Promise<void> {
  const promises: Promise<void>[] = [];
  for (const [macroZone, { modeFonctionnement }] of macroZoneMap) {
    promises.push(
      setEndpointCurrentValue(modeFonctionnement, false).then(() => {
        logger.regulation(`  [${macroZone.getName().get()}] Mode Fonctionnement reset to false`);
      })
    );
  }
  await Promise.all(promises);
  logger.regulation('\nAll Mode Fonctionnement endpoints reset to false.');
}

/**
 * Perpetual regulation loop.
 *
 * Every stepIntervalMs, for each macrozone:
 *  - Re-read Mode Fonctionnement (unless TEST_MODE=1); skip if not `true`.
 *  - Recompute average lux from its multicapteur sensors.
 *  - If |new_avg - last_applied_avg| > LUX_UPDATE_THRESHOLD (or first ever), compute a new target %
 *    and (re)set the ramp target for every microzone (interrupts any in-flight ramp).
 *  - Advance each active ramp by at most (stepIntervalMs/1000 * MAX_RAMP_PERCENT_PER_SECOND)%
 *    toward its target. Drop the ramp once it reaches target.
 *
 * Never resolves.
 */
export async function startRegulationLoop(macroZoneMap: MacroZoneMap, stepIntervalMs: number): Promise<never> {
  const states = new Map<SpinalNode<any>, MacroZoneRegulationState>();
  for (const macroZone of macroZoneMap.keys()) {
    states.set(macroZone, { lastAppliedAvgLux: null, microZoneTargets: new Map() });
  }

  logger.regulation(`\nStarting regulation loop: tick every ${stepIntervalMs}ms | lux retarget threshold: ${LUX_UPDATE_THRESHOLD} | max ramp: ${MAX_RAMP_PERCENT_PER_SECOND}%/s`);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const t0 = Date.now();
    try {
      await regulationTick(macroZoneMap, states, stepIntervalMs);
    } catch (err) {
      const msg = err instanceof Error ? (err.stack ?? err.message) : String(err);
      logger.warning(`Regulation tick error: ${msg}`);
    }
    const elapsed = Date.now() - t0;
    const waitMs = Math.max(0, stepIntervalMs - elapsed);
    await sleep(waitMs);
  }
}

async function regulationTick(
  macroZoneMap: MacroZoneMap,
  states: Map<SpinalNode<any>, MacroZoneRegulationState>,
  stepIntervalMs: number
): Promise<void> {
  const testMode = process.env.TEST_MODE === '1';
  const maxStepSize = (stepIntervalMs / 1000) * MAX_RAMP_PERCENT_PER_SECOND;

  for (const [macroZone, entry] of macroZoneMap) {
    const state = states.get(macroZone)!;
    const macroZoneTag = `${macroZone.getName().get()} | mz ${macroZone._server_id}`;

    // 1. Mode Fonctionnement gate — re-read every tick so toggles take effect on the next one.
    // Some endpoints store the flag as boolean (true/false), others as numeric (1/0); accept both.
    if (!testMode) {
      const mfValue = await getEndpointCurrentValue(entry.modeFonctionnement);
      const mfOn = mfValue === true || mfValue === 1;
      if (!mfOn) continue;
    }

    // 2. Skip macrozones that can't be regulated (warned at init).
    if (!entry.regulationProfileType || entry.luminosityEndpoints.length === 0) continue;

    // 3. Recompute average lux from sensors.
    const rawLux = await Promise.all(entry.luminosityEndpoints.map(ep => getEndpointCurrentValue(ep)));
    const numericLux = rawLux.map(v => Number(v)).filter(v => !isNaN(v));
    if (numericLux.length === 0) continue;
    const avgLux = numericLux.reduce((a, b) => a + b, 0) / numericLux.length;

    // 4. Retarget if lux moved beyond threshold since the last applied retarget (or first ever).
    const isFirst = state.lastAppliedAvgLux === null;
    const luxMoved = !isFirst && Math.abs(avgLux - state.lastAppliedAvgLux!) > LUX_UPDATE_THRESHOLD;
    if (isFirst || luxMoved) {
      const newTarget = calculateTargetPercent(avgLux, entry.regulationProfileType);
      const prev = state.lastAppliedAvgLux === null ? 'n/a' : state.lastAppliedAvgLux.toFixed(1);
      logger.regulation(`\n[${macroZoneTag}] avg lux: ${avgLux.toFixed(1)} (prev ${prev}) | profile ${entry.regulationProfileType} -> target ${newTarget}%`);
      state.lastAppliedAvgLux = avgLux;
      for (const microZone of entry.microZones.keys()) {
        state.microZoneTargets.set(microZone, { targetPercent: newTarget });
      }
    }

    // 5. Advance active ramps by one step (≤ 1%/s cap).
    if (state.microZoneTargets.size === 0) continue;
    await Promise.all([...state.microZoneTargets].map(async ([microZone, ramp]) => {
      const info = entry.microZones.get(microZone);
      if (!info) {
        state.microZoneTargets.delete(microZone);
        return;
      }
      // Per-microzone mode gate: only regulate when mode === 'auto' (unless TEST_MODE=1).
      // We preserve the ramp target so manual→auto resumes from the latest target on the next tick.
      if (!testMode && info.modeAttribute.value.get() !== 'auto') return;

      const microZoneTag = `[${macroZoneTag}] [${microZone.getName().get()} | mz ${microZone._server_id} | ep ${info.valueEndpoint._server_id}]`;
      const current = Number(await getEndpointCurrentValue(info.valueEndpoint));
      if (isNaN(current)) {
        logger.warning(`  ${microZoneTag} current value not numeric; dropping from ramp.`);
        state.microZoneTargets.delete(microZone);
        return;
      }
      const diff = ramp.targetPercent - current;
      if (Math.abs(diff) < 0.01) {
        logger.regulation(`  ${microZoneTag} reached target ${ramp.targetPercent}%`);
        state.microZoneTargets.delete(microZone);
        return;
      }
      const direction = diff > 0 ? 1 : -1;
      const newValue = Math.abs(diff) <= maxStepSize
        ? ramp.targetPercent
        : Math.round((current + direction * maxStepSize) * 100) / 100;
      await setEndpointCurrentValue(info.valueEndpoint, newValue);
      logger.regulation(`  ${microZoneTag} ${current}% -> ${newValue}% (target ${ramp.targetPercent}%)`);
    }));
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
