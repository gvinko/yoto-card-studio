import { useEffect, useState } from "react";
import { getClientId, isSignedIn, signIn } from "../lib/yoto/auth";
import { listMyCards, type MyCard } from "../lib/yoto/api";
import {
  controlPlayer,
  listDevices,
  listFamilyGroups,
  type FamilyGroup,
  type PlayerAction,
  type YotoDevice,
} from "../lib/yoto/player";
interface Status {
  available?: boolean;
  authenticated?: boolean;
  audiobookshelf?: boolean;
  homeAssistant?: boolean;
}
interface Player {
  id: string;
  name: string;
  state: string;
}
interface Library {
  id: string;
  name: string;
}
interface Book {
  id: string;
  title: string;
  author: string;
  url: string;
}
async function api(path: string, body?: unknown) {
  const r = await fetch("/api/" + path, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
    signal: AbortSignal.timeout(20000),
  });
  if (!r.headers.get("content-type")?.includes("application/json"))
    throw new Error(
      "The optional home gateway is not running at this address.",
    );
  const data = await r.json();
  if (!r.ok) throw new Error(data.error ?? `Connection failed (${r.status}).`);
  return data;
}
export function Connections() {
  const [status, setStatus] = useState<Status>({});
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [library, setLibrary] = useState("");
  const [books, setBooks] = useState<Book[]>([]);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [players, setPlayers] = useState<Player[]>([]);
  const [entity, setEntity] = useState("");
  const [media, setMedia] = useState("");
  const [devices, setDevices] = useState<YotoDevice[]>([]);
  const [device, setDevice] = useState("");
  const [cards, setCards] = useState<MyCard[]>([]);
  const [groups, setGroups] = useState<FamilyGroup[]>([]);
  const [card, setCard] = useState("");
  const [volume, setVolume] = useState(20);
  const [query, setQuery] = useState("");
  async function run(job: () => Promise<void>) {
    setBusy(true);
    setMessage("");
    try {
      await job();
    } catch (e) {
      setMessage(String(e));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    api("status")
      .then(setStatus)
      .catch(() => setStatus({ available: false }));
    return () => {
      api("logout", {}).catch(() => undefined);
    };
  }, []);
  async function connect() {
    await api("login", { password });
    setPassword("");
    const next = await api("status");
    setStatus(next);
    if (next.audiobookshelf) setLibraries(await api("abs/libraries"));
    if (next.homeAssistant) setPlayers(await api("ha/players"));
    setMessage("Home connection unlocked for up to 30 minutes.");
  }
  async function loadBooks(nextPage: number) {
    const data = await api(
      `abs/libraries/${encodeURIComponent(library)}/items?page=${nextPage}`,
    );
    setBooks(data.items);
    setTotal(data.total);
    setPage(nextPage);
  }
  async function yoto(consent = true) {
    if (consent) await signIn(true);
    const [d, c, g] = await Promise.all([
      listDevices(),
      listMyCards(),
      listFamilyGroups(),
    ]);
    setDevices(d);
    setCards(c);
    setGroups(g);
    setMessage("Yoto library refreshed.");
  }
  async function command(action: PlayerAction, value?: string | number) {
    await controlPlayer(device, action, value);
    setMessage("The Yoto player acknowledged the command.");
  }
  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold">Yoto library & Mini</h2>
        <p className="text-slate-300">
          Use your family’s official Yoto account. Player permission is optional
          and requires Yoto consent. Existing cards are read-only here.
        </p>
        <button
          className="btn-primary"
          disabled={busy || !getClientId()}
          onClick={() => run(() => yoto())}
        >
          Connect Yoto library and players
        </button>
        <button
          className="btn ml-3"
          disabled={busy || !isSignedIn()}
          onClick={() => run(() => yoto(false))}
        >
          Refresh Yoto library
        </button>
        {!getClientId() && (
          <p className="text-sm text-amber-200">
            Add your public Yoto app client ID in Settings first.
          </p>
        )}
        <ul className="space-y-2">
          {devices.map((d) => (
            <li key={d.deviceId}>
              {d.name} · {d.online ? "Online" : "Offline"}
            </li>
          ))}
        </ul>
        {!!devices.length && (
          <>
            <label className="block">
              Yoto player
              <select
                className="field mt-2 w-full"
                value={device}
                onChange={(e) => setDevice(e.target.value)}
              >
                <option value="">Choose an online player</option>
                {devices.map((d) => (
                  <option
                    key={d.deviceId}
                    value={d.deviceId}
                    disabled={!d.online}
                  >
                    {d.name} {d.online ? "" : "(offline)"}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex flex-wrap gap-3">
              {(["pause", "resume", "stop"] as const).map((action) => (
                <button
                  key={action}
                  className="btn"
                  disabled={busy || !device}
                  onClick={() => run(() => command(action))}
                >
                  {action[0].toUpperCase() + action.slice(1)}
                </button>
              ))}
            </div>
            <label className="block">
              Yoto volume (0–50)
              <input
                aria-label="Yoto volume"
                className="mx-3"
                type="range"
                min="0"
                max="50"
                value={volume}
                onChange={(e) => setVolume(+e.target.value)}
              />
              {volume}
            </label>
            <button
              className="btn"
              disabled={busy || !device}
              onClick={() => run(() => command("volume", volume))}
            >
              Set Yoto volume
            </button>
          </>
        )}
        {(cards.length > 0 || groups.length > 0) && (
          <>
            <label className="block">
              Family card
              <select
                className="field mt-2 w-full"
                value={card}
                onChange={(e) => setCard(e.target.value)}
              >
                <option value="">Choose a library card</option>
                {cards.map((c) => (
                  <option key={c.cardId} value={c.cardId}>
                    {c.title}
                  </option>
                ))}
                {groups.map((g) => (
                  <optgroup key={g.id} label={g.name}>
                    {g.items?.map((i) => (
                      <option key={i.contentId} value={i.contentId}>
                        {i.contentId}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
            <button
              className="btn"
              disabled={busy || !device || !card}
              onClick={() => run(() => command("play", card))}
            >
              Play card on Yoto
            </button>
          </>
        )}
      </section>
      <section className="border-t border-white/10 pt-6 space-y-4">
        <h2 className="text-2xl font-semibold">Home audio connection</h2>
        <p className="text-slate-300">
          Audiobookshelf and Google Cast use an optional home gateway. Service
          tokens stay on that server. The browser PIN does not grant server
          access.
        </p>
        {!status.available ? (
          <p className="text-amber-200">
            The home gateway is not connected on this address. Local audio and
            cards still work. Server setup is documented in the repository.
          </p>
        ) : !status.authenticated ? (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              run(connect);
            }}
          >
            <label className="block">
              Server parent password
              <input
                type="password"
                autoComplete="current-password"
                className="field mt-2 w-full"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <button className="btn" disabled={busy || !password}>
              Unlock home connection
            </button>
          </form>
        ) : (
          <>
            <button
              className="btn"
              onClick={() =>
                run(async () => {
                  await api("logout", {});
                  setStatus({ available: true, authenticated: false });
                  setLibraries([]);
                  setBooks([]);
                  setPlayers([]);
                })
              }
            >
              Lock home connection
            </button>
            <p className="text-sm text-slate-300">
              Audiobookshelf:{" "}
              {status.audiobookshelf ? "Configured" : "Not configured"} · Home
              Assistant:{" "}
              {status.homeAssistant ? "Configured" : "Not configured"}
            </p>
          </>
        )}
      </section>
      {status.authenticated && status.audiobookshelf && (
        <section className="space-y-4">
          <h3 className="text-xl font-semibold">Audiobookshelf</h3>
          <button
            className="btn"
            disabled={busy}
            onClick={() =>
              run(async () => setLibraries(await api("abs/libraries")))
            }
          >
            Refresh audiobook libraries
          </button>
          <label className="block">
            Audiobook library
            <select
              className="field mt-2 w-full"
              value={library}
              onChange={(e) => {
                setLibrary(e.target.value);
                setBooks([]);
              }}
            >
              <option value="">Choose a library</option>
              {libraries.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
          <button
            className="btn-primary"
            disabled={busy || !library}
            onClick={() => run(() => loadBooks(0))}
          >
            Browse books
          </button>
          <ul className="divide-y divide-white/10">
            {books.map((b) => (
              <li key={b.id} className="py-4">
                <p className="font-semibold">{b.title}</p>
                <p className="text-sm text-slate-300">{b.author}</p>
                <a
                  href={b.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-amber-300 underline"
                >
                  Listen in Audiobookshelf
                </a>
              </li>
            ))}
          </ul>
          <div className="flex gap-3">
            <button
              className="btn"
              disabled={busy || page === 0}
              onClick={() => run(() => loadBooks(page - 1))}
            >
              Previous books
            </button>
            <button
              className="btn"
              disabled={busy || (page + 1) * 50 >= total}
              onClick={() => run(() => loadBooks(page + 1))}
            >
              More books
            </button>
          </div>
          <p className="text-sm text-slate-300">
            Audiobookshelf handles playback and listening progress in its
            official interface. To prepare an eligible book for a card, download
            your own DRM-free copy there and import it in Card Studio.
          </p>
        </section>
      )}
      {status.authenticated && status.homeAssistant && (
        <section className="space-y-4">
          <h3 className="text-xl font-semibold">
            Google Cast through Home Assistant
          </h3>
          <p className="text-sm text-slate-300">
            Uses existing Cast / Music Assistant media-player entities exposed
            by Home Assistant. The receiver must be able to reach the media;
            on-device files cannot be cast directly.
          </p>
          <button
            className="btn"
            disabled={busy}
            onClick={() => run(async () => setPlayers(await api("ha/players")))}
          >
            Refresh home players
          </button>
          <label className="block">
            Home player
            <select
              className="field mt-2 w-full"
              value={entity}
              onChange={(e) => setEntity(e.target.value)}
            >
              <option value="">Choose a player</option>
              {players.map((p) => (
                <option
                  key={p.id}
                  value={p.id}
                  disabled={p.state === "unavailable"}
                >
                  {p.name} · {p.state}
                </option>
              ))}
            </select>
          </label>
          <div className="flex flex-wrap gap-3">
            {[
              ["media_play", "Resume"],
              ["media_pause", "Pause"],
              ["media_stop", "Stop"],
              ["media_next_track", "Next"],
              ["media_previous_track", "Previous"],
            ].map(([service, label]) => (
              <button
                key={service}
                className="btn"
                disabled={busy || !entity}
                onClick={() =>
                  run(async () => {
                    await api("ha/control", { entity, service });
                    setMessage(
                      "Home Assistant accepted the request. Check the player for playback.",
                    );
                  })
                }
              >
                {label}
              </button>
            ))}
          </div>
          <label className="block">
            Home Assistant local media URI
            <input
              className="field mt-2 w-full"
              placeholder="media-source://media_source/local/story.mp3"
              value={media}
              onChange={(e) => setMedia(e.target.value)}
            />
          </label>
          <button
            className="btn-primary"
            disabled={busy || !entity || !media}
            onClick={() =>
              run(async () => {
                await api("ha/control", {
                  entity,
                  service: "play_media",
                  media,
                });
                setMessage("Home Assistant accepted the playback request.");
              })
            }
          >
            Play home audio
          </button>
        </section>
      )}
      <section className="space-y-4 border-t border-white/10 pt-6">
        <h2 className="text-xl font-semibold">Discover LibriVox</h2>
        <p className="text-slate-300">
          Explore public-domain recordings in the official catalogue. A parent
          should check the story, local copyright status and recording quality
          before sharing.
        </p>
        <label className="block">
          Book or author
          <input
            className="field mt-2 w-full"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <a
          className="btn"
          href={`https://librivox.org/search?title=${encodeURIComponent(query)}&search_form=advanced`}
          target="_blank"
          rel="noreferrer"
        >
          Search LibriVox catalogue
        </a>
      </section>
      <section className="space-y-4 border-t border-white/10 pt-6">
        <h2 className="text-2xl font-semibold">Explore more music, stories and podcasts</h2>
        <p className="text-slate-300">
          These are external discovery catalogues, not connected personal accounts.
          Open a source, check its licence and download rights, then import an
          eligible DRM-free audio file through Import. A listing does not grant
          permission to copy it onto a Yoto card.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {([
            ["Internet Archive", "Audio, live recordings and spoken-word collections", "https://archive.org/details/audio"],
            ["Free Music Archive", "Independent music with track-specific licences", "https://freemusicarchive.org/"],
            ["Jamendo Music", "Independent artists; check the individual music licence", "https://www.jamendo.com/start"],
            ["Musopen", "Classical recordings; check recording-specific rights", "https://musopen.org/music/"],
            ["Project Gutenberg", "Free ebooks and story texts, not automatic audio", "https://www.gutenberg.org/"],
            ["Open Library", "Discover books and editions; borrowing is not an audio export", "https://openlibrary.org/"],
            ["Podcast Index", "Discover podcasts and their official feeds", "https://podcastindex.org/"],
            ["Radio Browser", "Browse internet radio streams; not downloadable card audio", "https://www.radio-browser.info/"],
          ] as const).map(([name, description, url]) => (
            <a key={name} className="card block space-y-1 hover:border-amber-300"
              href={url} target="_blank" rel="noopener noreferrer">
              <span className="font-semibold text-amber-300">{name} ↗</span>
              <p className="text-sm text-slate-300">{description}</p>
            </a>
          ))}
        </div>
        <p className="text-sm text-slate-300">
          Audiobookshelf and Home Assistant are private-server integrations and
          still require the optional gateway on your mini PC. Spotify, YouTube
          Music and subscription audiobooks are not downloadable card sources.
        </p>
      </section>
      <p role="status" className="text-amber-200">
        {busy ? "Connecting…" : message}
      </p>
    </div>
  );
}
