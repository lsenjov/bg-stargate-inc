import { useEffect, useRef, useState } from "react";

import {
  getModuleDefinition,
  materialResources,
  type CommandResult,
  type ConnectionRewardState,
  type Factory,
  type FactoryConstructionTarget,
  type LobbyView,
  type ModuleInstance,
  type ResourceBalances,
  type ResourceCost,
} from "@stargate-inc/shared";

import type { GameSocket } from "./socket.js";

interface RunCommand {
  <T>(
    label: string,
    send: (callback: (result: CommandResult<T>) => void) => void,
  ): void;
}

interface FactoryPanelProps {
  socket: GameSocket;
  view: LobbyView;
  unavailable: boolean;
  pending: string | null;
  run: RunCommand;
}

const resourceLabels: Record<keyof ResourceBalances, string> = {
  dollars: "$",
  energy: "Energy",
  food: "Food",
  ore: "Ore",
  metal: "Metal",
  mre: "MRE",
  teams: "Teams",
};

function costEntries(cost: ResourceCost): Array<[string, number]> {
  return materialResources.flatMap((resource) => {
    const amount = cost[resource] ?? 0;
    return amount > 0 ? [[resourceLabels[resource], amount]] : [];
  });
}

function CostLine({ cost, teamSurcharge = false }: { cost: ResourceCost; teamSurcharge?: boolean }) {
  const entries = costEntries(cost);
  if (teamSurcharge) {
    const team = entries.find(([label]) => label === "Teams");
    if (team) team[1] += 1;
    else entries.push(["Teams", 1]);
  }
  return <span className="cost-line">{entries.length ? entries.map(([label, amount]) => `${amount} ${label}`).join(" · ") : "No materials"}</span>;
}

function canAffordMaterials(resources: ResourceBalances, cost: ResourceCost, teamSurcharge = false): boolean {
  return materialResources.every((resource) => {
    const surcharge = teamSurcharge && resource === "teams" ? 1 : 0;
    return resources[resource] >= (cost[resource] ?? 0) + surcharge;
  });
}

function locationFactories(view: LobbyView, reward: ConnectionRewardState): Factory[] {
  const game = view.lobby.game!;
  if (reward.location.kind === "home") {
    return game.players[reward.location.playerId]?.homeFactories ?? [];
  }
  const exoplanetId = reward.location.exoplanetId;
  return game.exoplanets
    .find(({ id }) => id === exoplanetId)
    ?.factorySlots.filter((factory): factory is Factory => factory !== null) ?? [];
}

function locationName(view: LobbyView, reward: ConnectionRewardState): string {
  if (reward.location.kind === "home") return "your home planet";
  const exoplanetId = reward.location.exoplanetId;
  return view.lobby.game?.exoplanets.find(({ id }) => id === exoplanetId)?.name ?? "the exoplanet";
}

interface TargetOption {
  key: string;
  label: string;
  target: FactoryConstructionTarget;
}

function constructionTargets(
  view: LobbyView,
  reward: ConnectionRewardState,
  module: ModuleInstance,
): TargetOption[] {
  const definition = getModuleDefinition(module.definitionId);
  const existing = locationFactories(view, reward)
    .filter(({ type }) => type === definition.type)
    .map((factory, index) => ({
      key: `factory:${factory.id}`,
      label: `${definition.type} factory ${index + 1}`,
      target: { kind: "factory", factoryId: factory.id } as const,
    }));
  if (reward.location.kind === "home") {
    return [
      ...existing,
      {
        key: "new-factory",
        label: `New ${definition.type} factory`,
        target: { kind: "new-factory" },
      },
    ];
  }
  const exoplanetId = reward.location.exoplanetId;
  const exoplanet = view.lobby.game?.exoplanets.find(
    ({ id }) => id === exoplanetId,
  );
  const slots = exoplanet?.factorySlots.flatMap((factory, slotIndex) =>
    factory === null
      ? [{
          key: `slot:${slotIndex}`,
          label: `Empty slot ${slotIndex + 1}`,
          target: { kind: "exoplanet-slot", slotIndex } as const,
        }]
      : []
  ) ?? [];
  return [...existing, ...slots];
}

