import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";

import {
  gameFeatures,
  type CommandError,
  type CommandResult,
  type Connection,
  type GameFeature,
  type LobbyView,
  type PlayerId,
  type PlayerResult,
  type SelectionCard,
  type SessionData,
} from "@stargate-inc/shared";

import { createGameSocket, type GameSocket } from "./socket.js";

interface SavedSession {
  lobbyId: string;
  playerId: string;
  reconnectToken: string;
}

type ConnectionState = "connecting" | "online" | "offline" | "reconnecting";

const sessionKey = "stargate-inc-session-v1";

function loadSession(): SavedSession | null {
  try {
    const value = localStorage.getItem(sessionKey);
    if (!value) return null;
    const parsed = JSON.parse(value) as Partial<SavedSession>;
    return parsed.lobbyId && parsed.playerId && parsed.reconnectToken
      ? (parsed as SavedSession)
      : null;
  } catch {
    return null;
  }
}

function saveSession(data: SessionData): SavedSession {
  const saved = {
    lobbyId: data.state.lobby.id,
    playerId: data.state.self.playerId,
    reconnectToken: data.reconnectToken,
  };
  localStorage.setItem(sessionKey, JSON.stringify(saved));
  return saved;
}

function clearSession(): void {
  localStorage.removeItem(sessionKey);
}

function initialJoinCode(): string {
  return new URLSearchParams(window.location.search).get("join")?.toUpperCase() ?? "";
}

function playerName(view: LobbyView, playerId: PlayerId): string {
  return view.lobby.players[playerId]?.name ?? "Unknown player";
}

function cardLabel(view: LobbyView, card: SelectionCard): string {
  if (card.kind === "pause") return "Pause";
  if (card.kind === "player") return playerName(view, card.targetPlayerId);
  return view.lobby.game?.exoplanets.find(({ id }) => id === card.targetExoplanetId)?.name ?? "Unknown exoplanet";
}

function cardKindLabel(card: SelectionCard): string {
  if (card.kind === "player") return "Player";
  if (card.kind === "exoplanet") return "Exoplanet";
  return "Wait and see";
}

function connectionLabel(view: LobbyView, connection: Connection): string {
  if (connection.kind === "player") {
    return `${playerName(view, connection.playerIds[0])} ↔ ${playerName(view, connection.playerIds[1])}`;
  }
  if (connection.kind === "self") {
    return `${playerName(view, connection.playerId)} connected to themself`;
  }
  const exoplanet = view.lobby.game?.exoplanets.find(({ id }) => id === connection.exoplanetId)?.name ?? "an exoplanet";
  return `${playerName(view, connection.playerId)} → ${exoplanet}`;
}

function resultLabel(view: LobbyView, playerId: PlayerId, result: PlayerResult): string {
  if (result.status === "connected") return connectionLabel(view, result.connection);
  const reasons = {
    "player-choice-not-mutual": "Their player choice was not mutual",
    "exoplanet-contested": "Their exoplanet was contested",
    "exoplanet-already-claimed": "Their exoplanet was already claimed",
  } as const;
  return `${playerName(view, playerId)} failed — ${reasons[result.reason]}`;
}

function commandError(result: CommandResult<unknown>): CommandError | null {
  return result.ok ? null : result.error;
}

export interface AppProps {
  socket?: GameSocket;
}

