/*
 * Copyright 2021 SpinalCom - www.spinalcom.com
 *
 * This file is part of SpinalCore.
 *
 * Please read all of the following terms and conditions
 * of the Free Software license Agreement ("Agreement")
 * carefully.
 *
 * This Agreement is a legally binding contract between
 * the Licensee (as defined below) and SpinalCom that
 * sets forth the terms and conditions that govern your
 * use of the Program. By installing and/or using the
 * Program, you agree to abide by all the terms and
 * conditions stated or referenced herein.
 *
 * If you do not agree to abide by these terms and
 * conditions, do not demonstrate your acceptance and do
 * not install or use the Program.
 * You should have received a copy of the license along
 * with this file. If not, see
 * <http://resources.spinalcom.com/licenses.pdf>.
 */

import {
  spinalCore,
  FileSystem,
  Model,
} from 'spinal-core-connectorjs';
import {
  SpinalGraphService,
  SpinalContext,
  SpinalNode,
} from 'spinal-env-viewer-graph-service';

import { CronJob } from 'cron';

import { logger } from './logger';
import {
  calculateTargetPercent,
  macroZoneMapLog,
  MacroZoneMap,
} from './regulation';
import {
  getEndpointCurrentValue,
  setEndpointCurrentValue,
  getMacroZoneModeFonctionnementNode,
  getMicroZoneValueNode,
  getMulticapteurLuminosityEndpoint,
} from './endpointHelpers';

require('dotenv').config();


class SpinalMain {
  hubConnection!: FileSystem;

  hwCtxtMulticapteurs!: SpinalContext<any>;
  hwCtxtZones!: SpinalContext<any>;
  hwCtxtPositionsDeTravail!: SpinalContext<any>;

  constructor() { }

  public init() {
    logger.regulation('Init connection to HUB...');
    const host = process.env.SPINALHUB_PORT
      ? `${process.env.SPINALHUB_IP}:${process.env.SPINALHUB_PORT}`
      : process.env.SPINALHUB_IP;
    const url = `${process.env.SPINALHUB_PROTOCOL}://${process.env.USER_ID}:${process.env.USER_PASSWORD}@${host}/`;
    logger.regulation(`URL: ${url}`);
    logger.regulation(`Connecting to ${url}`);
    const conn = spinalCore.connect(url);
    this.hubConnection = conn;

    return new Promise((resolve, reject) => {
      spinalCore.load(
        conn,
        process.env.DIGITALTWIN_PATH!,
        async (graph: any) => {
          await SpinalGraphService.setGraph(graph);
          logger.regulation('HUB connection established.');
          resolve(graph);
        },
        () => {
          logger.warning('Connection failed! Please check your config file and the state of the hub.');
          reject();
        }
      );
    });
  }

  async load<T extends Model>(server_id: number): Promise<T> {
    if (!server_id) {
      return Promise.reject('Invalid serverId');
    }
    if (typeof FileSystem._objects[server_id] !== 'undefined') {
      // @ts-ignore
      return Promise.resolve(FileSystem._objects[server_id]);
    }
    try {
      return await this.hubConnection.load_ptr(server_id);
    } catch (error) {
      throw new Error(`Error loading model with server_id: ${server_id}`);
    }
  }

