import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";

import {
  exoplanetGestureKinds,
  playerGestureKinds,
  type ExoplanetGestureKind,
  type GestureCommand,
  type GestureEvent,
  type GestureTarget,
  type LobbyView,
  type PlayerGestureKind,
} from "@stargate-inc/shared";

import type { GameSocket } from "./socket.js";

const muteKey = "stargate-inc-gestures-muted-v1";
const gestureDurationMs = 4_000;
const gestureAcknowledgementTimeoutMs = 8_000;

const gestureDetails: Record<PlayerGestureKind | ExoplanetGestureKind, { label: string; icon: string; phrase: string }> = {
  beckon: { label: "Beckon", icon: "↝", phrase: "beckons to" },
  nod: { label: "Nod", icon: "⌄", phrase: "nods to" },
  shake: { label: "Shake head", icon: "↔", phrase: "shakes their head at" },
  shrug: { label: "Shrug", icon: "⌁", phrase: "shrugs at" },
  wave: { label: "Wave", icon: "◡", phrase: "waves to" },
  applaud: { label: "Applaud", icon: "✦", phrase: "applauds" },
  point: { label: "Point", icon: "☞", phrase: "points to" },
};

interface RingTargetBase {
  key: string;
  name: string;
  connected: boolean;
}

type UnpositionedRingTarget = RingTargetBase & (
  | { target: Extract<GestureTarget, { kind: "player" }>; type: "player" }
  | { target: Extract<GestureTarget, { kind: "exoplanet" }>; type: "exoplanet" }
);

interface Point {
  x: number;
  y: number;
}

interface OrbitSize {
  width: number;
  height: number;
}

interface SignalLayout {
  badge: Point;
  badgePixels: Point;
  lineFrom: Point;
  lineTo: Point;
}

type RingTarget = UnpositionedRingTarget & Point;

export interface CommsRingProps {
  socket: GameSocket;
  view: LobbyView;
  disabled: boolean;
  onError: (message: string | null) => void;
}

function readMuted(): boolean {
  try {
    return localStorage.getItem(muteKey) === "true";
  } catch {
    return false;
  }
}

function targetKey(target: GestureTarget): string {
  return target.kind === "player"
    ? `player:${target.playerId}`
    : `exoplanet:${target.exoplanetId}`;
}

function eventTargetName(view: LobbyView, event: GestureEvent): string {
  if (event.target.kind === "player") {
    return view.lobby.players[event.target.playerId]?.name ?? "an unavailable player";
  }
  const exoplanetId = event.target.exoplanetId;
  return view.lobby.game?.exoplanets.find(({ id }) => id === exoplanetId)?.name ?? "an unavailable exoplanet";
}

function eventAnnouncement(view: LobbyView, event: GestureEvent): string {
  const sender = view.lobby.players[event.senderPlayerId]?.name ?? "An unavailable player";
  const target = eventTargetName(view, event);
  return `${sender} ${gestureDetails[event.gesture].phrase} ${target}.`;
}

function positionedTargets(view: LobbyView): RingTarget[] {
  const playerOrder = view.lobby.game?.playerOrder ?? Object.keys(view.lobby.players);
  const orderedIds = [...playerOrder, ...Object.keys(view.lobby.players).filter((id) => !playerOrder.includes(id))];
  const targets: UnpositionedRingTarget[] = orderedIds
    .filter((id) => id !== view.self.playerId)
    .flatMap((id) => {
      const player = view.lobby.players[id];
      return player ? [{
        key: `player:${id}`,
        target: { kind: "player" as const, playerId: id },
        name: player.name,
        type: "player" as const,
        connected: player.connected,
      }] : [];
    });
  for (const exoplanet of view.lobby.game?.exoplanets ?? []) {
    targets.push({
      key: `exoplanet:${exoplanet.id}`,
      target: { kind: "exoplanet", exoplanetId: exoplanet.id },
      name: exoplanet.name,
      type: "exoplanet",
      connected: true,
    });
  }

  return targets.map((target, index) => {
    const angle = targets.length === 1
      ? 270
      : 150 + index * (240 / (targets.length - 1));
    const radians = angle * Math.PI / 180;
    return {
      ...target,
      x: 50 + 43 * Math.cos(radians),
      y: 49 + 36 * Math.sin(radians),
    };
  });
}