export function App({ socket: suppliedSocket }: AppProps) {
  const socket = useMemo(() => suppliedSocket ?? createGameSocket(), [suppliedSocket]);
  const [view, setView] = useState<LobbyView | null>(null);
  const [savedSession, setSavedSession] = useState<SavedSession | null>(() => loadSession());
  const sessionRef = useRef(savedSession);
  const [connection, setConnection] = useState<ConnectionState>(socket.connected ? "online" : "connecting");
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [replaced, setReplaced] = useState(false);
  const [rulebookOpen, setRulebookOpen] = useState(false);
  const errorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let reconnecting = false;

    const reconnect = () => {
      const currentSession = sessionRef.current;
      if (!currentSession) {
        setConnection("online");
        return;
      }
      reconnecting = true;
      setConnection("reconnecting");
      socket.emit("lobby:reconnect", currentSession, (result) => {
        reconnecting = false;
        if (result.ok) {
          setView(result.data.state);
          const nextSession = saveSession(result.data);
          sessionRef.current = nextSession;
          setSavedSession(nextSession);
          setConnection("online");
          setError(null);
        } else {
          setConnection("online");
          if (result.error.code === "invalid-credentials" || result.error.code === "lobby-not-found") {
            clearSession();
            sessionRef.current = null;
            setSavedSession(null);
            setView(null);
            setError("That saved game is no longer available. Create or join a lobby to continue.");
          } else {
            setError(result.error.message);
          }
        }
      });
    };
    const onDisconnect = () => {
      setConnection("offline");
      setPending(null);
    };
    const onReconnectAttempt = () => setConnection("reconnecting");
    const onState = (state: LobbyView) => {
      setView(state);
      if (!reconnecting) setConnection("online");
    };
    const onReplaced = () => {
      clearSession();
      sessionRef.current = null;
      setSavedSession(null);
      setView(null);
      setReplaced(true);
      setError("This seat was opened in another browser, so this tab was disconnected.");
    };
    const onConnectError = (connectError: Error) => {
      setConnection("offline");
      setError(connectError.message || "Could not reach the game server.");
    };

    socket.on("connect", reconnect);
    socket.on("disconnect", onDisconnect);
    socket.on("lobby:state", onState);
    socket.on("session:replaced", onReplaced);
    socket.on("connect_error", onConnectError);
    socket.io.on("reconnect_attempt", onReconnectAttempt);
    if (socket.connected) reconnect();

    return () => {
      socket.off("connect", reconnect);
      socket.off("disconnect", onDisconnect);
      socket.off("lobby:state", onState);
      socket.off("session:replaced", onReplaced);
      socket.off("connect_error", onConnectError);
      socket.io.off("reconnect_attempt", onReconnectAttempt);
      if (!suppliedSocket) socket.disconnect();
    };
  }, [socket, suppliedSocket]);

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  const run = <T,>(label: string, send: (callback: (result: CommandResult<T>) => void) => void, onSuccess?: (data: T) => void) => {
    if (!socket.connected) {
      setError("You are offline. Your action was not sent; wait for reconnection and try again.");
      return;
    }
    setPending(label);
    setError(null);
    send((result) => {
      setPending(null);
      const failure = commandError(result);
      if (failure) {
        setError(failure.message);
      } else if (result.ok) {
        onSuccess?.(result.data);
      }
    });
  };

  const openRulebook = () => setRulebookOpen(true);
  const closeRulebook = () => setRulebookOpen(false);
  const unavailable = connection !== "online" || pending !== null;

  return (
    <div className="app-shell">
      <header className="site-header">
        <a className="brand" href="/" aria-label="Stargate Inc. home">
          <span className="brand-mark" aria-hidden="true">S</span>
          <span>Stargate <i>Inc.</i></span>
        </a>
        <nav aria-label="Application">
          <button className="text-button" type="button" onClick={openRulebook}>Rulebook</button>
          <ConnectionBadge state={connection} />
        </nav>
      </header>

      <div className="live-region" role="status" aria-live="polite" aria-atomic="true">
        {pending ? `${pending}…` : connection === "reconnecting" ? "Reconnecting to your game…" : connection === "offline" ? "Disconnected from the server." : ""}
      </div>

      {error && <div className="error-banner" role="alert" tabIndex={-1} ref={errorRef}><strong>Couldn’t complete that action.</strong> {error}<button aria-label="Dismiss error" onClick={() => setError(null)}>×</button></div>}

      {replaced ? (
        <main className="center-stage"><EmptyState title="Seat moved" body="This seat is active in another browser. Return home to join with a different seat." action={<button className="primary-button" onClick={() => { setReplaced(false); setError(null); }}>Return home</button>} /></main>
      ) : view ? (
        view.lobby.status === "waiting"
          ? <LobbyScreen socket={socket} view={view} unavailable={unavailable} pending={pending} run={run} />
          : <GameScreen socket={socket} view={view} unavailable={unavailable} pending={pending} run={run} />
      ) : (
        <WelcomeScreen socket={socket} unavailable={unavailable} pending={pending} run={run} onSession={(data) => { const nextSession = saveSession(data); sessionRef.current = nextSession; setView(data.state); setSavedSession(nextSession); }} openRulebook={openRulebook} />
      )}

      <footer><span>STARGATE INC. // CONNECTION PROTOCOL</span><button className="text-button" onClick={openRulebook}>Rules &amp; feature status</button></footer>
      {rulebookOpen && <Rulebook onClose={closeRulebook} />}
    </div>
  );
}

