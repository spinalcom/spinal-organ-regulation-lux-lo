import { SpinalNode } from 'spinal-env-viewer-graph-service';
export type MacroZoneEntry = {
    modeFonctionnement: SpinalNode<any>;
    regulationProfileType: string | undefined;
    luminosityEndpoints: SpinalNode<any>[];
    microZones: Map<SpinalNode<any>, SpinalNode<any>>;
};
export type MacroZoneMap = Map<SpinalNode<any>, MacroZoneEntry>;
export declare function calculateTargetPercent(lux: number, profileType: string): number;
export declare function macroZoneMapLog(macroZoneMap: MacroZoneMap): void;