function pointForPlayer(view: LobbyView, targets: RingTarget[], playerId: string): Point | null {
  if (playerId === view.self.playerId) return { x: 50, y: 88 };
  const target = targets.find((candidate) => candidate.target.kind === "player" && candidate.target.playerId === playerId);
  return target ? { x: target.x, y: target.y } : null;
}

function pointForTarget(view: LobbyView, targets: RingTarget[], target: GestureTarget): Point | null {
  if (target.kind === "player" && target.playerId === view.self.playerId) {
    return { x: 50, y: 88 };
  }
  const match = targets.find((candidate) => candidate.key === targetKey(target));
  return match ? { x: match.x, y: match.y } : null;
}

const badgeOrbitRadius = 44;
const badgeTargetClearance = 53;
const badgeCollisionClearance = 35;
const beaconCollisionClearance = 44;
const badgeBoundaryClearance = 16;
const lineBadgeClearance = 18;
const lineTargetClearance = 29;

function rotate(point: Point, degrees: number): Point {
  const radians = degrees * Math.PI / 180;
  return {
    x: point.x * Math.cos(radians) - point.y * Math.sin(radians),
    y: point.x * Math.sin(radians) + point.y * Math.cos(radians),
  };
}

function badgeCandidates(from: Point, to: Point, direction: Point, distance: number, orbit: OrbitSize, needsPerpendicularRoute: boolean): Point[] {
  const offsets = Array.from({ length: 24 }, (_, index) => index * 15 - 180);
  offsets.sort((left, right) => {
    const preference = (offset: number) => needsPerpendicularRoute
      ? Math.min(Math.abs(offset - 90), Math.abs(offset + 90))
      : Math.abs(offset);
    return preference(left) - preference(right) || right - left;
  });
  return offsets.map((offset) => {
    const candidateDirection = rotate(direction, offset);
    const minimumCandidate = {
      x: from.x + candidateDirection.x * badgeOrbitRadius,
      y: from.y + candidateDirection.y * badgeOrbitRadius,
    };
    const minimumTargetDistance = Math.hypot(to.x - minimumCandidate.x, to.y - minimumCandidate.y);
    const cosine = direction.x * candidateDirection.x + direction.y * candidateDirection.y;
    const requiredRadius = minimumTargetDistance >= badgeTargetClearance
      ? badgeOrbitRadius
      : distance * cosine + Math.sqrt(Math.max(0, badgeTargetClearance ** 2 - distance ** 2 * (1 - cosine ** 2))) + .01;
    const radius = Math.max(badgeOrbitRadius, requiredRadius);
    return {
      x: from.x + candidateDirection.x * radius,
      y: from.y + candidateDirection.y * radius,
    };
  }).filter(({ x, y }) =>
    x >= badgeBoundaryClearance
    && x <= orbit.width - badgeBoundaryClearance
    && y >= badgeBoundaryClearance
    && y <= orbit.height - badgeBoundaryClearance,
  );
}

