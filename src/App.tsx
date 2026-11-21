import { useCallback, useEffect, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import type { User } from "@supabase/supabase-js";
import { isSupabaseConfigured, supabase } from "./lib/supabase";

type Difficulty = "easy" | "medium" | "hard";

type Task = {
  id: string;
  title: string;
  description: string;
  difficulty: Difficulty;
  points: number;
  category?: string;
};

type TeamInfo = {
  team_id: string;
  team_name: string;
  game_id: string;
  game_name: string;
  game_status: "active" | "paused" | "completed";
};

type Claim = {
  task_id: string;
  team_id: string;
  awarded_points: number;
  claimed_at: string;
};

type LeaderboardRow = {
  team_id: string;
  team_name: string;
  score: number | string;
};

const difficultyLabel: Record<Difficulty, string> = {
  easy: "Makkelijk",
  medium: "Gemiddeld",
  hard: "Moeilijk",
};

const demoTasks: Task[] = [
  {
    id: "demo-1",
    title: "Teamfoto: overwinningspose",
    description: "Maak met het hele team een foto waarop iedereen een overwinningspose doet.",
    difficulty: "easy",
    points: 5,
    category: "Creatief",
  },
  {
    id: "demo-2",
    title: "Vind drie ronde voorwerpen",
    description: "Zoek drie ronde voorwerpen en leg ze samen op één foto vast.",
    difficulty: "easy",
    points: 10,
    category: "Zoeken",
  },
  {
    id: "demo-3",
    title: "Bouw een vrijstaande toren",
    description: "Bouw met maximaal tien voorwerpen de hoogste toren die zelfstandig blijft staan.",
    difficulty: "medium",
    points: 20,
    category: "Bouwen",
  },
  {
    id: "demo-4",
    title: "Maak een levend standbeeld",
    description: "Beeld met je team een bekend standbeeld of monument uit. De spelleider moet het raden.",
    difficulty: "hard",
    points: 35,
    category: "Uitbeelden",
  },
];

const demoTeams = [
  { id: "raven", name: "Team Raaf" },
  { id: "otter", name: "Team Otter" },
  { id: "vos", name: "Team Vos" },
];

function readDemoClaims(): Record<string, string[]> {
  try {
    return JSON.parse(localStorage.getItem("puntenjacht-demo-claims") ?? "{}");
  } catch {
    return {};
  }
}

export default function App() {
  return isSupabaseConfigured ? <SupabaseApp /> : <DemoApp />;
}

function DemoApp() {
  const [teamId, setTeamId] = useState(demoTeams[0].id);
  const [claims, setClaims] = useState<Record<string, string[]>>(readDemoClaims);
  const [tab, setTab] = useState<"cards" | "score">("cards");
  const [notice, setNotice] = useState("");
  const team = demoTeams.find((candidate) => candidate.id === teamId)!;
  const teamClaims = claims[teamId] ?? [];
  const claimedTeamByTask: Record<string, string> = {};
  for (const option of demoTeams) {
    for (const taskId of claims[option.id] ?? []) {
      if (!claimedTeamByTask[taskId]) claimedTeamByTask[taskId] = option.id;
    }
  }
  const teamNamesById = Object.fromEntries(demoTeams.map((option) => [option.id, option.name] as const));
  const scoreFor = (id: string) =>
    demoTasks
      .filter((task) => (claims[id] ?? []).includes(task.id))
      .reduce((sum, task) => sum + task.points, 0);

  function claim(task: Task) {
    if (claimedTeamByTask[task.id]) return;
    const updated = { ...claims, [teamId]: [...teamClaims, task.id] };
    setClaims(updated);
    localStorage.setItem("puntenjacht-demo-claims", JSON.stringify(updated));
    setNotice(`${task.points} punten toegevoegd aan ${team.name}.`);
    window.setTimeout(() => setNotice(""), 2600);
  }

  return (
    <GameShell
      teamName={team.name}
      gameName="Testspel"
      modeLabel="Lokale demo"
      tab={tab}
      setTab={setTab}
      notice={notice}
      onSignOut={() => {
        setClaims({});
        localStorage.removeItem("puntenjacht-demo-claims");
        setNotice("Demo-scores zijn op dit apparaat gewist.");
      }}
    >
      <div className="demo-switcher">
        <div>
          <strong>Bekijk als team</strong>
          <span>De demo bewaart scores alleen in deze browser.</span>
        </div>
        <select value={teamId} onChange={(event) => setTeamId(event.target.value)} aria-label="Kies team">
          {demoTeams.map((option) => (
            <option key={option.id} value={option.id}>{option.name}</option>
          ))}
        </select>
      </div>
      {tab === "cards" ? (
        <TaskList
          tasks={demoTasks}
          claimedTeamByTask={claimedTeamByTask}
          teamNamesById={teamNamesById}
          currentTeamId={teamId}
          onClaim={claim}
          active
        />
      ) : (
        <Scoreboard rows={demoTeams.map((option) => ({
          team_id: option.id,
          team_name: option.name,
          score: scoreFor(option.id),
        }))} currentTeamId={teamId} />
      )}
    </GameShell>
  );
}

function SupabaseApp() {
  const client = supabase!;
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [team, setTeam] = useState<TeamInfo | null>(null);
  const [teamLoading, setTeamLoading] = useState(false);
  const [teamError, setTeamError] = useState("");

  useEffect(() => {
    client.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null);
      setAuthLoading(false);
    });
    const { data } = client.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setTeam(null);
    });
    return () => data.subscription.unsubscribe();
  }, [client]);

  const loadTeam = useCallback(async () => {
    if (!user) return;
    setTeamLoading(true);
    setTeamError("");
    const { data, error } = await client.rpc("get_my_team");
    if (error) {
      setTeamError(error.message);
      setTeam(null);
    } else {
      const row = Array.isArray(data) ? data[0] : null;
      setTeam((row as TeamInfo | undefined) ?? null);
    }
    setTeamLoading(false);
  }, [client, user]);

  useEffect(() => {
    if (user) void loadTeam();
    else setTeam(null);
  }, [user, loadTeam]);

  async function joinTeam(code: string) {
    const { error } = await client.rpc("join_team_by_code", { p_code: code });
    if (error) throw error;
    await loadTeam();
  }

  if (authLoading || (user && teamLoading && !team)) {
    return <LoadingScreen />;
  }
  if (!user) return <AuthScreen />;
  if (!team) {
    return (
      <JoinTeamScreen
        error={teamError}
        onJoin={joinTeam}
        onSignOut={() => client.auth.signOut()}
      />
    );
  }
  return (
    <RemoteDashboard
      key={team.team_id}
      team={team}
      onSignOut={() => client.auth.signOut()}
    />
  );
}

