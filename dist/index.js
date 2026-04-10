"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const spinal_core_connectorjs_1 = require("spinal-core-connectorjs");
const spinal_env_viewer_graph_service_1 = require("spinal-env-viewer-graph-service");
const spinal_env_viewer_plugin_documentation_service_1 = require("spinal-env-viewer-plugin-documentation-service");
require('dotenv').config();
class SpinalMain {
    constructor() { }
    init() {
        console.log('Done.');
        console.log('Init connection to HUB...');
        const host = process.env.SPINALHUB_PORT
            ? `${process.env.SPINALHUB_IP}:${process.env.SPINALHUB_PORT}`
            : process.env.SPINALHUB_IP;
        const url = `${process.env.SPINALHUB_PROTOCOL}://${process.env.USER_ID}:${process.env.USER_PASSWORD}@${host}/`;
        console.log('URL:', url);
        console.log('Connecting to', url);
        const conn = spinal_core_connectorjs_1.spinalCore.connect(url);
        this.hubConnection = conn;
        return new Promise((resolve, reject) => {
            spinal_core_connectorjs_1.spinalCore.load(conn, process.env.DIGITALTWIN_PATH, (graph) => __awaiter(this, void 0, void 0, function* () {
                yield spinal_env_viewer_graph_service_1.SpinalGraphService.setGraph(graph);
                console.log('Done.');
                resolve(graph);
            }), () => {
                console.log('Connection failed ! Please check your config file and the state of the hub.');
                reject();
            });
        });
    }
    load(server_id) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!server_id) {
                return Promise.reject('Invalid serverId');
            }
            if (typeof spinal_core_connectorjs_1.FileSystem._objects[server_id] !== 'undefined') {
                return Promise.resolve(spinal_core_connectorjs_1.FileSystem._objects[server_id]);
            }
            try {
                return yield this.hubConnection.load_ptr(server_id);
            }
            catch (error) {
                throw new Error(`Error loading model with server_id: ${server_id}`);
            }
        });
    }
    initJob() {
        return __awaiter(this, void 0, void 0, function* () {
            const graph = spinal_env_viewer_graph_service_1.SpinalGraphService.getGraph();
            const contexts = yield graph.getChildren('hasContext');
            this.hwCtxtMulticapteurs = contexts.find((ctx) => ctx.getName().get() === process.env.HARDWARE_CONTEXT_MULTICAPTEURS_NAME);
            this.hwCtxtZones = contexts.find((ctx) => ctx.getName().get() === process.env.HARDWARE_CONTEXT_ZONES_NAME);
            this.hwCtxtPositionsDeTravail = contexts.find((ctx) => ctx.getName().get() === process.env.HARDWARE_CONTEXT_POSITIONS_DE_TRAVAIL_NAME);
            if (!this.hwCtxtMulticapteurs) {
                console.error(`Hardware context for multicapteurs not found. Expected name: ${process.env.HARDWARE_CONTEXT_MULTICAPTEURS_NAME}`);
            }
            if (!this.hwCtxtZones) {
                console.error(`Hardware context for zones not found. Expected name: ${process.env.HARDWARE_CONTEXT_ZONES_NAME}`);
                return;
            }
            if (!this.hwCtxtPositionsDeTravail) {
                console.error(`Hardware context for positions de travail not found. Expected name: ${process.env.HARDWARE_CONTEXT_POSITIONS_DE_TRAVAIL_NAME}`);
                return;
            }
            const hwCtxtZones_levels = yield this.hwCtxtZones.getChildrenInContext(this.hwCtxtZones);
            const gatewayArrays = yield Promise.all(hwCtxtZones_levels.map(level => level.getChildrenInContext(this.hwCtxtZones)));
            const hwCtxtZones_gateways = gatewayArrays.flat();
            const macroZoneArrays = yield Promise.all(hwCtxtZones_gateways.map(gateway => gateway.getChildrenInContext(this.hwCtxtZones)));
            const hwCtxtZones_macroZones = macroZoneArrays.flat();
            const macroZoneMap = new Map();
            yield Promise.all(hwCtxtZones_macroZones.map((macroZone) => __awaiter(this, void 0, void 0, function* () {
                const [microZones, modeFonctionnement, regulationProfileType] = yield Promise.all([
                    macroZone.getChildrenInContext(this.hwCtxtZones),
                    this.getMacroZoneModeFonctionnementNode(macroZone),
                    this.getMacroZoneRegulationProfileType(macroZone),
                ]);
                if (!modeFonctionnement || !regulationProfileType) {
                    console.warn(`No "Mode fonctionnement" endpoint or regulationProfileType found  for macroZone ${macroZone.getName().get()} (id: ${macroZone._server_id})`);
                    return;
                }
                const microZoneEndpoints = new Map();
                yield Promise.all(microZones.map((microZone) => __awaiter(this, void 0, void 0, function* () {
                    const valueEndpoint = yield this.getMicroZoneValueNode(microZone);
                    if (!valueEndpoint) {
                        console.warn(`No "Value" endpoint found for microZone ${microZone.getName().get()} (id: ${microZone._server_id}) under macroZone ${macroZone.getName().get()}`);
                        return;
                    }
                    microZoneEndpoints.set(microZone, valueEndpoint);
                })));
                macroZoneMap.set(macroZone, {
                    modeFonctionnement,
                    regulationProfileType,
                    microZones: microZoneEndpoints,
                });
            })));
            return macroZoneMap;
        });
    }
    getMacroZoneModeFonctionnementNode(macroZone) {
        return __awaiter(this, void 0, void 0, function* () {
            const firstLevelEndpoints = yield macroZone.getChildren('hasBmsEndpoint');
            const firstEndpointLevel = firstLevelEndpoints.find(ep => ep.getName().get() === macroZone.getName().get());
            if (!firstEndpointLevel) {
                return undefined;
            }
            const secondLevelEndpoints = yield firstEndpointLevel.getChildren('hasBmsEndpoint');
            const modeFonctionnement = secondLevelEndpoints.find(ep => ep.getName().get() === 'Mode fonctionnement');
            return modeFonctionnement || undefined;
        });
    }
    getMacroZoneRegulationProfileType(macroZone) {
        return __awaiter(this, void 0, void 0, function* () {
            let regulationProfileType = undefined;
            const attr = yield spinal_env_viewer_plugin_documentation_service_1.serviceDocumentation.findOneAttributeInCategory(macroZone, 'default', 'RegulationProfileType');
            if (attr !== -1) {
                regulationProfileType = attr.value.get();
                return regulationProfileType;
            }
            else {
                return Math.random() < 0.5 ? '1' : '2';
            }
        });
    }
    getMicroZoneValueNode(microZone) {
        return __awaiter(this, void 0, void 0, function* () {
            const firstLevelEndpoints = yield microZone.getChildren('hasBmsEndpoint');
            const firstEndpointLevel = firstLevelEndpoints.find(ep => ep.getName().get() === microZone.getName().get());
            if (!firstEndpointLevel) {
                return undefined;
            }
            const secondLevelEndpoints = yield firstEndpointLevel.getChildren('hasBmsEndpoint');
            const valueEndpoint = secondLevelEndpoints.find(ep => ep.getName().get() === 'Value');
            return valueEndpoint || undefined;
        });
    }
    setEndpointCurrentValue(endpoint, value) {
        return __awaiter(this, void 0, void 0, function* () {
            const element = yield endpoint.element.load();
            const currentValue = element.currentValue;
            currentValue.set(value);
        });
    }
    getEndpointCurrentValue(endpoint) {
        return __awaiter(this, void 0, void 0, function* () {
            const element = yield endpoint.element.load();
            return element.currentValue.get();
        });
    }
    regulateMicroZone(endpoint, microZoneName, targetPercent, stepIntervalMs) {
        return __awaiter(this, void 0, void 0, function* () {
            const rawValue = yield this.getEndpointCurrentValue(endpoint);
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
                const interval = setInterval(() => __awaiter(this, void 0, void 0, function* () {
                    step++;
                    const remaining = Math.abs(targetPercent - (currentValue + direction * step));
                    const newValue = remaining < 1
                        ? targetPercent
                        : Math.round((currentValue + direction * step) * 100) / 100;
                    yield this.setEndpointCurrentValue(endpoint, newValue);
                    console.log(`  [${microZoneName}] [${endpoint.getName().get()} | ${endpoint._server_id}] Step ${step}/${totalSteps} -> ${newValue}%`);
                    if (step >= totalSteps) {
                        clearInterval(interval);
                        console.log(`  [${microZoneName}] [${endpoint.getName().get()} | ${endpoint._server_id}] Reached target ${targetPercent}%`);
                        resolve();
                    }
                }), stepIntervalMs);
            });
        });
    }
    regulateAllMicroZones(macroZoneMap, lux, stepIntervalMs) {
        return __awaiter(this, void 0, void 0, function* () {
            const promises = [];
            for (const [macroZone, { regulationProfileType, microZones }] of macroZoneMap) {
                const targetPercent = calculateTargetPercent(lux, regulationProfileType);
                console.log(`\nRegulating MacroZone: ${macroZone.getName().get()} (profile ${regulationProfileType}) -> target: ${targetPercent.toFixed(1)}%`);
                for (const [microZone, endpoint] of microZones) {
                    promises.push(this.regulateMicroZone(endpoint, microZone.getName().get(), targetPercent, stepIntervalMs));
                }
            }
            yield Promise.all(promises);
            console.log('\nAll microzones regulation complete.');
        });
    }
}
function macroZoneMapLog(macroZoneMap) {
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
const LUX_VALUE = 1200;
const STEP_INTERVAL_MS = 2000;
function calculateTargetPercent(lux, profileType) {
    if (profileType === '1') {
        if (lux < 100)
            return 70;
        if (lux > 1500)
            return 0;
        return -0.05 * lux + 75;
    }
    if (profileType === '2') {
        if (lux < 100)
            return 70;
        if (lux > 700)
            return 0;
        return -(7 / 60) * lux + 490 / 6;
    }
    console.warn(`Unknown regulation profile type: ${profileType}, defaulting to profile 1`);
    return calculateTargetPercent(lux, '1');
}
function Main() {
    return __awaiter(this, void 0, void 0, function* () {
        const spinalMain = new SpinalMain();
        const graph = yield spinalMain.init();
        const macroZoneMap = yield spinalMain.initJob();
        macroZoneMapLog(macroZoneMap);
        console.log(`\n========== Starting Luminosity Regulation ==========`);
        console.log(`Lux: ${LUX_VALUE} | Step interval: ${STEP_INTERVAL_MS}ms (max 1%/s)\n`);
        yield spinalMain.regulateAllMicroZones(macroZoneMap, LUX_VALUE, STEP_INTERVAL_MS);
    });
}
Main();
//# sourceMappingURL=index.js.map