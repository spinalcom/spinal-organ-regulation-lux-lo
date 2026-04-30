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
exports.getOrCreateMicroZoneModeAttributeModel = exports.getMulticapteurLuminosityEndpoint = exports.getMicroZoneValueNode = exports.getMacroZoneModeFonctionnementNode = exports.getEndpointCurrentValue = exports.setEndpointCurrentValue = void 0;
const spinal_env_viewer_plugin_documentation_service_1 = require("spinal-env-viewer-plugin-documentation-service");
function setEndpointCurrentValue(endpoint, value) {
    return __awaiter(this, void 0, void 0, function* () {
        const element = yield endpoint.element.load();
        element.currentValue.set(value);
    });
}
exports.setEndpointCurrentValue = setEndpointCurrentValue;
function getEndpointCurrentValue(endpoint) {
    return __awaiter(this, void 0, void 0, function* () {
        const element = yield endpoint.element.load();
        return element.currentValue.get();
    });
}
exports.getEndpointCurrentValue = getEndpointCurrentValue;
function getMacroZoneModeFonctionnementNode(macroZone) {
    return __awaiter(this, void 0, void 0, function* () {
        const firstLevelEndpoints = yield macroZone.getChildren('hasBmsEndpoint');
        const firstEndpointLevel = firstLevelEndpoints.find(ep => ep.getName().get() === macroZone.getName().get());
        if (!firstEndpointLevel)
            return undefined;
        const secondLevelEndpoints = yield firstEndpointLevel.getChildren('hasBmsEndpoint');
        return secondLevelEndpoints.find(ep => ep.getName().get() === 'Mode fonctionnement') || undefined;
    });
}
exports.getMacroZoneModeFonctionnementNode = getMacroZoneModeFonctionnementNode;
function getMicroZoneValueNode(microZone) {
    return __awaiter(this, void 0, void 0, function* () {
        const firstLevelEndpoints = yield microZone.getChildren('hasBmsEndpoint');
        const firstEndpointLevel = firstLevelEndpoints.find(ep => ep.getName().get() === microZone.getName().get());
        if (!firstEndpointLevel)
            return undefined;
        const secondLevelEndpoints = yield firstEndpointLevel.getChildren('hasBmsEndpoint');
        return secondLevelEndpoints.find(ep => ep.getName().get() === 'Value') || undefined;
    });
}
exports.getMicroZoneValueNode = getMicroZoneValueNode;
function getMulticapteurLuminosityEndpoint(multicapteur) {
    return __awaiter(this, void 0, void 0, function* () {
        const firstLevelEndpoints = yield multicapteur.getChildren('hasBmsEndpoint');
        if (firstLevelEndpoints.length === 0)
            return undefined;
        const secondLevelEndpoints = yield firstLevelEndpoints[0].getChildren('hasBmsEndpoint');
        return secondLevelEndpoints.find(ep => ep.getName().get() === 'Mesure_lux') || undefined;
    });
}
exports.getMulticapteurLuminosityEndpoint = getMulticapteurLuminosityEndpoint;
function getOrCreateMicroZoneModeAttributeModel(microZone) {
    return __awaiter(this, void 0, void 0, function* () {
        const firstLevelEndpoints = yield microZone.getChildren('hasBmsEndpoint');
        const microZoneEndpointNode = firstLevelEndpoints.find(ep => ep.getName().get() === microZone.getName().get());
        if (!microZoneEndpointNode)
            return undefined;
        const attribute = yield spinal_env_viewer_plugin_documentation_service_1.attributeService.findOneAttributeInCategory(microZoneEndpointNode, 'default', 'mode');
        if (attribute != -1) {
            return attribute;
        }
        const newAttribute = yield spinal_env_viewer_plugin_documentation_service_1.attributeService.addAttributeByCategoryName(microZoneEndpointNode, 'default', 'mode', 'auto');
        return newAttribute;
    });
}
exports.getOrCreateMicroZoneModeAttributeModel = getOrCreateMicroZoneModeAttributeModel;
//# sourceMappingURL=endpointHelpers.js.map