function signalLayout(from: Point, to: Point, orbit: OrbitSize, occupiedBadges: Point[], unrelatedBeacons: Point[]): SignalLayout | null {
  const fromPixels = { x: from.x * orbit.width / 100, y: from.y * orbit.height / 100 };
  const toPixels = { x: to.x * orbit.width / 100, y: to.y * orbit.height / 100 };
  const delta = { x: toPixels.x - fromPixels.x, y: toPixels.y - fromPixels.y };
  const distance = Math.hypot(delta.x, delta.y);
  if (distance < 1) return null;

  const direction = { x: delta.x / distance, y: delta.y / distance };
  const candidates = badgeCandidates(fromPixels, toPixels, direction, distance, orbit, distance - badgeOrbitRadius < badgeTargetClearance);
  const badgePixels = candidates.find((candidate) =>
    Math.hypot(toPixels.x - candidate.x, toPixels.y - candidate.y) >= badgeTargetClearance
    && occupiedBadges.every((occupied) => Math.hypot(occupied.x - candidate.x, occupied.y - candidate.y) >= badgeCollisionClearance)
    && unrelatedBeacons.every((beacon) => Math.hypot(beacon.x - candidate.x, beacon.y - candidate.y) >= beaconCollisionClearance),
  );
  if (!badgePixels) return null;

  const badgeToTarget = { x: toPixels.x - badgePixels.x, y: toPixels.y - badgePixels.y };
  const remainingDistance = Math.hypot(badgeToTarget.x, badgeToTarget.y);
  const lineDirection = {
    x: badgeToTarget.x / remainingDistance,
    y: badgeToTarget.y / remainingDistance,
  };
  const asPercent = (point: Point): Point => ({
    x: point.x / orbit.width * 100,
    y: point.y / orbit.height * 100,
  });

  return {
    badge: asPercent(badgePixels),
    badgePixels,
    lineFrom: asPercent({
      x: badgePixels.x + lineDirection.x * lineBadgeClearance,
      y: badgePixels.y + lineDirection.y * lineBadgeClearance,
    }),
    lineTo: asPercent({
      x: toPixels.x - lineDirection.x * lineTargetClearance,
      y: toPixels.y - lineDirection.y * lineTargetClearance,
    }),
  };
}