  public async initJob(): Promise<MacroZoneMap | undefined> {
    const graph = SpinalGraphService.getGraph();
    const contexts = await graph.getChildren('hasContext');

    this.hwCtxtMulticapteurs = contexts.find(
      (ctx) => ctx.getName().get() === process.env.HARDWARE_CONTEXT_MULTICAPTEURS_NAME
    ) as SpinalContext<any>;
    this.hwCtxtZones = contexts.find(
      (ctx) => ctx.getName().get() === process.env.HARDWARE_CONTEXT_ZONES_NAME
    ) as SpinalContext<any>;
    this.hwCtxtPositionsDeTravail = contexts.find(
      (ctx) => ctx.getName().get() === process.env.HARDWARE_CONTEXT_POSITIONS_DE_TRAVAIL_NAME
    ) as SpinalContext<any>;

    if (!this.hwCtxtMulticapteurs) {
      logger.warning(`Hardware context for multicapteurs not found. Expected name: ${process.env.HARDWARE_CONTEXT_MULTICAPTEURS_NAME}`);
    }
    if (!this.hwCtxtZones) {
      logger.warning(`Hardware context for zones not found. Expected name: ${process.env.HARDWARE_CONTEXT_ZONES_NAME}`);
      return;
    }
    if (!this.hwCtxtPositionsDeTravail) {
      logger.warning(`Hardware context for positions de travail not found. Expected name: ${process.env.HARDWARE_CONTEXT_POSITIONS_DE_TRAVAIL_NAME}`);
      return;
    }

    const hwCtxtZones_levels = await this.hwCtxtZones.getChildrenInContext(this.hwCtxtZones);
    const hwCtxtMulticapteurs_levels = await this.hwCtxtMulticapteurs.getChildrenInContext(this.hwCtxtMulticapteurs);

    // Build lookup: macroZone name -> { regulationProfileType, luminosityEndpoints } by traversing
    // hwCtxtMulticapteurs: level -> "jour-1"/"jour-2" (profile type) -> macroZone -> multicapteur -> luminosity endpoint.
    const multicapteurInfoByMacroZoneName = new Map<string, {
      regulationProfileType: string;
      luminosityEndpoints: SpinalNode<any>[];
    }>();

    await Promise.all(hwCtxtMulticapteurs_levels.map(async (level: SpinalNode<any>) => {
      const profileNodes = await level.getChildrenInContext(this.hwCtxtMulticapteurs);
      await Promise.all(profileNodes.map(async (profileNode: SpinalNode<any>) => {
        const profileName = profileNode.getName().get();
        let regulationProfileType: string;
        if (profileName === 'jour-1') regulationProfileType = '1';
        else if (profileName === 'jour-2') regulationProfileType = '2';
        else {
          logger.warning(`Unknown profile node "${profileName}" under level "${level.getName().get()}" in hwCtxtMulticapteurs (expected "jour-1" or "jour-2"). Skipping.`);
          return;
        }

        const mcMacroZones = await profileNode.getChildrenInContext(this.hwCtxtMulticapteurs);
        await Promise.all(mcMacroZones.map(async (mcMacroZone: SpinalNode<any>) => {
          const mcMacroZoneName = mcMacroZone.getName().get();
          const multicapteurs = await mcMacroZone.getChildrenInContext(this.hwCtxtMulticapteurs);

          const luminosityEndpoints: SpinalNode<any>[] = [];
          await Promise.all(multicapteurs.map(async (multicapteur: SpinalNode<any>) => {
            const lumEndpoint = await getMulticapteurLuminosityEndpoint(multicapteur);
            if (!lumEndpoint) {
              logger.warning(`No "Mesure_lux" endpoint found for multicapteur ${multicapteur.getName().get()} (id: ${multicapteur._server_id}) under macroZone "${mcMacroZoneName}"`);
              return;
            }
            luminosityEndpoints.push(lumEndpoint);
          }));

          if (multicapteurInfoByMacroZoneName.has(mcMacroZoneName)) {
            logger.warning(`Duplicate macroZone "${mcMacroZoneName}" in hwCtxtMulticapteurs — overwriting previous entry.`);
          }
          multicapteurInfoByMacroZoneName.set(mcMacroZoneName, {
            regulationProfileType,
            luminosityEndpoints,
          });
        }));
      }));
    }));

    // Fetch gateways from all levels in parallel
    const gatewayArrays = await Promise.all(
      hwCtxtZones_levels.map(level => level.getChildrenInContext(this.hwCtxtZones))
    );
    const hwCtxtZones_gateways = gatewayArrays.flat();

    // Fetch macroZones from all gateways in parallel
    const macroZoneArrays = await Promise.all(
      hwCtxtZones_gateways.map(gateway => gateway.getChildrenInContext(this.hwCtxtZones))
    );
    const hwCtxtZones_macroZones = macroZoneArrays.flat();

    const macroZoneMap: MacroZoneMap = new Map();

    await Promise.all(hwCtxtZones_macroZones.map(async (macroZone: SpinalNode<any>) => {
      const [microZones, modeFonctionnement] = await Promise.all([
        macroZone.getChildrenInContext(this.hwCtxtZones),
        getMacroZoneModeFonctionnementNode(macroZone),
      ]);
      if (!modeFonctionnement) {
        logger.warning(`No "Mode fonctionnement" endpoint found for macroZone ${macroZone.getName().get()} (id: ${macroZone._server_id})`);
        return;
      }

      const macroZoneName = macroZone.getName().get();
      const mcInfo = multicapteurInfoByMacroZoneName.get(macroZoneName);
      if (!mcInfo) {
        logger.warning(`MacroZone "${macroZoneName}" not found in hwCtxtMulticapteurs. Keeping with empty luminosityEndpoints and undefined regulationProfileType.`);
      }

      // Fetch all microZone endpoints in parallel
      const microZoneEndpoints = new Map<SpinalNode<any>, SpinalNode<any>>();
      await Promise.all(microZones.map(async (microZone: SpinalNode<any>) => {
        const valueEndpoint = await getMicroZoneValueNode(microZone);
        if (!valueEndpoint) {
          logger.warning(`No "Value" endpoint found for microZone ${microZone.getName().get()} (id: ${microZone._server_id}) under macroZone ${macroZone.getName().get()}`);
          return;
        }
        microZoneEndpoints.set(microZone, valueEndpoint);
        // By the way, endpoints under microzones are shared between the different instances of the same microzone in different contexts :)
      }));

      macroZoneMap.set(macroZone, {
        modeFonctionnement,
        regulationProfileType: mcInfo?.regulationProfileType,
        luminosityEndpoints: mcInfo?.luminosityEndpoints ?? [],
        microZones: microZoneEndpoints,
      });
    }));

    return macroZoneMap;
  }


