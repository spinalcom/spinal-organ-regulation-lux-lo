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
exports.startRegulationLoop = exports.resetAllModes = exports.macroZoneMapLog = exports.calculateTargetPercent = void 0;
const logger_1 = require("./logger");
const endpointHelpers_1 = require("./endpointHelpers");
const LUX_UPDATE_THRESHOLD = 50;
const MAX_RAMP_PERCENT_PER_SECOND = 1;
function calculateTargetPercent(lux, profileType) {
    let result;
    if (profileType === '1') {
        if (lux < 100)
            result = 70;
        else if (lux <= 1500)
            result = -0.0357 * lux + 73.57;
        else
            result = 0;
    }
    else if (profileType === '2') {
        if (lux < 100)
            result = 70;
        else if (lux <= 700)
            result = -0.0833 * lux + 78.33;
        else if (lux <= 1500)
            result = 20;
        else
            result = 0;
    }
    else {
        logger_1.logger.warning(`Unknown regulation profile type: ${profileType}, defaulting to profile 1`);
        return calculateTargetPercent(lux, '1');
    }
    return Math.round(result * 100) / 100;
}
exports.calculateTargetPercent = calculateTargetPercent;
function macroZoneMapLog(macroZoneMap) {
    logger_1.logger.map('\n========== MacroZone Map ==========\n');
    for (const [macroZone, { modeFonctionnement, regulationProfileType, luminosityEndpoints, microZones }] of macroZoneMap) {
        logger_1.logger.map(`MacroZone: ${macroZone.getName().get()}`);
        logger_1.logger.map(`  └─ Mode Fonctionnement: ${modeFonctionnement.getName().get()}`);
        logger_1.logger.map(`  └─ Regulation Profile Type: ${regulationProfileType !== null && regulationProfileType !== void 0 ? regulationProfileType : '(unknown)'}`);
        logger_1.logger.map(`  └─ Luminosity Endpoints (${luminosityEndpoints.length}):`);
        for (const ep of luminosityEndpoints) {
            logger_1.logger.map(`      ├─ ${ep.getName().get()} | ${ep._server_id}`);
        }
        logger_1.logger.map(`  └─ MicroZones (${microZones.size}):`);
        for (const [microZone, { valueEndpoint, modeAttribute }] of microZones) {
            logger_1.logger.map(`      ├─ ${microZone.getName().get()} -> endpoint: ${valueEndpoint.getName().get()} | ${valueEndpoint._server_id} | mode=${modeAttribute.value.get()}`);
        }
        logger_1.logger.map('');
    }
    logger_1.logger.map(`Total: ${macroZoneMap.size} macrozones`);
}
exports.macroZoneMapLog = macroZoneMapLog;
function resetAllModes(macroZoneMap) {
    return __awaiter(this, void 0, void 0, function* () {
        const promises = [];
        for (const [macroZone, { modeFonctionnement, microZones }] of macroZoneMap) {
            promises.push((0, endpointHelpers_1.setEndpointCurrentValue)(modeFonctionnement, false).then(() => {
                logger_1.logger.regulation(`  [${macroZone.getName().get()}] Mode Fonctionnement reset to false`);
            }));
            for (const [microZone, info] of microZones) {
                info.modeAttribute.value.set('auto');
                logger_1.logger.regulation(`  [${macroZone.getName().get()}] [${microZone.getName().get()}] mode reset to 'auto'`);
            }
        }
        yield Promise.all(promises);
        logger_1.logger.regulation('\nAll Mode Fonctionnement endpoints reset to false; all microzone mode attributes reset to auto.');
    });
}
exports.resetAllModes = resetAllModes;
function startRegulationLoop(macroZoneMap, stepIntervalMs) {
    var _a;
    return __awaiter(this, void 0, void 0, function* () {
        const states = new Map();
        for (const macroZone of macroZoneMap.keys()) {
            states.set(macroZone, { lastAppliedAvgLux: null, microZoneTargets: new Map() });
        }
        logger_1.logger.regulation(`\nStarting regulation loop: tick every ${stepIntervalMs}ms | lux retarget threshold: ${LUX_UPDATE_THRESHOLD} | max ramp: ${MAX_RAMP_PERCENT_PER_SECOND}%/s`);
        while (true) {
            const t0 = Date.now();
            try {
                yield regulationTick(macroZoneMap, states, stepIntervalMs);
            }
            catch (err) {
                const msg = err instanceof Error ? ((_a = err.stack) !== null && _a !== void 0 ? _a : err.message) : String(err);
                logger_1.logger.warning(`Regulation tick error: ${msg}`);
            }
            const elapsed = Date.now() - t0;
            const waitMs = Math.max(0, stepIntervalMs - elapsed);
            yield sleep(waitMs);
        }
    });
}
exports.startRegulationLoop = startRegulationLoop;
function regulationTick(macroZoneMap, states, stepIntervalMs) {
    return __awaiter(this, void 0, void 0, function* () {
        const testMode = process.env.TEST_MODE === '1';
        const maxStepSize = (stepIntervalMs / 1000) * MAX_RAMP_PERCENT_PER_SECOND;
        for (const [macroZone, entry] of macroZoneMap) {
            const state = states.get(macroZone);
            const macroZoneTag = `${macroZone.getName().get()} | mz ${macroZone._server_id}`;
            if (!testMode) {
                const mfValue = yield (0, endpointHelpers_1.getEndpointCurrentValue)(entry.modeFonctionnement);
                const mfOn = mfValue === true || mfValue === 1;
                if (!mfOn)
                    continue;
            }
            if (!entry.regulationProfileType || entry.luminosityEndpoints.length === 0)
                continue;
            const rawLux = yield Promise.all(entry.luminosityEndpoints.map(ep => (0, endpointHelpers_1.getEndpointCurrentValue)(ep)));
            const numericLux = rawLux.map(v => Number(v)).filter(v => !isNaN(v));
            if (numericLux.length === 0)
                continue;
            const avgLux = numericLux.reduce((a, b) => a + b, 0) / numericLux.length;
            const isFirst = state.lastAppliedAvgLux === null;
            const luxMoved = !isFirst && Math.abs(avgLux - state.lastAppliedAvgLux) > LUX_UPDATE_THRESHOLD;
            if (isFirst || luxMoved) {
                const newTarget = calculateTargetPercent(avgLux, entry.regulationProfileType);
                const prev = state.lastAppliedAvgLux === null ? 'n/a' : state.lastAppliedAvgLux.toFixed(1);
                logger_1.logger.regulation(`\n[${macroZoneTag}] avg lux: ${avgLux.toFixed(1)} (prev ${prev}) | profile ${entry.regulationProfileType} -> target ${newTarget}%`);
                state.lastAppliedAvgLux = avgLux;
                for (const microZone of entry.microZones.keys()) {
                    state.microZoneTargets.set(microZone, { targetPercent: newTarget });
                }
            }
            if (state.microZoneTargets.size === 0)
                continue;
            yield Promise.all([...state.microZoneTargets].map(([microZone, ramp]) => __awaiter(this, void 0, void 0, function* () {
                const info = entry.microZones.get(microZone);
                if (!info) {
                    state.microZoneTargets.delete(microZone);
                    return;
                }
                if (!testMode && info.modeAttribute.value.get() !== 'auto')
                    return;
                const microZoneTag = `[${macroZoneTag}] [${microZone.getName().get()} | mz ${microZone._server_id} | ep ${info.valueEndpoint._server_id}]`;
                const current = Number(yield (0, endpointHelpers_1.getEndpointCurrentValue)(info.valueEndpoint));
                if (isNaN(current)) {
                    logger_1.logger.warning(`  ${microZoneTag} current value not numeric; dropping from ramp.`);
                    state.microZoneTargets.delete(microZone);
                    return;
                }
                const diff = ramp.targetPercent - current;
                if (Math.abs(diff) < 0.01) {
                    logger_1.logger.regulation(`  ${microZoneTag} reached target ${ramp.targetPercent}%`);
                    state.microZoneTargets.delete(microZone);
                    return;
                }
                const direction = diff > 0 ? 1 : -1;
                const newValue = Math.abs(diff) <= maxStepSize
                    ? ramp.targetPercent
                    : Math.round((current + direction * maxStepSize) * 100) / 100;
                yield (0, endpointHelpers_1.setEndpointCurrentValue)(info.valueEndpoint, newValue);
                logger_1.logger.regulation(`  ${microZoneTag} ${current}% -> ${newValue}% (target ${ramp.targetPercent}%)`);
            })));
        }
    });
}
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
//# sourceMappingURL=regulation.js.map