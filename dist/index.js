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
const cron_1 = require("cron");
const logger_1 = require("./logger");
const regulation_1 = require("./regulation");
const endpointHelpers_1 = require("./endpointHelpers");
require('dotenv').config();
class SpinalMain {
    constructor() { }
    init() {
        logger_1.logger.regulation('Init connection to HUB...');
        const host = process.env.SPINALHUB_PORT
            ? `${process.env.SPINALHUB_IP}:${process.env.SPINALHUB_PORT}`
            : process.env.SPINALHUB_IP;
        const url = `${process.env.SPINALHUB_PROTOCOL}://${process.env.USER_ID}:${process.env.USER_PASSWORD}@${host}/`;
        logger_1.logger.regulation(`URL: ${url}`);
        logger_1.logger.regulation(`Connecting to ${url}`);
        const conn = spinal_core_connectorjs_1.spinalCore.connect(url);
        this.hubConnection = conn;
        return new Promise((resolve, reject) => {
            spinal_core_connectorjs_1.spinalCore.load(conn, process.env.DIGITALTWIN_PATH, (graph) => __awaiter(this, void 0, void 0, function* () {
                yield spinal_env_viewer_graph_service_1.SpinalGraphService.setGraph(graph);
                logger_1.logger.regulation('HUB connection established.');
                resolve(graph);
            }), () => {
                logger_1.logger.warning('Connection failed! Please check your config file and the state of the hub.');
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
                logger_1.logger.warning(`Hardware context for multicapteurs not found. Expected name: ${process.env.HARDWARE_CONTEXT_MULTICAPTEURS_NAME}`);
            }
            if (!this.hwCtxtZones) {
                logger_1.logger.warning(`Hardware context for zones not found. Expected name: ${process.env.HARDWARE_CONTEXT_ZONES_NAME}`);
                return;
            }
            if (!this.hwCtxtPositionsDeTravail) {
                logger_1.logger.warning(`Hardware context for positions de travail not found. Expected name: ${process.env.HARDWARE_CONTEXT_POSITIONS_DE_TRAVAIL_NAME}`);
                return;
            }
            const hwCtxtZones_levels = yield this.hwCtxtZones.getChildrenInContext(this.hwCtxtZones);
            const hwCtxtMulticapteurs_levels = yield this.hwCtxtMulticapteurs.getChildrenInContext(this.hwCtxtMulticapteurs);
            const multicapteurInfoByMacroZoneName = new Map();
            yield Promise.all(hwCtxtMulticapteurs_levels.map((level) => __awaiter(this, void 0, void 0, function* () {
                const profileNodes = yield level.getChildrenInContext(this.hwCtxtMulticapteurs);
                yield Promise.all(profileNodes.map((profileNode) => __awaiter(this, void 0, void 0, function* () {
                    const profileName = profileNode.getName().get();
                    let regulationProfileType;
                    if (profileName === 'jour-1')
                        regulationProfileType = '1';
                    else if (profileName === 'jour-2')
                        regulationProfileType = '2';
                    else {
                        logger_1.logger.warning(`Unknown profile node "${profileName}" under level "${level.getName().get()}" in hwCtxtMulticapteurs (expected "jour-1" or "jour-2"). Skipping.`);
                        return;
                    }
                    const mcMacroZones = yield profileNode.getChildrenInContext(this.hwCtxtMulticapteurs);
                    yield Promise.all(mcMacroZones.map((mcMacroZone) => __awaiter(this, void 0, void 0, function* () {
                        const mcMacroZoneName = mcMacroZone.getName().get();
                        const multicapteurs = yield mcMacroZone.getChildrenInContext(this.hwCtxtMulticapteurs);
                        const luminosityEndpoints = [];
                        yield Promise.all(multicapteurs.map((multicapteur) => __awaiter(this, void 0, void 0, function* () {
                            const lumEndpoint = yield (0, endpointHelpers_1.getMulticapteurLuminosityEndpoint)(multicapteur);
                            if (!lumEndpoint) {
                                logger_1.logger.warning(`No "Mesure_lux" endpoint found for multicapteur ${multicapteur.getName().get()} (id: ${multicapteur._server_id}) under macroZone "${mcMacroZoneName}"`);
                                return;
                            }
                            luminosityEndpoints.push(lumEndpoint);
                        })));
                        if (multicapteurInfoByMacroZoneName.has(mcMacroZoneName)) {
                            logger_1.logger.warning(`Duplicate macroZone "${mcMacroZoneName}" in hwCtxtMulticapteurs — overwriting previous entry.`);
                        }
                        multicapteurInfoByMacroZoneName.set(mcMacroZoneName, {
                            regulationProfileType,
                            luminosityEndpoints,
                        });
                    })));
                })));
            })));
            const gatewayArrays = yield Promise.all(hwCtxtZones_levels.map(level => level.getChildrenInContext(this.hwCtxtZones)));
            const hwCtxtZones_gateways = gatewayArrays.flat();
            const macroZoneArrays = yield Promise.all(hwCtxtZones_gateways.map(gateway => gateway.getChildrenInContext(this.hwCtxtZones)));
            const hwCtxtZones_macroZones = macroZoneArrays.flat();
            const macroZoneMap = new Map();
            yield Promise.all(hwCtxtZones_macroZones.map((macroZone) => __awaiter(this, void 0, void 0, function* () {
                var _a;
                const [microZones, modeFonctionnement] = yield Promise.all([
                    macroZone.getChildrenInContext(this.hwCtxtZones),
                    (0, endpointHelpers_1.getMacroZoneModeFonctionnementNode)(macroZone),
                ]);
                if (!modeFonctionnement) {
                    logger_1.logger.warning(`No "Mode fonctionnement" endpoint found for macroZone ${macroZone.getName().get()} (id: ${macroZone._server_id})`);
                    return;
                }
                const macroZoneName = macroZone.getName().get();
                const mcInfo = multicapteurInfoByMacroZoneName.get(macroZoneName);
                if (!mcInfo) {
                    logger_1.logger.warning(`MacroZone "${macroZoneName}" not found in hwCtxtMulticapteurs. Keeping with empty luminosityEndpoints and undefined regulationProfileType.`);
                }
                const microZoneEndpoints = new Map();
                yield Promise.all(microZones.map((microZone) => __awaiter(this, void 0, void 0, function* () {
                    const valueEndpoint = yield (0, endpointHelpers_1.getMicroZoneValueNode)(microZone);
                    if (!valueEndpoint) {
                        logger_1.logger.warning(`No "Value" endpoint found for microZone ${microZone.getName().get()} (id: ${microZone._server_id}) under macroZone ${macroZone.getName().get()}`);
                        return;
                    }
                    microZoneEndpoints.set(microZone, valueEndpoint);
                })));
                macroZoneMap.set(macroZone, {
                    modeFonctionnement,
                    regulationProfileType: mcInfo === null || mcInfo === void 0 ? void 0 : mcInfo.regulationProfileType,
                    luminosityEndpoints: (_a = mcInfo === null || mcInfo === void 0 ? void 0 : mcInfo.luminosityEndpoints) !== null && _a !== void 0 ? _a : [],
                    microZones: microZoneEndpoints,
                });
            })));
            return macroZoneMap;
        });
    }
    regulateMicroZone(endpoint, microZoneName, targetPercent, stepIntervalMs) {
        return __awaiter(this, void 0, void 0, function* () {
            const rawValue = yield (0, endpointHelpers_1.getEndpointCurrentValue)(endpoint);
            const currentValue = Number(rawValue);
            if (isNaN(currentValue)) {
                logger_1.logger.warning(`  [${microZoneName}] [${endpoint.getName().get()} | ${endpoint._server_id}] Current value is not a number (${rawValue}). Skipping.`);
                return;
            }
            const diff = targetPercent - currentValue;
            if (Math.abs(diff) < 0.01) {
                logger_1.logger.regulation(`  [${microZoneName}] [${endpoint.getName().get()} | ${endpoint._server_id}] Already at target (${currentValue}%). Skipping.`);
                return;
            }
            const direction = diff > 0 ? 1 : -1;
            const maxStepSize = stepIntervalMs / 1000;
            const totalSteps = Math.ceil(Math.abs(diff) / maxStepSize);
            logger_1.logger.regulation(`  [${microZoneName}] [${endpoint.getName().get()} | ${endpoint._server_id}] Current: ${currentValue}% -> Target: ${targetPercent}% | ${totalSteps} steps of ${direction > 0 ? '+' : '-'}${maxStepSize}% every ${stepIntervalMs}ms`);
            return new Promise((resolve) => {
                let step = 0;
                const interval = setInterval(() => __awaiter(this, void 0, void 0, function* () {
                    step++;
                    const projected = currentValue + direction * maxStepSize * step;
                    const newValue = Math.abs(targetPercent - projected) < maxStepSize
                        ? targetPercent
                        : Math.round(projected * 100) / 100;
                    yield (0, endpointHelpers_1.setEndpointCurrentValue)(endpoint, newValue);
                    logger_1.logger.regulation(`  [${microZoneName}] [${endpoint.getName().get()} | ${endpoint._server_id}] Step ${step}/${totalSteps} -> ${newValue}%`);
                    if (step >= totalSteps) {
                        clearInterval(interval);
                        logger_1.logger.regulation(`  [${microZoneName}] [${endpoint.getName().get()} | ${endpoint._server_id}] Reached target ${targetPercent}%`);
                        resolve();
                    }
                }), stepIntervalMs);
            });
        });
    }
    regulateAllMicroZones(macroZoneMap, stepIntervalMs) {
        return __awaiter(this, void 0, void 0, function* () {
            const promises = [];
            const testMode = process.env.TEST_MODE === '1';
            for (const [macroZone, { modeFonctionnement, regulationProfileType, luminosityEndpoints, microZones }] of macroZoneMap) {
                if (!testMode) {
                    const modeFonctionnementValue = yield (0, endpointHelpers_1.getEndpointCurrentValue)(modeFonctionnement);
                    if (modeFonctionnementValue !== true) {
                        logger_1.logger.warning(`\nSkipping MacroZone: ${macroZone.getName().get()} - Mode Fonctionnement is not true (value: ${modeFonctionnementValue})`);
                        continue;
                    }
                }
                if (!regulationProfileType) {
                    logger_1.logger.warning(`\nSkipping MacroZone: ${macroZone.getName().get()} - no regulationProfileType (not found in hwCtxtMulticapteurs).`);
                    continue;
                }
                if (luminosityEndpoints.length === 0) {
                    logger_1.logger.warning(`\nSkipping MacroZone: ${macroZone.getName().get()} - no luminosity endpoints available.`);
                    continue;
                }
                const rawLuxValues = yield Promise.all(luminosityEndpoints.map(ep => (0, endpointHelpers_1.getEndpointCurrentValue)(ep)));
                const numericLuxValues = rawLuxValues.map(v => Number(v)).filter(v => !isNaN(v));
                if (numericLuxValues.length === 0) {
                    logger_1.logger.warning(`\nSkipping MacroZone: ${macroZone.getName().get()} - no valid lux readings from ${luminosityEndpoints.length} sensor(s).`);
                    continue;
                }
                const avgLux = numericLuxValues.reduce((a, b) => a + b, 0) / numericLuxValues.length;
                const targetPercent = (0, regulation_1.calculateTargetPercent)(avgLux, regulationProfileType);
                logger_1.logger.regulation(`\nRegulating MacroZone: ${macroZone.getName().get()} (profile ${regulationProfileType}) | avg lux: ${avgLux.toFixed(1)} (${numericLuxValues.length}/${luminosityEndpoints.length} sensors) -> target: ${targetPercent.toFixed(1)}%`);
                for (const [microZone, endpoint] of microZones) {
                    promises.push(this.regulateMicroZone(endpoint, microZone.getName().get(), targetPercent, stepIntervalMs));
                }
            }
            yield Promise.all(promises);
            logger_1.logger.regulation('\nAll microzones regulation complete.');
        });
    }
    resetAllModeFonctionnement(macroZoneMap) {
        return __awaiter(this, void 0, void 0, function* () {
            const promises = [];
            for (const [macroZone, { modeFonctionnement }] of macroZoneMap) {
                promises.push((0, endpointHelpers_1.setEndpointCurrentValue)(modeFonctionnement, true).then(() => {
                    logger_1.logger.regulation(`  [${macroZone.getName().get()}] Mode Fonctionnement reset to true`);
                }));
            }
            yield Promise.all(promises);
            logger_1.logger.regulation('\nAll Mode Fonctionnement endpoints reset to true.');
        });
    }
}
const STEP_INTERVAL_MS = 10000;
function Main() {
    return __awaiter(this, void 0, void 0, function* () {
        const spinalMain = new SpinalMain();
        yield spinalMain.init();
        const macroZoneMap = yield spinalMain.initJob();
        if (!macroZoneMap) {
            logger_1.logger.warning('Failed to initialize job: macroZoneMap is undefined.');
            return;
        }
        (0, regulation_1.macroZoneMapLog)(macroZoneMap);
        logger_1.logger.regulation('\n========== Starting Luminosity Regulation ==========');
        logger_1.logger.regulation(`Step interval: ${STEP_INTERVAL_MS}ms (max 1%/s) | Lux computed per-macrozone from multicapteurs\n`);
        yield spinalMain.regulateAllMicroZones(macroZoneMap, STEP_INTERVAL_MS);
        const resetCron = new cron_1.CronJob('0 12,19,22 * * *', () => __awaiter(this, void 0, void 0, function* () {
            logger_1.logger.regulation(`\n[CRON ${new Date().toLocaleTimeString()}] Resetting all Mode Fonctionnement to true...`);
            yield spinalMain.resetAllModeFonctionnement(macroZoneMap);
        }));
        resetCron.start();
        logger_1.logger.regulation('\nCron scheduled: Mode Fonctionnement reset at 12:00, 19:00, 22:00');
    });
}
Main();
//# sourceMappingURL=index.js.map