  /**
   * Gradually adjusts a microzone's luminosity toward a target value.
   * The value changes by at most 1% per step (1%/second).
   * Supports both increasing and decreasing.
   */
  public async regulateMicroZone(
    endpoint: SpinalNode<any>,
    microZoneName: string,
    targetPercent: number,
    stepIntervalMs: number
  ): Promise<void> {
    const rawValue = await getEndpointCurrentValue(endpoint);
    const currentValue = Number(rawValue);

    if (isNaN(currentValue)) {
      logger.warning(`  [${microZoneName}] [${endpoint.getName().get()} | ${endpoint._server_id}] Current value is not a number (${rawValue}). Skipping.`);
      return;
    }

    const diff = targetPercent - currentValue;

    if (Math.abs(diff) < 0.01) {
      logger.regulation(`  [${microZoneName}] [${endpoint.getName().get()} | ${endpoint._server_id}] Already at target (${currentValue}%). Skipping.`);
      return;
    }

    const direction = diff > 0 ? 1 : -1;
    const maxStepSize = stepIntervalMs / 1000; // 1% per second => e.g. 10% per 10s
    const totalSteps = Math.ceil(Math.abs(diff) / maxStepSize);

    logger.regulation(`  [${microZoneName}] [${endpoint.getName().get()} | ${endpoint._server_id}] Current: ${currentValue}% -> Target: ${targetPercent}% | ${totalSteps} steps of ${direction > 0 ? '+' : '-'}${maxStepSize}% every ${stepIntervalMs}ms`);

    return new Promise((resolve) => {
      let step = 0;
      const interval = setInterval(async () => {
        step++;
        const projected = currentValue + direction * maxStepSize * step;
        const newValue = Math.abs(targetPercent - projected) < maxStepSize
          ? targetPercent
          : Math.round(projected * 100) / 100;

        await setEndpointCurrentValue(endpoint, newValue);
        logger.regulation(`  [${microZoneName}] [${endpoint.getName().get()} | ${endpoint._server_id}] Step ${step}/${totalSteps} -> ${newValue}%`);

        if (step >= totalSteps) {
          clearInterval(interval);
          logger.regulation(`  [${microZoneName}] [${endpoint.getName().get()} | ${endpoint._server_id}] Reached target ${targetPercent}%`);
          resolve();
        }
      }, stepIntervalMs);
    });
  }


