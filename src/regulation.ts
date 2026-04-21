import { SpinalNode } from 'spinal-env-viewer-graph-service';
import { logger } from './logger';

export type MacroZoneEntry = {
  modeFonctionnement: SpinalNode<any>;
  regulationProfileType: string | undefined;
  luminosityEndpoints: SpinalNode<any>[];
  microZones: Map<SpinalNode<any>, SpinalNode<any>>;
};

export type MacroZoneMap = Map<SpinalNode<any>, MacroZoneEntry>;

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
  if (profileType === '1') {
    if (lux < 100) return 70;
    if (lux <= 1500) return -0.0357 * lux + 73.57;
    return 0;
  }
  if (profileType === '2') {
    if (lux < 100) return 70;
    if (lux <= 700) return -0.0833 * lux + 78.33;
    if (lux <= 1500) return 20;
    return 0;
  }
  logger.warning(`Unknown regulation profile type: ${profileType}, defaulting to profile 1`);
  return calculateTargetPercent(lux, '1');
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
    for (const [microZone, endpoint] of microZones) {
      logger.map(`      ├─ ${microZone.getName().get()} -> endpoint: ${endpoint.getName().get()} | ${endpoint._server_id}`);
    }
    logger.map('');
  }
  logger.map(`Total: ${macroZoneMap.size} macrozones`);
}