function ConnectionBadge({ state }: { state: ConnectionState }) {
  const labels = { connecting: "Connecting", online: "Online", offline: "Offline", reconnecting: "Reconnecting" };
  return <span className={`connection-badge ${state}`}><span aria-hidden="true" />{labels[state]}</span>;
}

interface RunCommand {
  <T>(label: string, send: (callback: (result: CommandResult<T>) => void) => void, onSuccess?: (data: T) => void): void;
}

function WelcomeScreen({ socket, unavailable, pending, run, onSession, openRulebook }: { socket: GameSocket; unavailable: boolean; pending: string | null; run: RunCommand; onSession: (data: SessionData) => void; openRulebook: () => void }) {
  const [name, setName] = useState("");
  const [joinCode, setJoinCode] = useState(initialJoinCode);
  const submitCreate = (event: FormEvent) => {
    event.preventDefault();
    run("Creating lobby", (callback) => socket.emit("lobby:create", { name }, callback), onSession);
  };
  const submitJoin = (event: FormEvent) => {
    event.preventDefault();
    run("Joining lobby", (callback) => socket.emit("lobby:join", { name, joinCode }, callback), onSession);
  };

  return <main>
    <section className="hero">
      <div className="eyebrow">LIVE MULTIPLAYER // 3–8 PLAYERS</div>
      <h1>Build the connection.<br /><em>Read the room.</em></h1>
      <p>Secret choices. Simultaneous reveals. One shared game state—wherever your table happens to be.</p>
      <button className="rule-link" type="button" onClick={openRulebook}>What can I play right now? <span aria-hidden="true">→</span></button>
    </section>
    <section className="entry-grid" aria-label="Start playing">
      <form className="panel entry-panel" onSubmit={submitCreate}>
        <div className="panel-number" aria-hidden="true">01</div>
        <div><div className="eyebrow">NEW SESSION</div><h2>Create a lobby</h2><p>Host a private room and invite your crew.</p></div>
        <label>Your callsign<input autoComplete="nickname" maxLength={32} required value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Nova Prime" /></label>
        <button className="primary-button" disabled={unavailable || !name.trim()}>{pending === "Creating lobby" ? "Opening channel…" : "Create lobby"}<span aria-hidden="true">→</span></button>
      </form>
      <form className="panel entry-panel accent" onSubmit={submitJoin}>
        <div className="panel-number" aria-hidden="true">02</div>
        <div><div className="eyebrow">EXISTING SESSION</div><h2>Join a lobby</h2><p>Enter the invite code from your host.</p></div>
        <label>Your callsign<input autoComplete="nickname" maxLength={32} required value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Vega Station" /></label>
        <label>Invite code<input className="code-input" autoCapitalize="characters" autoComplete="off" maxLength={10} minLength={10} required value={joinCode} onChange={(event) => setJoinCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} placeholder="XXXXXXXXXX" /></label>
        <button className="primary-button light" disabled={unavailable || !name.trim() || joinCode.length !== 10}>{pending === "Joining lobby" ? "Joining channel…" : "Join lobby"}<span aria-hidden="true">→</span></button>
      </form>
    </section>
    <section className="manifest-strip" aria-label="Current game scope"><div><strong>Playable now</strong><span>Connection-selection rounds</span></div><div><strong>Always online</strong><span>Secure reconnect to your seat</span></div><div><strong>In development</strong><span>Rewards, economy &amp; full game</span></div></section>
  </main>;
}

