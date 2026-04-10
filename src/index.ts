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
  Process,
  spinalCore,
  FileSystem,
  Model,
  BindProcess,
} from 'spinal-core-connectorjs';
import {
  SpinalGraphService,
  SpinalContext,
  SpinalNodeRef,
  SpinalNode
} from 'spinal-env-viewer-graph-service';

import { SpinalAttribute } from 'spinal-models-documentation';
import { serviceDocumentation } from 'spinal-env-viewer-plugin-documentation-service';
import { CronJob } from 'cron';



require('dotenv').config();


class SpinalMain {


  hubConnection: FileSystem;



  hwCtxtMulticapteurs: SpinalContext<any>;
  hwCtxtZones: SpinalContext<any>;
  hwCtxtPositionsDeTravail: SpinalContext<any>;




  constructor() { }

  public init() {

    console.log('Done.');
    console.log('Init connection to HUB...');
    const host = process.env.SPINALHUB_PORT
      ? `${process.env.SPINALHUB_IP}:${process.env.SPINALHUB_PORT}`
      : process.env.SPINALHUB_IP;
    const url = `${process.env.SPINALHUB_PROTOCOL}://${process.env.USER_ID}:${process.env.USER_PASSWORD}@${host}/`;
    console.log('URL:', url);
    console.log('Connecting to', url);
    const conn = spinalCore.connect(url);
    this.hubConnection = conn;

    return new Promise((resolve, reject) => {
      spinalCore.load(
        conn,
        process.env.DIGITALTWIN_PATH,
        async (graph: any) => {
          await SpinalGraphService.setGraph(graph);
          console.log('Done.');
          resolve(graph);
        },
        () => {
          console.log(
            'Connection failed ! Please check your config file and the state of the hub.'
          );
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


  public async initJob() {
    const graph = SpinalGraphService.getGraph();
    const contexts = await graph.getChildren('hasContext');

    this.hwCtxtMulticapteurs = contexts.find(
      (ctx) => ctx.getName().get() === process.env.HARDWARE_CONTEXT_MULTICAPTEURS_NAME
    );
    this.hwCtxtZones = contexts.find(
      (ctx) => ctx.getName().get() === process.env.HARDWARE_CONTEXT_ZONES_NAME
    );
    this.hwCtxtPositionsDeTravail = contexts.find(
      (ctx) => ctx.getName().get() === process.env.HARDWARE_CONTEXT_POSITIONS_DE_TRAVAIL_NAME
    );

    if (!this.hwCtxtMulticapteurs) {
      console.error(`Hardware context for multicapteurs not found. Expected name: ${process.env.HARDWARE_CONTEXT_MULTICAPTEURS_NAME}`);
      // return;
    }
    if (!this.hwCtxtZones) {
      console.error(`Hardware context for zones not found. Expected name: ${process.env.HARDWARE_CONTEXT_ZONES_NAME}`);
      return;
    }
    if (!this.hwCtxtPositionsDeTravail) {
      console.error(`Hardware context for positions de travail not found. Expected name: ${process.env.HARDWARE_CONTEXT_POSITIONS_DE_TRAVAIL_NAME}`);
      return;
    }


    const hwCtxtZones_levels = await this.hwCtxtZones.getChildrenInContext(this.hwCtxtZones);

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

    // Map: macroZone -> { modeFonctionnement endpoint, regulationProfileType, Map: microZone -> microZone endpoint }
    const macroZoneMap = new Map<SpinalNode<any>, {
      modeFonctionnement: SpinalNode<any>;
      regulationProfileType: string;
      microZones: Map<SpinalNode<any>, SpinalNode<any>>;
    }>();

    // Process all macroZones in parallel
    await Promise.all(hwCtxtZones_macroZones.map(async (macroZone) => {
      const [microZones, modeFonctionnement, regulationProfileType] = await Promise.all([
        macroZone.getChildrenInContext(this.hwCtxtZones),
        this.getMacroZoneModeFonctionnementNode(macroZone),
        this.getMacroZoneRegulationProfileType(macroZone),
      ]);
      if (!modeFonctionnement || !regulationProfileType) {
        console.warn(`No "Mode fonctionnement" endpoint or regulationProfileType found  for macroZone ${macroZone.getName().get()} (id: ${macroZone._server_id})`);
        return;
      }

      // Fetch all microZone endpoints in parallel
      const microZoneEndpoints = new Map<SpinalNode<any>, SpinalNode<any>>();
      await Promise.all(microZones.map(async (microZone) => {
        const valueEndpoint = await this.getMicroZoneValueNode(microZone);
        if (!valueEndpoint) {
          console.warn(`No "Value" endpoint found for microZone ${microZone.getName().get()} (id: ${microZone._server_id}) under macroZone ${macroZone.getName().get()}`);
          return;
        }
        microZoneEndpoints.set(microZone, valueEndpoint);
        // By the way , endpoints under microzones are shared between the different instances of the same microzone in different contexts :)
      }));

      macroZoneMap.set(macroZone, {
        modeFonctionnement,
        regulationProfileType,
        microZones: microZoneEndpoints,
      });
    }));

    return macroZoneMap;
  }


  private async getMacroZoneModeFonctionnementNode(macroZone: SpinalNode<any>): Promise<SpinalNode<any> | undefined> {
    const firstLevelEndpoints = await macroZone.getChildren('hasBmsEndpoint');
    const firstEndpointLevel = firstLevelEndpoints.find(ep => ep.getName().get() === macroZone.getName().get());
    if (!firstEndpointLevel) {
      return undefined;
    }

    const secondLevelEndpoints = await firstEndpointLevel.getChildren('hasBmsEndpoint');
    const modeFonctionnement = secondLevelEndpoints.find(ep => ep.getName().get() === 'Mode fonctionnement');
    return modeFonctionnement || undefined;
  }

  private async getMacroZoneRegulationProfileType(macroZone: SpinalNode<any>): Promise<string> {
    let regulationProfileType = undefined;
    const attr = await serviceDocumentation.findOneAttributeInCategory(
      macroZone,
      'default',
      'RegulationProfileType'
    );
    if (attr !== -1) {
      regulationProfileType = attr.value.get();
      return regulationProfileType;
    }
    else {
      return Math.random() < 0.5 ? '1' : '2'; // Default to random if not found
    }
  }


  private async getMicroZoneValueNode(microZone: SpinalNode<any>): Promise<SpinalNode<any> | undefined> {
    const firstLevelEndpoints = await microZone.getChildren('hasBmsEndpoint');
    const firstEndpointLevel = firstLevelEndpoints.find(ep => ep.getName().get() === microZone.getName().get());
    if (!firstEndpointLevel) {
      return undefined;
    }

    const secondLevelEndpoints = await firstEndpointLevel.getChildren('hasBmsEndpoint');
    const valueEndpoint = secondLevelEndpoints.find(ep => ep.getName().get() === 'Value');
    return valueEndpoint || undefined;
  }


  private async setEndpointCurrentValue(endpoint: SpinalNode<any>, value: any) {
    const element = await endpoint.element.load();
    const currentValue = element.currentValue;
    currentValue.set(value);
  }

  private async getEndpointCurrentValue(endpoint: SpinalNode<any>): Promise<any> {
    const element = await endpoint.element.load();
    return element.currentValue.get();
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
    const rawValue = await this.getEndpointCurrentValue(endpoint);
    const currentValue = Number(rawValue);

    if (isNaN(currentValue)) {
      console.warn(`  [${microZoneName}] [${endpoint.getName().get()} | ${endpoint._server_id}] Current value is not a number (${rawValue}). Skipping.`);
      return;
    }

    const diff = targetPercent - currentValue;

    if (Math.abs(diff) < 0.01) {
      console.log(`  [${microZoneName}] [${endpoint.getName().get()} | ${endpoint._server_id}] Already at target (${currentValue}%). Skipping.`);
      return;
    }

    const direction = diff > 0 ? 1 : -1;
    const totalSteps = Math.ceil(Math.abs(diff));

    console.log(`  [${microZoneName}] [${endpoint.getName().get()} | ${endpoint._server_id}] Current: ${currentValue}% -> Target: ${targetPercent}% | ${totalSteps} steps of ${direction > 0 ? '+' : '-'}1% every ${stepIntervalMs}ms`);

    return new Promise((resolve) => {
      let step = 0;
      const interval = setInterval(async () => {
        step++;
        const remaining = Math.abs(targetPercent - (currentValue + direction * step));
        const newValue = remaining < 1
          ? targetPercent
          : Math.round((currentValue + direction * step) * 100) / 100;

        await this.setEndpointCurrentValue(endpoint, newValue);
        console.log(`  [${microZoneName}] [${endpoint.getName().get()} | ${endpoint._server_id}] Step ${step}/${totalSteps} -> ${newValue}%`);

        if (step >= totalSteps) {
          clearInterval(interval);
          console.log(`  [${microZoneName}] [${endpoint.getName().get()} | ${endpoint._server_id}] Reached target ${targetPercent}%`);
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
    macroZoneMap: Map<SpinalNode<any>, {
      modeFonctionnement: SpinalNode<any>;
      regulationProfileType: string;
      microZones: Map<SpinalNode<any>, SpinalNode<any>>;
    }>,
    lux: number,
    stepIntervalMs: number
  ): Promise<void> {
    const promises: Promise<void>[] = [];

    for (const [macroZone, { regulationProfileType, microZones }] of macroZoneMap) {
      const targetPercent = calculateTargetPercent(lux, regulationProfileType);
      console.log(`\nRegulating MacroZone: ${macroZone.getName().get()} (profile ${regulationProfileType}) -> target: ${targetPercent.toFixed(1)}%`);
      for (const [microZone, endpoint] of microZones) {
        promises.push(
          this.regulateMicroZone(endpoint, microZone.getName().get(), targetPercent, stepIntervalMs)
        );
      }
    }

    await Promise.all(promises);
    console.log('\nAll microzones regulation complete.');
  }


}

function macroZoneMapLog(macroZoneMap: Map<SpinalNode<any>, {
  modeFonctionnement: SpinalNode<any>;
  regulationProfileType: string;

  microZones: Map<SpinalNode<any>, SpinalNode<any>>;
}>) {
  console.log('\n========== MacroZone Map ==========\n');
  for (const [macroZone, { modeFonctionnement, regulationProfileType, microZones }] of macroZoneMap) {
    console.log(`MacroZone: ${macroZone.getName().get()}`);
    console.log(`  └─ Mode Fonctionnement: ${modeFonctionnement.getName().get()}`);
    console.log(`  └─ Regulation Profile Type: ${regulationProfileType}`);
    console.log(`  └─ MicroZones (${microZones.size}):`);
    for (const [microZone, endpoint] of microZones) {
      console.log(`      ├─ ${microZone.getName().get()} -> endpoint: ${endpoint.getName().get()} | ${endpoint._server_id}`);
    }
    console.log('');
  }
  console.log(`Total: ${macroZoneMap.size} macrozones`);
}



const LUX_VALUE = 1200;            // Test constant (will be calculated later)
const STEP_INTERVAL_MS = 2000;    // Step every X ms (max 1% change per second)

/**
 * Calculates target luminosity % from lux value and regulation profile type.
 *
 * Profile 1:
 *   L < 100         => P = 70%
 *   100 <= L <= 1500 => P = -0.05 * L + 75
 *   L > 1500        => P = 0%
 *
 * Profile 2:
 *   L < 100         => P = 70%
 *   100 <= L <= 700  => P = -(7/60) * L + (490/6)   (~-0.1167 * L + 81.667)
 *   L > 700         => P = 0%
 */
function calculateTargetPercent(lux: number, profileType: string): number {
  if (profileType === '1') {
    if (lux < 100) return 70;
    if (lux > 1500) return 0;
    return -0.05 * lux + 75;
  }
  if (profileType === '2') {
    if (lux < 100) return 70;
    if (lux > 700) return 0;
    return -(7 / 60) * lux + 490 / 6;
  }
  console.warn(`Unknown regulation profile type: ${profileType}, defaulting to profile 1`);
  return calculateTargetPercent(lux, '1');
}

async function Main() {
  const spinalMain = new SpinalMain();
  const graph = await spinalMain.init();

  const macroZoneMap = await spinalMain.initJob();

  macroZoneMapLog(macroZoneMap);

  console.log(`\n========== Starting Luminosity Regulation ==========`);
  console.log(`Lux: ${LUX_VALUE} | Step interval: ${STEP_INTERVAL_MS}ms (max 1%/s)\n`);

  await spinalMain.regulateAllMicroZones(macroZoneMap, LUX_VALUE, STEP_INTERVAL_MS);
}
Main();
