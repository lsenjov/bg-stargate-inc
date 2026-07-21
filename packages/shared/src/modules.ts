import type {
  FactoryType,
  MaterialResource,
  ModuleDefinitionId,
  ModuleId,
  ModuleInstance,
  PlayerId,
  ResourceBalances,
  ResourceCost,
} from "./model.js";

export interface ModuleDefinition {
  id: ModuleDefinitionId;
  name: string;
  type: FactoryType;
  constructionCost: ResourceCost;
  runningCost: number;
  inputs: ResourceCost;
  outputs: ResourceCost;
}

export const materialResources = [
  "energy",
  "food",
  "ore",
  "metal",
  "mre",
  "teams",
] as const satisfies readonly MaterialResource[];

export const startingResources: Readonly<ResourceBalances> = {
  dollars: 20,
  energy: 6,
  food: 1,
  ore: 0,
  metal: 8,
  mre: 2,
  teams: 0,
};

export const moduleDefinitions = [
  {
    id: "solar-farm",
    name: "Solar Farm",
    type: "rural",
    constructionCost: { metal: 1 },
    runningCost: 1,
    inputs: {},
    outputs: { energy: 3 },
  },
  {
    id: "farm",
    name: "Farm",
    type: "rural",
    constructionCost: { metal: 1, energy: 2 },
    runningCost: 1,
    inputs: { energy: 1 },
    outputs: { food: 1 },
  },
  {
    id: "mine",
    name: "Mine",
    type: "underground",
    constructionCost: { food: 1, energy: 2 },
    runningCost: 1,
    inputs: { energy: 1 },
    outputs: { ore: 1 },
  },
  {
    id: "smelter",
    name: "Smelter",
    type: "industrial",
    constructionCost: { metal: 2 },
    runningCost: 1,
    inputs: { energy: 1, ore: 1 },
    outputs: { metal: 1 },
  },
  {
    id: "mre-factory",
    name: "MRE Factory",
    type: "industrial",
    constructionCost: { metal: 2 },
    runningCost: 1,
    inputs: { energy: 1, food: 1 },
    outputs: { mre: 1 },
  },
  {
    id: "training-center",
    name: "Training Center",
    type: "underground",
    constructionCost: { mre: 2, metal: 2, energy: 2 },
    runningCost: 2,
    inputs: { energy: 1, mre: 1, metal: 1 },
    outputs: { teams: 1 },
  },
] as const satisfies readonly ModuleDefinition[];

export const startingModuleDefinitionIds = moduleDefinitions.map(
  ({ id }) => id,
);

export function getModuleDefinition(
  definitionId: ModuleDefinitionId,
): ModuleDefinition {
  const definition = moduleDefinitions.find(({ id }) => id === definitionId);
  if (!definition) {
    throw new Error(`Unknown module definition: ${definitionId}`);
  }
  return definition;
}

export function startingModuleId(
  playerId: PlayerId,
  definitionId: ModuleDefinitionId,
): ModuleId {
  return `module:${playerId}:${definitionId}`;
}

export function createStartingModules(playerId: PlayerId): ModuleInstance[] {
  return startingModuleDefinitionIds.map((definitionId) => ({
    id: startingModuleId(playerId, definitionId),
    definitionId,
    ownerId: null,
  }));
}