function AuthScreen() {
  const client = supabase!;
  const [mode, setMode] = useState<"login" | "signup">("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    setError("");
    const result = mode === "signup"
      ? await client.auth.signUp({ email: email.trim(), password })
      : await client.auth.signInWithPassword({ email: email.trim(), password });
    if (result.error) setError(result.error.message);
    else if (mode === "signup" && !result.data.session) {
      setMessage("Controleer je e-mail om je account te bevestigen. Log daarna hier in.");
    } else {
      setMessage("Gelukt. Je wordt aangemeld…");
    }
    setBusy(false);
  }

  return (
    <main className="auth-page">
      <div className="auth-brand"><BrandMark /><span>PUNTENJACHT</span></div>
      <section className="auth-card">
        <span className="eyebrow">SPEEL SAMEN. SCOOR SAMEN.</span>
        <h1>{mode === "signup" ? "Maak je spelersaccount" : "Welkom terug"}</h1>
        <p className="muted">Iedere speler gebruikt een eigen account. Na koppeling aan een team kan dit account niet zelf naar een ander team wisselen.</p>
        <form onSubmit={submit} className="form-stack">
          <label>E-mailadres<input autoComplete="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
          <label>Wachtwoord<input autoComplete={mode === "signup" ? "new-password" : "current-password"} type="password" minLength={6} value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
          {error && <p className="form-error">{error}</p>}
          {message && <p className="form-message">{message}</p>}
          <button className="button button-primary button-wide" disabled={busy}>
            {busy ? "Even geduld…" : mode === "signup" ? "Account aanmaken" : "Inloggen"}
          </button>
        </form>
        <button className="text-button" onClick={() => { setMode(mode === "signup" ? "login" : "signup"); setError(""); setMessage(""); }}>
          {mode === "signup" ? "Heb je al een account? Inloggen" : "Nog geen account? Maak er één aan"}
        </button>
      </section>
      <p className="auth-footnote">Na het inloggen voer je de teamcode in die je van de spelleider hebt gekregen.</p>
    </main>
  );
}