function ConstructionPanel({ socket, view, unavailable, pending, run, reward }: FactoryPanelProps & { reward: ConnectionRewardState }) {
  const self = view.lobby.game!.players[view.self.playerId]!;
  const [targets, setTargets] = useState<Record<string, string>>({});
  const panelRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const focusedModuleId = useRef<string | null>(null);
  const isExoplanet = reward.location.kind === "exoplanet";

  useEffect(() => {
    const moduleId = focusedModuleId.current;
    if (!moduleId || self.heldModules.some(({ id }) => id === moduleId)) return;
    focusedModuleId.current = null;
    if (document.activeElement !== document.body) return;
    const nextAction = panelRef.current?.querySelector<HTMLButtonElement>(".construct-button:not(:disabled)");
    (nextAction ?? headingRef.current)?.focus();
  }, [self.heldModules]);

  const construct = (module: ModuleInstance, options: TargetOption[]) => {
    const selectedOption = options.find(({ key }) => key === targets[module.id]) ?? options[0];
    const target = selectedOption?.target;
    if (!target) return;
    const definition = getModuleDefinition(module.definitionId);
    run(`Constructing ${definition.name}`, (callback) =>
      socket.emit("factory:construct", { moduleId: module.id, target }, callback)
    );
  };

  return <section ref={panelRef} className="panel factory-action-panel" aria-labelledby="factory-action-title">
    <div className="factory-action-head"><div><div className="eyebrow">CONNECTION ACTION // CONSTRUCTION</div><h2 ref={headingRef} id="factory-action-title" tabIndex={-1}>Build at {locationName(view, reward)}</h2><p>Install held modules now, or keep them for a later connection. Placement and module order are permanent.</p></div><ResourceStrip resources={self.resources} /></div>
    {self.heldModules.length > 0 ? <div className="blueprint-grid">{self.heldModules.map((module) => {
      const definition = getModuleDefinition(module.definitionId);
      const options = constructionTargets(view, reward, module);
      const selected = options.find(({ key }) => key === targets[module.id])?.key ?? options[0]?.key ?? "";
      const affordable = canAffordMaterials(self.resources, definition.constructionCost, isExoplanet);
      return <article className={`module-blueprint ${definition.type}`} key={module.id}>
        <span className="blueprint-type">{definition.type}</span><h3>{definition.name}</h3>
        <div className="module-spec"><span>BUILD</span><CostLine cost={definition.constructionCost} teamSurcharge={isExoplanet} /></div>
        <label>Install into<select aria-label={`Factory target for ${definition.name}`} value={selected} disabled={unavailable || options.length === 0} onChange={(event) => setTargets((current) => ({ ...current, [module.id]: event.target.value }))}>{options.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}</select></label>
        <button className="construct-button" disabled={unavailable || !affordable || options.length === 0} onClick={(event) => {
          if (document.activeElement === event.currentTarget) focusedModuleId.current = module.id;
          construct(module, options);
        }}>{pending === `Constructing ${definition.name}` ? "Constructing…" : affordable ? `Construct ${definition.name}` : "Resources required"}</button>
      </article>;
    })}</div> : <div className="factory-empty"><strong>All held modules installed</strong><p>No modules remain in your inventory.</p></div>}
    <div className="factory-action-footer"><button className="quiet-button" disabled={unavailable} onClick={() => run("Finishing connection", (callback) => socket.emit("connection:finish", {}, callback))}>Finish without production</button><button className="primary-button" disabled={unavailable} onClick={() => run("Starting production", (callback) => socket.emit("production:begin", {}, callback))}>{pending === "Starting production" ? "Starting…" : "Continue to production"}<span aria-hidden="true">→</span></button></div>
  </section>;
}

function canRun(resources: ResourceBalances, factory: Factory, moduleIndex: number, multiplier: number): boolean {
  const module = factory.modules[moduleIndex];
  if (!module) return false;
  const definition = getModuleDefinition(module.definitionId);
  return resources.dollars >= definition.runningCost * multiplier && canAffordMaterials(resources, definition.inputs);
}