  /**
   * Regulates all microzones in a macroZoneMap toward a target luminosity.
   * All microzones ramp up in parallel.
   */
  public async regulateAllMicroZones(
    macroZoneMap: MacroZoneMap,
    stepIntervalMs: number
  ): Promise<void> {
    const promises: Promise<void>[] = [];
    const testMode = process.env.TEST_MODE === '1';

    for (const [macroZone, { modeFonctionnement, regulationProfileType, luminosityEndpoints, microZones }] of macroZoneMap) {
      if (!testMode) { // if test mode is enabled, ignore Mode Fonctionnement value and regulate all microzones to test the regulation process
        const modeFonctionnementValue = await getEndpointCurrentValue(modeFonctionnement);
        if (modeFonctionnementValue !== true) {
          logger.warning(`\nSkipping MacroZone: ${macroZone.getName().get()} - Mode Fonctionnement is not true (value: ${modeFonctionnementValue})`);
          continue;
        }
      }

      if (!regulationProfileType) {
        logger.warning(`\nSkipping MacroZone: ${macroZone.getName().get()} - no regulationProfileType (not found in hwCtxtMulticapteurs).`);
        continue;
      }

      if (luminosityEndpoints.length === 0) {
        logger.warning(`\nSkipping MacroZone: ${macroZone.getName().get()} - no luminosity endpoints available.`);
        continue;
      }

      // Compute average lux from the macrozone's multicapteur luminosity endpoints.
      const rawLuxValues = await Promise.all(luminosityEndpoints.map(ep => getEndpointCurrentValue(ep)));
      const numericLuxValues = rawLuxValues.map(v => Number(v)).filter(v => !isNaN(v));
      if (numericLuxValues.length === 0) {
        logger.warning(`\nSkipping MacroZone: ${macroZone.getName().get()} - no valid lux readings from ${luminosityEndpoints.length} sensor(s).`);
        continue;
      }
      const avgLux = numericLuxValues.reduce((a, b) => a + b, 0) / numericLuxValues.length;

      const targetPercent = calculateTargetPercent(avgLux, regulationProfileType);
      logger.regulation(`\nRegulating MacroZone: ${macroZone.getName().get()} (profile ${regulationProfileType}) | avg lux: ${avgLux.toFixed(1)} (${numericLuxValues.length}/${luminosityEndpoints.length} sensors) -> target: ${targetPercent.toFixed(1)}%`);
      for (const [microZone, endpoint] of microZones) {
        promises.push(
          this.regulateMicroZone(endpoint, microZone.getName().get(), targetPercent, stepIntervalMs)
        );
      }
    }

    await Promise.all(promises);
    logger.regulation('\nAll microzones regulation complete.');
  }


  /**
   * Sets all Mode Fonctionnement endpoints back to true.
   */
  public async resetAllModeFonctionnement(macroZoneMap: MacroZoneMap): Promise<void> {
    const promises: Promise<void>[] = [];

    for (const [macroZone, { modeFonctionnement }] of macroZoneMap) {
      promises.push(
        setEndpointCurrentValue(modeFonctionnement, true).then(() => {
          logger.regulation(`  [${macroZone.getName().get()}] Mode Fonctionnement reset to true`);
        })
      );
    }

    await Promise.all(promises);
    logger.regulation('\nAll Mode Fonctionnement endpoints reset to true.');
  }
}


const STEP_INTERVAL_MS = 10000;    // Step every 10s

async function Main() {
  const spinalMain = new SpinalMain();
  await spinalMain.init();

  const macroZoneMap = await spinalMain.initJob();
  if (!macroZoneMap) {
    logger.warning('Failed to initialize job: macroZoneMap is undefined.');
    return;
  }

  macroZoneMapLog(macroZoneMap);

  logger.regulation('\n========== Starting Luminosity Regulation ==========');
  logger.regulation(`Step interval: ${STEP_INTERVAL_MS}ms (max 1%/s) | Lux computed per-macrozone from multicapteurs\n`);

  await spinalMain.regulateAllMicroZones(macroZoneMap, STEP_INTERVAL_MS);

  // Schedule Mode Fonctionnement reset at 12h, 19h, and 22h
  const resetCron = new CronJob('0 12,19,22 * * *', async () => {
    logger.regulation(`\n[CRON ${new Date().toLocaleTimeString()}] Resetting all Mode Fonctionnement to true...`);
    await spinalMain.resetAllModeFonctionnement(macroZoneMap);
  });
  resetCron.start();
  logger.regulation('\nCron scheduled: Mode Fonctionnement reset at 12:00, 19:00, 22:00');
}
Main();
