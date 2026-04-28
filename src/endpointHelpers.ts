import { SpinalNode } from 'spinal-env-viewer-graph-service';
import { attributeService } from 'spinal-env-viewer-plugin-documentation-service'
import { SpinalAttribute } from 'spinal-models-documentation';

export async function setEndpointCurrentValue(endpoint: SpinalNode<any>, value: any): Promise<void> {
  const element = await endpoint.element!.load();
  element.currentValue.set(value);
}

export async function getEndpointCurrentValue(endpoint: SpinalNode<any>): Promise<any> {
  const element = await endpoint.element!.load();
  return element.currentValue.get();
}

// Mode fonctionnement endpoint value is either false (Automatically regulated by client) or true
// (Manually regulated by occupant + this program on microzones that are in auto mode).
export async function getMacroZoneModeFonctionnementNode(macroZone: SpinalNode<any>): Promise<SpinalNode<any> | undefined> {
  const firstLevelEndpoints = await macroZone.getChildren('hasBmsEndpoint');
  const firstEndpointLevel = firstLevelEndpoints.find(ep => ep.getName().get() === macroZone.getName().get());
  if (!firstEndpointLevel) return undefined;

  const secondLevelEndpoints = await firstEndpointLevel.getChildren('hasBmsEndpoint');
  return secondLevelEndpoints.find(ep => ep.getName().get() === 'Mode fonctionnement') || undefined;
}

export async function getMicroZoneValueNode(microZone: SpinalNode<any>): Promise<SpinalNode<any> | undefined> {
  const firstLevelEndpoints = await microZone.getChildren('hasBmsEndpoint');
  const firstEndpointLevel = firstLevelEndpoints.find(ep => ep.getName().get() === microZone.getName().get());
  if (!firstEndpointLevel) return undefined;

  const secondLevelEndpoints = await firstEndpointLevel.getChildren('hasBmsEndpoint');
  return secondLevelEndpoints.find(ep => ep.getName().get() === 'Value') || undefined;
}

export async function getMulticapteurLuminosityEndpoint(multicapteur: SpinalNode<any>): Promise<SpinalNode<any> | undefined> {
  const firstLevelEndpoints = await multicapteur.getChildren('hasBmsEndpoint');
  if (firstLevelEndpoints.length === 0) return undefined;
  // Assuming there's only one first-level endpoint under the multicapteur
  const secondLevelEndpoints = await firstLevelEndpoints[0].getChildren('hasBmsEndpoint');
  return secondLevelEndpoints.find(ep => ep.getName().get() === 'Mesure_lux') || undefined;
}

export async function getOrCreateMicroZoneModeAttributeModel(microZone: SpinalNode<any>): Promise<SpinalAttribute | undefined> {
  const attribute = await attributeService.findOneAttributeInCategory(microZone, 'default', 'mode');
  if (attribute != -1) {
    return attribute
  }
  const newAttribute = await attributeService.addAttributeByCategoryName(microZone, 'default', 'mode', 'auto');
  // the manual mode is set by another program that is in charge of setting the mode to 'manual' when the occupant changes it, 
  // so we set it to 'auto' by default

  return newAttribute;
}