function LobbyScreen({ socket, view, unavailable, pending, run }: { socket: GameSocket; view: LobbyView; unavailable: boolean; pending: string | null; run: RunCommand }) {
  const players = Object.values(view.lobby.players);
  const isHost = view.self.playerId === view.lobby.hostPlayerId;
  const canStart = players.length >= 3 && players.every(({ connected }) => connected);
  const inviteUrl = `${window.location.origin}${window.location.pathname}?join=${view.lobby.joinCode}`;
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      window.setTimeout(() => setCopied(null), 2_000);
    } catch {
      setCopied("Copy unavailable — select the text instead");
    }
  };
  return <main className="lobby-layout">
    <section className="lobby-heading"><div className="eyebrow">PRIVATE LOBBY // WAITING ROOM</div><h1>Assemble your <em>network.</em></h1><p>Share the code. The host can start once 3–8 players are connected.</p></section>
    <section className="panel invite-panel" aria-labelledby="invite-title"><div><div className="eyebrow">INVITE CODE</div><h2 id="invite-title" className="invite-code">{view.lobby.joinCode}</h2></div><button className="copy-button" onClick={() => void copy(view.lobby.joinCode, "Code copied")}>Copy code</button><div className="invite-link"><span>{inviteUrl}</span><button onClick={() => void copy(inviteUrl, "Link copied")} aria-label="Copy invite link">Copy link</button></div><div className="copy-status" role="status" aria-live="polite">{copied}</div></section>
    <section className="panel roster-panel" aria-labelledby="roster-title"><div className="section-title"><div><div className="eyebrow">CREW ROSTER</div><h2 id="roster-title">{players.length} / 8 connected</h2></div><span className="pulse-label"><i />LIVE</span></div><ul>{players.map((player, index) => <li key={player.id}><span className="avatar">{String(index + 1).padStart(2, "0")}</span><strong>{player.name}{player.id === view.self.playerId && <small> YOU</small>}</strong>{player.id === view.lobby.hostPlayerId && <span className="host-label">HOST</span>}<span className={player.connected ? "player-online" : "player-offline"}>{player.connected ? "Connected" : "Disconnected"}</span></li>)}</ul></section>
    <aside className="start-panel panel"><div><div className="eyebrow">HOST CONTROLS</div><h2>{isHost ? "Ready to launch?" : "Waiting for host"}</h2><p>{players.length < 3 ? `${3 - players.length} more ${3 - players.length === 1 ? "player" : "players"} needed.` : !players.every(({ connected }) => connected) ? "All players must reconnect first." : "All connected. The round can begin."}</p></div>{isHost ? <button className="primary-button" disabled={unavailable || !canStart} onClick={() => run("Starting game", (callback) => socket.emit("game:start", {}, callback))}>{pending === "Starting game" ? "Launching…" : `Start game · ${players.length} players`}<span aria-hidden="true">→</span></button> : <div className="waiting-indicator"><span /><span /><span />Standing by</div>}</aside>
  </main>;
}

