import { SpinalNode } from 'spinal-env-viewer-graph-service';
import { SpinalAttribute } from 'spinal-models-documentation';
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
export declare function calculateTargetPercent(lux: number, profileType: string): number;
export declare function macroZoneMapLog(macroZoneMap: MacroZoneMap): void;
export declare function resetAllModeFonctionnement(macroZoneMap: MacroZoneMap): Promise<void>;
export declare function startRegulationLoop(macroZoneMap: MacroZoneMap, stepIntervalMs: number): Promise<never>;