function ProductionPanel({ socket, view, unavailable, pending, run, reward }: FactoryPanelProps & { reward: ConnectionRewardState }) {
  const self = view.lobby.game!.players[view.self.playerId]!;
  const factories = locationFactories(view, reward);
  const nextMultiplier = reward.completedFactoryIds.length + 1;
  const panelRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const focusedFactoryId = useRef<string | null>(null);

  useEffect(() => {
    const factoryId = focusedFactoryId.current;
    if (!factoryId || !reward.completedFactoryIds.includes(factoryId)) return;
    focusedFactoryId.current = null;
    if (document.activeElement !== document.body) return;
    const nextAction = panelRef.current?.querySelector<HTMLButtonElement>(".run-controls button:not(:disabled)");
    (nextAction ?? headingRef.current)?.focus();
  }, [reward.completedFactoryIds]);

  return <section ref={panelRef} className="panel factory-action-panel" aria-labelledby="factory-action-title">
    <div className="factory-action-head"><div><div className="eyebrow">CONNECTION ACTION // PRODUCTION</div><h2 ref={headingRef} id="factory-action-title" tabIndex={-1}>Operate {locationName(view, reward)}</h2><p>Choose any unrun factory. Its multiplier applies to dollar running costs only; outputs are available immediately.</p></div><ResourceStrip resources={self.resources} /></div>
    {factories.length ? <div className="factory-run-grid">{factories.map((factory, placementIndex) => {
      const completed = reward.completedFactoryIds.includes(factory.id);
      const active = reward.activeFactory?.factoryId === factory.id;
      const blocked = Boolean(reward.activeFactory && !active);
      const moduleIndex = active ? reward.activeFactory!.nextModuleIndex : 0;
      const multiplier = active ? reward.activeFactory!.multiplier : nextMultiplier;
      const module = factory.modules[moduleIndex];
      const definition = module ? getModuleDefinition(module.definitionId) : null;
      const affordable = canRun(self.resources, factory, moduleIndex, multiplier);
      return <article className={`factory-run-card ${active ? "active" : ""} ${completed ? "completed" : ""}`} key={factory.id}>
        <header><div><span>FACTORY {String(placementIndex + 1).padStart(2, "0")}</span><h3>{factory.type}</h3></div><strong>{completed ? "DONE" : `${multiplier}×`}</strong></header>
        <ol>{factory.modules.map((factoryModule, index) => <li className={active && index === moduleIndex ? "next" : ""} key={factoryModule.id}><span>{String(index + 1).padStart(2, "0")}</span><div><strong>{getModuleDefinition(factoryModule.definitionId).name}</strong><small>Owned by {view.lobby.players[factoryModule.ownerId ?? ""]?.name ?? "Unowned"}</small></div></li>)}</ol>
        {!completed && definition && <div className="run-controls"><div><span>NEXT RUN</span><strong>{definition.name}</strong><small>${definition.runningCost * multiplier} + <CostLine cost={definition.inputs} /></small></div><button aria-label={`Run ${definition.name} in factory ${placementIndex + 1} at ${multiplier}x`} disabled={unavailable || blocked || !affordable} onClick={(event) => {
          if (document.activeElement === event.currentTarget) focusedFactoryId.current = factory.id;
          run(`Running ${definition.name}`, (callback) => socket.emit("production:run", { factoryId: factory.id }, callback));
        }}>{pending === `Running ${definition.name}` ? "Running…" : blocked ? "Finish active factory" : affordable ? "Run module" : "Cannot afford"}</button></div>}
        {active && <button className="stop-factory" disabled={unavailable} onClick={(event) => {
          if (document.activeElement === event.currentTarget) focusedFactoryId.current = factory.id;
          run("Stopping factory", (callback) => socket.emit("production:stop-factory", {}, callback));
        }}>Stop this factory</button>}
      </article>;
    })}</div> : <div className="factory-empty"><strong>No factories at this connection</strong><p>Finish the connection or return to construction on a later visit.</p></div>}
    <div className="factory-action-footer production-finish"><span>{reward.completedFactoryIds.length} factories operated</span><button className="primary-button light" disabled={unavailable || Boolean(reward.activeFactory)} onClick={() => run("Finishing connection", (callback) => socket.emit("connection:finish", {}, callback))}>{pending === "Finishing connection" ? "Finishing…" : "Finish connection"}<span aria-hidden="true">→</span></button></div>
  </section>;
}