function JoinTeamScreen({ error, onJoin, onSignOut }: { error: string; onJoin: (code: string) => Promise<void>; onSignOut: () => void }) {
  const [code, setCode] = useState(() => new URLSearchParams(window.location.search).get("team_code") ?? "");
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setLocalError("");
    try {
      await onJoin(code.trim());
      window.history.replaceState({}, "", window.location.pathname);
    } catch (e) {
      const message = e instanceof Error ? e.message : "De teamcode kon niet worden gebruikt.";
      setLocalError(message.toLowerCase().includes("permission denied")
        ? "Aanmelden met een teamcode staat uit. Vraag de spelleider om je aan een team toe te voegen."
        : message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-page">
      <div className="auth-brand"><BrandMark /><span>PUNTENJACHT</span></div>
      <section className="auth-card">
        <span className="eyebrow">BIJNA KLAAR</span>
        <h1>Voer je teamcode in</h1>
        <p className="muted">Scan de QR-code of voer de teamcode van jouw team in. Je account wordt daarna aan dat team gekoppeld.</p>
        <form onSubmit={submit} className="form-stack">
          <label>Teamcode<input className="code-input" autoCapitalize="characters" value={code} onChange={(event) => setCode(event.target.value)} required /></label>
          {(localError || error) && <p className="form-error">{localError || error}</p>}
          <button className="button button-primary button-wide" disabled={busy}>{busy ? "Team koppelen…" : "Team koppelen"}</button>
        </form>
        <button className="text-button" onClick={onSignOut}>Uitloggen</button>
      </section>
    </main>
  );
}

function RemoteDashboard({ team, onSignOut }: { team: TeamInfo; onSignOut: () => void }) {
  const client = supabase!;
  const [tab, setTab] = useState<"cards" | "score">("cards");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [claiming, setClaiming] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [taskResult, claimResult, scoreResult] = await Promise.all([
      client.from("tasks").select("id,title,description,difficulty,points,category")
        .eq("game_id", team.game_id).eq("active", true).order("difficulty").order("points"),
      client.from("claims").select("task_id,team_id,awarded_points,claimed_at")
        .order("claimed_at", { ascending: false }),
      client.rpc("get_leaderboard", { p_game_id: team.game_id }),
    ]);
    const firstError = taskResult.error || claimResult.error || scoreResult.error;
    if (firstError) setError(firstError.message);
    else {
      setError("");
      setTasks((taskResult.data ?? []) as Task[]);
      setClaims((claimResult.data ?? []) as Claim[]);
      setLeaderboard((scoreResult.data ?? []) as LeaderboardRow[]);
    }
    setLoading(false);
  }, [client, team.game_id, team.team_id]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 8000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  async function claimTask(task: Task) {
    setClaiming(task.id);
    setError("");
    const { error: claimError } = await client.rpc("claim_task", { p_task_id: task.id });
    if (claimError) {
      const message = claimError.message.toLowerCase();
      setError(message.includes("al geclaimd") || message.includes("already")
        ? "Deze opdracht is inmiddels door een ander team geclaimd."
        : claimError.message);
      await refresh();
    }
    else {
      setNotice(`Opdracht geclaimd: +${task.points} punten.`);
      window.setTimeout(() => setNotice(""), 3000);
      await refresh();
    }
    setClaiming(null);
  }

  const claimedTeamByTask = Object.fromEntries(claims.map((claim) => [claim.task_id, claim.team_id] as const));
  const teamNamesById = Object.fromEntries(leaderboard.map((row) => [row.team_id, row.team_name] as const));
  const active = team.game_status === "active";

  return (
    <GameShell
      teamName={team.team_name}
      gameName={team.game_name}
      modeLabel="Online spel"
      tab={tab}
      setTab={setTab}
      notice={notice}
      onSignOut={onSignOut}
    >
      <section className="welcome-row">
        <div><span className="eyebrow">JOUW TEAM</span><h1>{team.team_name}</h1></div>
        <div className="score-chip"><span>Jullie score</span><strong>{leaderboard.find((row) => row.team_id === team.team_id)?.score ?? 0}<small> pt</small></strong></div>
      </section>
      {!active && <div className="notice notice-neutral">Dit spel is {team.game_status === "paused" ? "gepauzeerd" : "afgelopen"}. Je kunt geen opdrachten claimen.</div>}
      {error && <div className="notice notice-error">{error}</div>}
      {loading ? <div className="loading-inline">Opdrachten laden…</div> : tab === "cards" ? (
        <TaskList
          tasks={tasks}
          claimedTeamByTask={claimedTeamByTask}
          teamNamesById={teamNamesById}
          currentTeamId={team.team_id}
          onClaim={claimTask}
          active={active}
          claimingId={claiming}
        />
      ) : (
        <Scoreboard rows={leaderboard} currentTeamId={team.team_id} />
      )}
      <p className="refresh-note">Scorebord wordt automatisch bijgewerkt.</p>
    </GameShell>
  );
}