export function CommsRing({ socket, view, disabled, onError }: CommsRingProps) {
  const [selected, setSelected] = useState<RingTarget | null>(null);
  const [pending, setPending] = useState(false);
  const [muted, setMuted] = useState(readMuted);
  const [activeEvents, setActiveEvents] = useState<GestureEvent[]>([]);
  const [announcement, setAnnouncement] = useState<{ id: string; text: string } | null>(null);
  const viewRef = useRef(view);
  const mutedRef = useRef(muted);
  const eventTimers = useRef(new Map<string, number>());
  const acknowledgementTimer = useRef<number | null>(null);
  const acknowledgementId = useRef(0);
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const muteButtonRef = useRef<HTMLButtonElement | null>(null);
  const menuButtons = useRef<Array<HTMLButtonElement | null>>([]);
  const orbitRef = useRef<HTMLDivElement | null>(null);
  const [orbitSize, setOrbitSize] = useState<OrbitSize>({ width: 1_000, height: 390 });
  const markerId = `gesture-arrow-${useId().replaceAll(":", "")}`;
  const targets = useMemo(() => positionedTargets(view), [view]);
  const self = view.lobby.players[view.self.playerId];

  viewRef.current = view;
  mutedRef.current = muted;

  useLayoutEffect(() => {
    const orbit = orbitRef.current;
    if (!orbit) return;
    const measure = () => {
      const { width, height } = orbit.getBoundingClientRect();
      if (width > 0 && height > 0) {
        setOrbitSize((current) => current.width === width && current.height === height ? current : { width, height });
      }
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(orbit);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const onGesture = (event: GestureEvent) => {
      if (mutedRef.current || eventTimers.current.has(event.id)) return;
      const currentView = viewRef.current;
      const currentTargets = positionedTargets(currentView);
      if (!pointForPlayer(currentView, currentTargets, event.senderPlayerId) || !pointForTarget(currentView, currentTargets, event.target)) return;

      setActiveEvents((current) => [...current, event]);
      setAnnouncement({ id: event.id, text: eventAnnouncement(currentView, event) });
      const timer = window.setTimeout(() => {
        eventTimers.current.delete(event.id);
        setActiveEvents((current) => current.filter(({ id }) => id !== event.id));
      }, gestureDurationMs);
      eventTimers.current.set(event.id, timer);
    };

    socket.on("gesture:received", onGesture);
    return () => {
      socket.off("gesture:received", onGesture);
      for (const timer of eventTimers.current.values()) window.clearTimeout(timer);
      eventTimers.current.clear();
      if (acknowledgementTimer.current !== null) window.clearTimeout(acknowledgementTimer.current);
      acknowledgementTimer.current = null;
      acknowledgementId.current += 1;
      setActiveEvents([]);
      setPending(false);
    };
  }, [socket]);

  useEffect(() => {
    if (!selected) return;
    const stillAvailable = !disabled && targets.some(({ key, connected }) => key === selected.key && connected);
    if (!stillAvailable) {
      setSelected(null);
      window.requestAnimationFrame(() => muteButtonRef.current?.focus());
    }
  }, [disabled, selected, targets]);

  useEffect(() => {
    if (!selected) return;
    menuButtons.current[0]?.focus();
  }, [selected]);

  const toggleMuted = () => {
    const next = !muted;
    setMuted(next);
    mutedRef.current = next;
    try {
      localStorage.setItem(muteKey, String(next));
    } catch {
      // The preference still applies for this tab when storage is unavailable.
    }
    if (next) {
      for (const timer of eventTimers.current.values()) window.clearTimeout(timer);
      eventTimers.current.clear();
      setActiveEvents([]);
      setAnnouncement({ id: "muted", text: "Gestures muted." });
    } else {
      setAnnouncement({ id: "unmuted", text: "Gestures unmuted." });
    }
  };

  const openTarget = (target: RingTarget, button: HTMLButtonElement) => {
    if (pending) {
      setAnnouncement({ id: `pending:${acknowledgementId.current}`, text: "Waiting for gesture confirmation." });
      return;
    }
    openerRef.current = button;
    menuButtons.current = [];
    setSelected(target);
  };

  const closeMenu = () => {
    setSelected(null);
    window.requestAnimationFrame(() => openerRef.current?.focus());
  };

  const sendGesture = (command: GestureCommand) => {
    if (!selected || pending || disabled) return;
    const requestId = ++acknowledgementId.current;
    setPending(true);
    onError(null);
    acknowledgementTimer.current = window.setTimeout(() => {
      if (acknowledgementId.current !== requestId) return;
      acknowledgementTimer.current = null;
      acknowledgementId.current += 1;
      setPending(false);
      onError("Gesture confirmation timed out. Check your connection and try again.");
    }, gestureAcknowledgementTimeoutMs);
    socket.emit("gesture:send", command, (result) => {
      if (acknowledgementId.current !== requestId) return;
      if (acknowledgementTimer.current !== null) window.clearTimeout(acknowledgementTimer.current);
      acknowledgementTimer.current = null;
      setPending(false);
      if (!result.ok) onError(result.error.message);
    });
    closeMenu();
  };

  const gestureOptions = !selected ? [] : selected.type === "player"
    ? playerGestureKinds.map((gesture) => ({ gesture, command: { target: selected.target, gesture } }))
    : exoplanetGestureKinds.map((gesture) => ({ gesture, command: { target: selected.target, gesture } }));
  const activeTargetKeys = new Set(activeEvents.map(({ target }) => targetKey(target)));
  const selfReceiving = activeTargetKeys.has(`player:${view.self.playerId}`);
  const asPixels = (point: Point): Point => ({
    x: point.x * orbitSize.width / 100,
    y: point.y * orbitSize.height / 100,
  });
  const beaconCenters = new Map<string, Point>([
    [`player:${view.self.playerId}`, asPixels({ x: 50, y: 88 })],
    ...targets.map((target): [string, Point] => [target.key, asPixels(target)]),
  ]);
  const senderBadges = new Map<string, Point[]>();
  const signalEvents = activeEvents.flatMap((event) => {
    const from = pointForPlayer(view, targets, event.senderPlayerId);
    const to = pointForTarget(view, targets, event.target);
    if (!from || !to) return [];
    const occupiedBadges = senderBadges.get(event.senderPlayerId) ?? [];
    const senderKey = `player:${event.senderPlayerId}`;
    const eventTargetKey = targetKey(event.target);
    const unrelatedBeacons = [...beaconCenters.entries()]
      .filter(([key]) => key !== senderKey && key !== eventTargetKey)
      .map(([, point]) => point);
    const layout = signalLayout(from, to, orbitSize, occupiedBadges, unrelatedBeacons);
    if (layout) senderBadges.set(event.senderPlayerId, [...occupiedBadges, layout.badgePixels]);
    return layout ? [{ event, layout }] : [];
  });
  const onMenuKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeMenu();
      return;
    }
    const direction = event.key === "ArrowRight" || event.key === "ArrowDown"
      ? 1
      : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (!direction && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    const next = event.key === "Home"
      ? 0
      : event.key === "End"
        ? gestureOptions.length - 1
        : (index + direction + gestureOptions.length) % gestureOptions.length;
    menuButtons.current[next]?.focus();
  };

  return <section className="panel comms-ring" aria-labelledby="comms-ring-title">
    <header className="comms-ring-header">
      <div><div className="eyebrow">COMMS RING // PUBLIC SIGNALS</div><h2 id="comms-ring-title">Read the room</h2><p>Choose a beacon. Every signal is public and non-binding.</p></div>
      <button ref={muteButtonRef} className="gesture-mute" type="button" aria-pressed={muted} onClick={toggleMuted}><span aria-hidden="true">{muted ? "○" : "◉"}</span>{muted ? "Gestures muted" : "Mute gestures"}</button>
    </header>
    <div className="comms-orbit" ref={orbitRef}>
      <svg className="gesture-signals" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <defs><marker id={markerId} markerWidth="5" markerHeight="5" refX="4" refY="2.5" orient="auto"><path d="M0,0 L5,2.5 L0,5 z" /></marker></defs>
        <ellipse className="orbit-path" cx="50" cy="49" rx="43" ry="36" />
        {signalEvents.map(({ event, layout }) => <g className="gesture-signal" key={event.id}>
          <line x1={layout.lineFrom.x} y1={layout.lineFrom.y} x2={layout.lineTo.x} y2={layout.lineTo.y} markerEnd={`url(#${markerId})`} />
        </g>)}
      </svg>
      {signalEvents.map(({ event, layout }) => <span
        className="gesture-signal-badge"
        style={{ left: `${layout.badge.x}%`, top: `${layout.badge.y}%` }}
        aria-hidden="true"
        key={`badge:${event.id}`}
      >{gestureDetails[event.gesture].icon}</span>)}
      {targets.map((target, index) => {
        const style = { left: `${target.x}%`, top: `${target.y}%`, "--beacon-index": index } as CSSProperties;
        return <div className={`comms-target ${target.type} ${activeTargetKeys.has(target.key) ? "receiving" : ""}`} style={style} key={target.key}>
          <button
            type="button"
            className="beacon-button"
            disabled={disabled || !target.connected}
            aria-disabled={pending || undefined}
            aria-label={`Gesture to ${target.name}, ${target.connected ? target.type : "disconnected player"}`}
            aria-expanded={selected?.key === target.key}
            onClick={(event) => openTarget(target, event.currentTarget)}
          ><span className="beacon-core" aria-hidden="true">{target.type === "exoplanet" ? "◉" : String(index + 1).padStart(2, "0")}</span><strong>{target.name}</strong><small>{target.type === "exoplanet" ? "EXOPLANET" : target.connected ? "CONNECTED" : "DISCONNECTED"}</small></button>
          {selected?.key === target.key && <div className={`gesture-fan ${target.y > 65 ? "fan-above" : ""} ${target.x < 22 ? "fan-align-start" : target.x > 78 ? "fan-align-end" : ""}`} role="group" aria-label={`Choose gesture for ${target.name}`}>
            {gestureOptions.map(({ gesture, command }, gestureIndex) => <button
              type="button"
              key={gesture}
              ref={(button) => { menuButtons.current[gestureIndex] = button; }}
              disabled={pending || disabled}
              aria-label={`${gestureDetails[gesture].label} to ${target.name}`}
              onKeyDown={(event) => onMenuKeyDown(event, gestureIndex)}
              onClick={() => sendGesture(command)}
            ><span aria-hidden="true">{gestureDetails[gesture].icon}</span><small>{gestureDetails[gesture].label}</small></button>)}
          </div>}
        </div>;
      })}
      <div className={`comms-self ${selfReceiving ? "receiving" : ""}`} style={{ left: "50%", top: "88%" }}><span className="you-tag">YOU</span><span className="beacon-core" aria-hidden="true">◆</span><strong>{self?.name ?? "You"}</strong><small>ORIGIN</small></div>
    </div>
    <div className="live-region" role="status" aria-live="polite" aria-atomic="true">{announcement && <span key={announcement.id}>{announcement.text}</span>}</div>
  </section>;
}
