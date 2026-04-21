"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.macroZoneMapLog = exports.calculateTargetPercent = void 0;
const logger_1 = require("./logger");
function calculateTargetPercent(lux, profileType) {
    if (profileType === '1') {
        if (lux < 100)
            return 70;
        if (lux <= 1500)
            return -0.0357 * lux + 73.57;
        return 0;
    }
    if (profileType === '2') {
        if (lux < 100)
            return 70;
        if (lux <= 700)
            return -0.0833 * lux + 78.33;
        if (lux <= 1500)
            return 20;
        return 0;
    }
    logger_1.logger.warning(`Unknown regulation profile type: ${profileType}, defaulting to profile 1`);
    return calculateTargetPercent(lux, '1');
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
        for (const [microZone, endpoint] of microZones) {
            logger_1.logger.map(`      ├─ ${microZone.getName().get()} -> endpoint: ${endpoint.getName().get()} | ${endpoint._server_id}`);
        }
        logger_1.logger.map('');
    }
    logger_1.logger.map(`Total: ${macroZoneMap.size} macrozones`);
}
exports.macroZoneMapLog = macroZoneMapLog;
//# sourceMappingURL=regulation.js.map