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
  macroZoneMapLog,
  resetAllModeFonctionnement,
  startRegulationLoop,
  MacroZoneMap,
} from './regulation';
import {
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

  // Schedule Mode Fonctionnement reset at 12h, 19h, and 22h (must be set up before entering the perpetual loop).
  const resetCron = new CronJob('0 12,19,22 * * *', async () => {
    logger.regulation(`\n[CRON ${new Date().toLocaleTimeString()}] Resetting all Mode Fonctionnement to false...`);
    await resetAllModeFonctionnement(macroZoneMap);
  });
  resetCron.start();
  logger.regulation('\nCron scheduled: Mode Fonctionnement reset at 12:00, 19:00, 22:00');

  logger.regulation('\n========== Starting Luminosity Regulation ==========');
  await startRegulationLoop(macroZoneMap, STEP_INTERVAL_MS);
}
Main();