function GameScreen({ socket, view, unavailable, pending, run }: { socket: GameSocket; view: LobbyView; unavailable: boolean; pending: string | null; run: RunCommand }) {
  const game = view.lobby.game;
  if (!game || !view.self.hand) return <main className="center-stage"><EmptyState title="Loading game" body="Waiting for the server to send your private hand." /></main>;
  const round = game.round;
  const selfSubmitted = round.phase === "initial-selection" ? Boolean(view.self.initialSelectionCardId) : round.phase === "pause-selection" ? Boolean(view.self.pauseSelectionCardId) : false;
  const isPausePlayer = round.pausePlayerIds.includes(view.self.playerId);
  const mayChoose = round.phase === "initial-selection" || (round.phase === "pause-selection" && isPausePlayer);
  const eligibleCards = round.phase === "pause-selection" ? view.self.hand.filter(({ kind }) => kind !== "pause") : view.self.hand;
  const submittedCount = round.phase === "initial-selection" ? round.initialSelectionsSubmittedBy.length : round.pauseSelectionsSubmittedBy.length;
  const expectedCount = round.phase === "initial-selection" ? game.playerOrder.length : round.pausePlayerIds.length;
  const phaseTitle = round.phase === "initial-selection" ? "Choose your connection" : round.phase === "pause-selection" ? isPausePlayer ? "Choose after the pause" : "Pause players are choosing" : "Connections resolved";
  const phaseBody = round.phase === "initial-selection" ? "Your choice stays secret until everyone has locked in." : round.phase === "pause-selection" ? "Initial choices are revealed. Pause follow-ups remain secret until all pause players submit." : "Review the network outcome, then begin another round.";

  const submit = (card: SelectionCard) => {
    if (round.phase === "pause-selection") {
      run("Locking selection", (callback) => socket.emit("selection:pause", { cardId: card.id }, callback));
    } else {
      run("Locking selection", (callback) => socket.emit("selection:initial", { cardId: card.id }, callback));
    }
  };

  return <main className="game-layout">
    <section className="game-heading"><div><div className="eyebrow">ROUND {String(round.number).padStart(2, "0")} // {round.phase.replace("-", " ").toUpperCase()}</div><h1>{phaseTitle}</h1><p>{phaseBody}</p></div><div className="submission-meter" aria-label={`${submittedCount} of ${expectedCount} selections submitted`}><strong>{submittedCount}/{expectedCount}</strong><span>LOCKED IN</span><div><i style={{ width: `${expectedCount ? submittedCount / expectedCount * 100 : 0}%` }} /></div></div></section>
    {mayChoose && <section className="panel hand-panel" aria-labelledby="hand-title"><div className="section-title"><div><div className="eyebrow">PRIVATE // ONLY YOU CAN SEE THIS</div><h2 id="hand-title">Your hand</h2></div>{selfSubmitted && <span className="locked-label">✓ Selection locked</span>}</div>{eligibleCards.length ? <div className="card-grid">{eligibleCards.map((card) => <button className={`game-card ${card.kind} ${selfSubmitted && ((view.self.initialSelectionCardId ?? view.self.pauseSelectionCardId) === card.id) ? "selected" : ""}`} key={card.id} disabled={unavailable || selfSubmitted} onClick={() => submit(card)}><span className="card-type">{cardKindLabel(card)}</span><strong>{cardLabel(view, card)}</strong><small>{card.kind === "pause" ? "Reveal after the others" : card.kind === "player" && card.targetPlayerId === view.self.playerId ? "Return played cards to hand" : "Attempt connection"}</small><span className="card-action">{selfSubmitted && ((view.self.initialSelectionCardId ?? view.self.pauseSelectionCardId) === card.id) ? "Locked" : "Select"}</span></button>)}</div> : <EmptyState title="No target cards left" body="Your hand has no valid choice for this phase." />}</section>}
    {!mayChoose && round.phase !== "resolved" && <section className="panel waiting-panel"><div className="orbit" aria-hidden="true"><i /></div><h2>{selfSubmitted || !isPausePlayer ? "Choice secured" : "Waiting for your turn"}</h2><p>Waiting for {Math.max(0, expectedCount - submittedCount)} {Math.max(0, expectedCount - submittedCount) === 1 ? "player" : "players"} to submit.</p></section>}
    {round.revealedInitialSelections && <RevealPanel title="Initial reveal" selections={round.revealedInitialSelections} view={view} />}
    {round.revealedPauseSelections && <RevealPanel title="Pause reveal" selections={round.revealedPauseSelections} view={view} />}
    {round.resolution && <ResultsPanel view={view} />}
    <PlayerStatePanel view={view} />
    {round.phase === "resolved" && <section className="next-round"><div><div className="eyebrow">KEEP THE NETWORK MOVING</div><h2>Ready for round {round.number + 1}?</h2></div><button className="primary-button light" disabled={unavailable} onClick={() => run("Starting next round", (callback) => socket.emit("round:next", {}, callback))}>{pending === "Starting next round" ? "Starting…" : "Next round"}<span aria-hidden="true">→</span></button></section>}
  </main>;
}

function RevealPanel({ title, selections, view }: { title: string; selections: Record<PlayerId, SelectionCard>; view: LobbyView }) {
  return <section className="panel reveal-panel"><div className="eyebrow">{title.toUpperCase()}</div><h2>Choices on the table</h2><ul>{Object.entries(selections).map(([playerId, card]) => <li key={playerId}><strong>{playerName(view, playerId)}</strong><span aria-hidden="true">→</span><b>{cardLabel(view, card)}</b><small>{cardKindLabel(card)}</small></li>)}</ul></section>;
}

function ResultsPanel({ view }: { view: LobbyView }) {
  const resolution = view.lobby.game?.round.resolution;
  if (!resolution) return null;
  return <section className="panel results-panel"><div className="eyebrow">ROUND OUTCOME</div><h2>Connection report</h2><ul>{Object.entries(resolution.playerResults).map(([playerId, result]) => <li className={result.status} key={playerId}><span aria-hidden="true">{result.status === "connected" ? "✓" : "×"}</span><div><strong>{resultLabel(view, playerId, result)}</strong><small>{result.status === "connected" ? `${result.connection.step} selection` : "Compensation reward unresolved"}</small></div></li>)}</ul>{resolution.unresolvedEffects.length > 0 && <div className="unresolved-callout"><strong>Reward step not yet playable</strong><p>The connection result is final. Trade, production, and compensation rewards remain unresolved in the current rules.</p></div>}</section>;
}

function PlayerStatePanel({ view }: { view: LobbyView }) {
  const game = view.lobby.game;
  if (!game || !view.self.hand) return null;
  const playedCount = Object.values(game.players).reduce((total, player) => total + player.playedCards.length, 0);
  return <section className="state-grid"><div className="panel compact"><div className="eyebrow">PRIVATE // AVAILABLE</div><h2>Your hand · {view.self.hand.length}</h2><div className="mini-cards">{view.self.hand.map((card) => <span key={card.id}>{cardLabel(view, card)}</span>)}</div></div><div className="panel compact"><div className="eyebrow">PUBLIC // FACE UP</div><h2>Played cards · {playedCount}</h2>{playedCount ? <div className="played-groups">{game.playerOrder.map((playerId) => { const cards = game.players[playerId]?.playedCards ?? []; return cards.length ? <div key={playerId}><strong>{playerName(view, playerId)}</strong><div className="mini-cards played">{cards.map((card) => <span key={card.id}>{cardLabel(view, card)}</span>)}</div></div> : null; })}</div> : <p className="empty-copy">No cards played yet.</p>}</div></section>;
}

function Rulebook({ onClose }: { onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const areas: Array<{ id: GameFeature["area"]; name: string }> = [
    { id: "online-play", name: "Online play" },
    { id: "connection-round", name: "Connection round" },
    { id: "rewards", name: "Rewards" },
    { id: "full-game", name: "Full game" },
  ];
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="rulebook" role="dialog" aria-modal="true" aria-labelledby="rulebook-title"><header><div><div className="eyebrow">LIVE RULEBOOK // FEATURE MANIFEST</div><h1 id="rulebook-title">What you can play</h1><p>This rulebook is generated from the same feature list as the game. Status changes ship with the rules.</p></div><button ref={closeRef} onClick={onClose} aria-label="Close rulebook">×</button></header><div className="legend"><span className="playable">Playable</span><span className="unresolved">Unresolved</span><span className="planned">Planned</span></div>{areas.map((area) => { const features = gameFeatures.filter((feature) => feature.area === area.id); if (!features.length) return null; return <section key={area.id}><h2>{area.name}</h2><div className="feature-list">{features.map((feature) => <article key={feature.id}><span className={feature.status}>{feature.status}</span><div><h3>{feature.name}</h3><p>{feature.rule}</p></div></article>)}</div></section>; })}<div className="scope-warning"><strong>Current playable scope</strong><p>You can complete repeated connection-selection rounds online. Rewards, economy, scoring, board play, and an end-game are not implemented or fully defined yet.</p></div></section></div>;
}

function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return <section className="empty-state"><div aria-hidden="true">◎</div><h1>{title}</h1><p>{body}</p>{action}</section>;
}
