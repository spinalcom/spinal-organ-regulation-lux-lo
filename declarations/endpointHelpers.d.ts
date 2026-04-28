import { SpinalNode } from 'spinal-env-viewer-graph-service';
import { SpinalAttribute } from 'spinal-models-documentation';
export declare function setEndpointCurrentValue(endpoint: SpinalNode<any>, value: any): Promise<void>;
export declare function getEndpointCurrentValue(endpoint: SpinalNode<any>): Promise<any>;
export declare function getMacroZoneModeFonctionnementNode(macroZone: SpinalNode<any>): Promise<SpinalNode<any> | undefined>;
export declare function getMicroZoneValueNode(microZone: SpinalNode<any>): Promise<SpinalNode<any> | undefined>;
export declare function getMulticapteurLuminosityEndpoint(multicapteur: SpinalNode<any>): Promise<SpinalNode<any> | undefined>;
export declare function getOrCreateMicroZoneModeAttributeModel(microZone: SpinalNode<any>): Promise<SpinalAttribute | undefined>;