export function ConnectionRewardPanel(props: FactoryPanelProps) {
  const game = props.view.lobby.game;
  const reward = game?.connectionRewards[props.view.self.playerId];
  if (!game || game.phase !== "connection-rewards") return null;
  if (!reward) {
    return <section className="panel reward-waiting"><div className="orbit" aria-hidden="true"><i /></div><h2>Connection actions underway</h2><p>You have no factory action from this connection. Waiting for the connected operators.</p><RewardProgress view={props.view} /></section>;
  }
  if (reward.stage === "complete") {
    return <section className="panel reward-waiting"><span className="complete-mark" aria-hidden="true">✓</span><h2>Connection complete</h2><p>Your factories and balances are locked in. Waiting for the other connected operators.</p><RewardProgress view={props.view} /></section>;
  }
  return reward.stage === "construction"
    ? <ConstructionPanel {...props} reward={reward} />
    : <ProductionPanel {...props} reward={reward} />;
}

function RewardProgress({ view }: { view: LobbyView }) {
  const rewards = Object.values(view.lobby.game?.connectionRewards ?? {});
  const complete = rewards.filter((reward) => reward?.stage === "complete").length;
  return <div className="reward-progress"><span>{complete} / {rewards.length} complete</span><i style={{ width: `${rewards.length ? complete / rewards.length * 100 : 100}%` }} /></div>;
}

function ResourceStrip({ resources }: { resources: ResourceBalances }) {
  return <div className="resource-strip" aria-label="Resource balance">{Object.entries(resources).map(([resource, amount]) => <span key={resource}><small>{resourceLabels[resource as keyof ResourceBalances]}</small><strong>{amount}</strong></span>)}</div>;
}

function FactoryStack({ factory, index }: { factory: Factory; index: number }) {
  return <div className={`factory-stack ${factory.type}`}><span>{String(index + 1).padStart(2, "0")} · {factory.type}</span><div>{factory.modules.map((module) => <b key={module.id}>{getModuleDefinition(module.definitionId).name}</b>)}</div></div>;
}

export function InfrastructurePanel({ view }: { view: LobbyView }) {
  const game = view.lobby.game;
  if (!game) return null;
  return <section className="panel infrastructure-panel"><div className="section-title"><div><div className="eyebrow">PUBLIC // PRODUCTION NETWORK</div><h2>Factories and balances</h2></div><span className="network-count">{game.playerOrder.reduce((count, playerId) => count + (game.players[playerId]?.homeFactories.length ?? 0), 0) + game.exoplanets.reduce((count, exoplanet) => count + exoplanet.factorySlots.filter(Boolean).length, 0)} FACTORIES</span></div>
    <div className="infrastructure-grid">{game.playerOrder.map((playerId) => {
      const player = game.players[playerId]!;
      return <article key={playerId}><header><div><span>HOME PLANET</span><h3>{view.lobby.players[playerId]?.name}</h3></div><small>{player.heldModules.length} held</small></header><ResourceStrip resources={player.resources} /><div className="factory-stacks">{player.homeFactories.length ? player.homeFactories.map((factory, index) => <FactoryStack key={factory.id} factory={factory} index={index} />) : <span className="empty-slot">No factories</span>}</div></article>;
    })}</div>
    <div className="exoplanet-infrastructure">{game.exoplanets.map((exoplanet) => <article key={exoplanet.id}><header><span>EXOPLANET</span><h3>{exoplanet.name}</h3></header><div className="factory-stacks">{exoplanet.factorySlots.map((factory, index) => factory ? <FactoryStack key={factory.id} factory={factory} index={index} /> : <span className="empty-slot" key={index}>Slot {index + 1} · Empty</span>)}</div></article>)}</div>
  </section>;
}