function GameShell({
  teamName, gameName, modeLabel, tab, setTab, notice, onSignOut, children,
}: {
  teamName: string;
  gameName: string;
  modeLabel: string;
  tab: "cards" | "score";
  setTab: (tab: "cards" | "score") => void;
  notice: string;
  onSignOut: () => void;
  children: ReactNode;
}) {
  return (
    <div className="app-page">
      <header className="topbar">
        <a className="brand" href="#" aria-label="Puntenjacht start"><BrandMark /><span>PUNTENJACHT</span></a>
        <div className="topbar-right">
          <span className="mode-pill"><i />{modeLabel}</span>
          <button className="top-team" onClick={onSignOut} title={modeLabel === "Lokale demo" ? "Demo-scores wissen" : "Uitloggen"}><span className="avatar">{teamName.slice(0, 1).toUpperCase()}</span><span>{teamName}</span><b>{modeLabel === "Lokale demo" ? "↻" : "↗"}</b></button>
        </div>
      </header>
      <main className="main-content">
        <div className="game-heading"><span className="eyebrow">HET SPEL</span><span className="game-name">{gameName}</span></div>
        {notice && <div className="toast" role="status">✓ {notice}</div>}
        {children}
        <nav className="bottom-nav" aria-label="Hoofdnavigatie">
          <button className={tab === "cards" ? "nav-item active" : "nav-item"} onClick={() => setTab("cards")}><span className="nav-icon">▤</span>Opdrachten</button>
          <button className={tab === "score" ? "nav-item active" : "nav-item"} onClick={() => setTab("score")}><span className="nav-icon">♜</span>Klassement</button>
        </nav>
      </main>
      <footer className="footer-note">Een opdracht voltooid? Claim hem en pak de punten.</footer>
    </div>
  );
}

