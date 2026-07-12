import {
  useEffect,
  useId,
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
  const markerId = `gesture-arrow-${useId().replaceAll(":", "")}`;
  const targets = useMemo(() => positionedTargets(view), [view]);
  const self = view.lobby.players[view.self.playerId];

  viewRef.current = view;
  mutedRef.current = muted;

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
  const signalEvents = activeEvents.flatMap((event) => {
    const from = pointForPlayer(view, targets, event.senderPlayerId);
    const to = pointForTarget(view, targets, event.target);
    return from && to ? [{ event, from, to }] : [];
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
    <div className="comms-orbit">
      <svg className="gesture-signals" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <defs><marker id={markerId} markerWidth="5" markerHeight="5" refX="4" refY="2.5" orient="auto"><path d="M0,0 L5,2.5 L0,5 z" /></marker></defs>
        <ellipse className="orbit-path" cx="50" cy="49" rx="43" ry="36" />
        {signalEvents.map(({ event, from, to }) => <g className="gesture-signal" key={event.id}>
          <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} markerEnd={`url(#${markerId})`} />
        </g>)}
      </svg>
      {signalEvents.map(({ event, from, to }) => <span
        className="gesture-signal-badge"
        style={{ left: `${(from.x + to.x) / 2}%`, top: `${(from.y + to.y) / 2}%` }}
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