function TaskList({ tasks, claimedTeamByTask, teamNamesById, currentTeamId, onClaim, active, claimingId }: {
  tasks: Task[];
  claimedTeamByTask: Record<string, string>;
  teamNamesById: Record<string, string>;
  currentTeamId: string;
  onClaim: (task: Task) => void;
  active: boolean;
  claimingId?: string | null;
}) {
  if (!tasks.length) return <div className="empty-state"><span>✦</span><h2>Er staan nog geen opdrachten klaar</h2><p>Vraag de spelleider om opdrachten toe te voegen.</p></div>;
  return (
    <section className="task-section">
      <div className="section-heading"><div><span className="eyebrow">KIES JE UITDAGING</span><h2>Opdrachten</h2></div><span className="task-count">{tasks.length} kaarten</span></div>
      <div className="task-grid">
        {tasks.map((task, index) => {
          const claimedBy = claimedTeamByTask[task.id];
          const isClaimed = Boolean(claimedBy);
          const claimedLabel = claimedBy === currentTeamId
            ? "✓ Jullie claim"
            : `✓ ${teamNamesById[claimedBy] ?? "Ander team"}`;
          return (
            <article className={`task-card ${isClaimed ? "is-claimed" : ""}`} key={task.id}>
              <div className="task-card-top"><span className={`difficulty difficulty-${task.difficulty}`}>{difficultyLabel[task.difficulty]}</span><span className="card-number">#{String(index + 1).padStart(2, "0")}</span></div>
              <div className="task-art" aria-hidden="true"><span>{task.difficulty === "easy" ? "✳" : task.difficulty === "medium" ? "⌁" : "✦"}</span><div className="art-orbit" /></div>
              <div className="task-copy">
                {task.category && <span className="category-label">{task.category}</span>}
                <h3>{task.title}</h3>
                <p>{task.description}</p>
              </div>
              <div className="task-card-bottom"><div className="points"><strong>{task.points}</strong><span>punten</span></div>
                <button className={isClaimed ? "button button-claimed" : "button button-claim"} disabled={isClaimed || !active || claimingId === task.id} onClick={() => onClaim(task)}>
                  {isClaimed ? claimedLabel : claimingId === task.id ? "Bezig…" : "Claim opdracht →"}
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function Scoreboard({ rows, currentTeamId }: { rows: LeaderboardRow[]; currentTeamId: string }) {
  const sorted = [...rows].sort((a, b) => Number(b.score) - Number(a.score));
  return (
    <section className="score-section">
      <div className="section-heading"><div><span className="eyebrow">DE STAND</span><h2>Klassement</h2></div><span className="live-label"><i /> LIVE</span></div>
      <div className="leaderboard">
        {sorted.map((row, index) => (
          <div className={`leader-row ${row.team_id === currentTeamId ? "your-team" : ""}`} key={row.team_id}>
            <span className={`rank rank-${index + 1}`}>{String(index + 1).padStart(2, "0")}</span>
            <span className="leader-avatar">{row.team_name.slice(0, 1).toUpperCase()}</span>
            <span className="leader-name">{row.team_name}{row.team_id === currentTeamId && <small>Jouw team</small>}</span>
            <strong className="leader-score">{Number(row.score)} <small>pt</small></strong>
          </div>
        ))}
        {!sorted.length && <div className="empty-state"><h2>Nog geen teams in het klassement</h2></div>}
      </div>
      <p className="leaderboard-caption">Punten tellen mee zodra een opdracht is geclaimd.</p>
    </section>
  );
}

function LoadingScreen() {
  return <main className="auth-page"><div className="auth-brand"><BrandMark /><span>PUNTENJACHT</span></div><div className="loading-inline">Even laden…</div></main>;
}

function BrandMark() {
  return <span className="brand-mark" aria-hidden="true"><i /><i /><i /><i /></span>;
}
