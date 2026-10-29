import { useEffect, useRef, useState } from "react";
import {
  BookOpen,
  Heart,
  Headphones,
  Mic,
  Music,
  Play,
  Square,
  Star,
} from "lucide-react";
import {
  backup,
  download,
  listRecords,
  putRecord,
  type LibraryRecord,
} from "../lib/storage";
import { probe } from "../lib/audio/ffmpeg";
import type { Project } from "../types";

export function FamilyLibrary({
  parent,
  onProject,
}: {
  parent: boolean;
  onProject: (p: Project) => void;
}) {
  const [rows, setRows] = useState<LibraryRecord[]>([]);
  const [message, setMessage] = useState("");
  const [filter, setFilter] = useState("all");
  const [playing, setPlaying] = useState<LibraryRecord>();
  const [audioUrl, setAudioUrl] = useState("");
  const [queue, setQueue] = useState<string[]>([]);
  const [kind, setKind] = useState<"music" | "audiobook">("music");
  const [storyTitle, setStoryTitle] = useState("");
  const [story, setStory] = useState("");
  const [playlist, setPlaylist] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [recording, setRecording] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const mounted = useRef(true);
  async function refresh() {
    setRows((await listRecords()).filter((r) => r.kind !== "project"));
  }
  useEffect(() => {
    mounted.current = true;
    refresh().catch((e) => setMessage(String(e)));
    return () => {
      mounted.current = false;
      if (recorder.current?.state === "recording") recorder.current.stop();
      stream.current?.getTracks().forEach((t) => t.stop());
      if ("speechSynthesis" in window) speechSynthesis.cancel();
    };
  }, []);
  useEffect(() => {
    if (!recording) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [recording]);
  useEffect(() => {
    if (!playing?.file) {
      setAudioUrl("");
      return;
    }
    const url = URL.createObjectURL(playing.file);
    setAudioUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [playing]);
  async function save(r: LibraryRecord) {
    try {
      await putRecord(r);
      await refresh();
      setMessage("Saved on this device.");
    } catch (e) {
      setMessage(
        `Could not save: ${String(e)}. Keep your original file and export a backup.`,
      );
    }
  }
  async function addFiles(files: File[]) {
    for (const f of files) {
      if (
        !f.type.startsWith("audio/") &&
        !/\.(mp3|m4[ab]|wav|ogg|opus|flac|aac)$/i.test(f.name)
      ) {
        setMessage("Choose an audio file.");
        continue;
      }
      await save({
        id: crypto.randomUUID(),
        kind,
        title: f.name,
        file: f,
        updated: Date.now(),
        approved: false,
        eligible: false,
      });
    }
  }
  async function record() {
    try {
      if (
        !navigator.mediaDevices?.getUserMedia ||
        typeof MediaRecorder === "undefined"
      )
        throw new Error(
          "Recording needs HTTPS and microphone permission. Import a voice file instead.",
        );
      stream.current = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      if (!mounted.current) {
        stream.current.getTracks().forEach((t) => t.stop());
        return;
      }
      const mime = [
        "audio/webm;codecs=opus",
        "audio/mp4",
        "audio/ogg;codecs=opus",
      ].find((t) => MediaRecorder.isTypeSupported(t));
      const rec = new MediaRecorder(
        stream.current,
        mime ? { mimeType: mime } : undefined,
      );
      recorder.current = rec;
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      rec.onstop = () => {
        stream.current?.getTracks().forEach((t) => t.stop());
        if (mounted.current) setRecording(false);
        const type = rec.mimeType;
        const file = new File(
          chunks,
          `Family voice ${new Date().toLocaleDateString().replaceAll("/", "-")}.${type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : "webm"}`,
          { type },
        );
        save({
          id: crypto.randomUUID(),
          kind: "voice",
          title: file.name,
          file,
          updated: Date.now(),
          eligible: true,
          approved: false,
        });
      };
      rec.onerror = () => {
        stream.current?.getTracks().forEach((t) => t.stop());
        setRecording(false);
        setMessage("Recording failed. Try again or import a voice file.");
      };
      rec.start(1000);
      setRecording(true);
    } catch (e) {
      stream.current?.getTracks().forEach((t) => t.stop());
      setMessage(String(e));
    }
  }
  const shared = rows.filter((r) => parent || r.approved);
  const visible = shared.filter(
    (r) =>
      filter === "all" ||
      (filter === "favourites" && r.favourite) ||
      r.kind === filter,
  );
  async function prepareCard(r: LibraryRecord) {
    if (!r.file || !r.eligible) return;
    setMessage("Reading audio for Card Studio…");
    try {
      const info = await probe(r.file);
      if (!(info.duration > 0))
        throw new Error(
          "Audio duration could not be read. Try another format.",
        );
      if (!mounted.current) return;
      onProject({
        title: r.title,
        artist: info.artist || "Family library",
        source: r.file,
        codec: info.codec,
        duration: info.duration,
        tracks: info.chapters.length
          ? info.chapters.map((c, i) => ({
              id: crypto.randomUUID(),
              title: c.title || `Chapter ${i + 1}`,
              start: i === 0 ? 0 : c.start,
            }))
          : [{ id: crypto.randomUUID(), title: r.title, start: 0 }],
      });
    } catch (e) {
      setMessage(String(e));
    }
  }
  function play(r: LibraryRecord) {
    if (r.kind === "playlist") {
      const first = r.items
        ?.map((id) => shared.find((x) => x.id === id && x.file))
        .find(Boolean);
      if (first) {
        setQueue(r.items ?? []);
        setPlaying(first);
      } else setMessage("No available audio in this playlist.");
      return;
    }
    setQueue([r.id]);
    setPlaying(r);
  }
  function next() {
    if (!playing) return;
    const list = queue
      .map((id) => shared.find((r) => r.id === id && r.file))
      .filter((r): r is LibraryRecord => !!r);
    const i = list.findIndex((r) => r.id === playing.id);
    if (i >= 0 && i + 1 < list.length) setPlaying(list[i + 1]);
  }
  return (
    <div className="space-y-8">
      <div className="listening-intro">
        <Headphones size={38} />
        <div>
          <h2 className="text-3xl font-semibold">
            {parent
              ? "Your family collection"
              : "Pick something lovely to hear"}
          </h2>
          <p className="mt-2 text-slate-300">
            {parent
              ? "Keep favourite sounds together, ready for small adventures."
              : "Stories, songs and familiar voices. Just for you."}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2" aria-label="Library filters">
        {[
          ["all", "Everything"],
          ["audiobook", "Books"],
          ["music", "Music"],
          ["voice", "Family voices"],
          ["story", "Stories"],
          ["favourites", "Favourites"],
          ["playlist", "Playlists"],
        ].map(([value, label]) => (
          <button
            className={filter === value ? "btn-primary" : "btn"}
            aria-pressed={filter === value}
            key={value}
            onClick={() => setFilter(value)}
          >
            {label}
          </button>
        ))}
      </div>
      {playing && (
        <section className="now-playing" aria-label="Now playing">
          <div className="flex justify-between gap-4">
            <h3 className="font-semibold">{playing.title}</h3>
            <button
              className="btn"
              onClick={() => {
                setPlaying(undefined);
                if ("speechSynthesis" in window) speechSynthesis.cancel();
              }}
            >
              Close player
            </button>
          </div>
          {audioUrl && (
            <audio
              className="mt-4 w-full"
              controls
              autoPlay
              src={audioUrl}
              onEnded={next}
              onError={() =>
                setMessage(
                  "This browser cannot play this format. A parent can convert the original in Card Studio.",
                )
              }
            />
          )}
          {playing.text && (
            <>
              <p className="my-4 whitespace-pre-wrap leading-relaxed">
                {playing.text}
              </p>
              <button
                className="btn"
                onClick={() => {
                  if (!("speechSynthesis" in window))
                    return setMessage(
                      "Read this story together; spoken playback is unavailable.",
                    );
                  speechSynthesis.cancel();
                  const speech = new SpeechSynthesisUtterance(playing.text);
                  speech.rate = 0.85;
                  speechSynthesis.speak(speech);
                }}
              >
                Read aloud
              </button>
              <p className="mt-2 text-sm text-slate-300">
                Uses this device’s voices. Some voices need internet; this does
                not create an audio file.
              </p>
            </>
          )}
        </section>
      )}
      <ul className="library-list">
        {visible.map((r) => (
          <li key={r.id} className="library-item">
            <div
              className={`library-art ${r.kind === "music" ? "music-art" : r.kind === "voice" ? "voice-art" : ""}`}
            >
              {r.kind === "music" ? (
                <Music />
              ) : r.kind === "voice" ? (
                <Mic />
              ) : (
                <BookOpen />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-semibold break-words">{r.title}</p>
              <p className="text-sm text-slate-300">
                {r.kind === "playlist"
                  ? `${r.items?.length ?? 0} sounds`
                  : r.kind === "story"
                    ? "An original family story"
                    : r.kind === "voice"
                      ? "A familiar voice"
                      : r.kind === "audiobook"
                        ? "A book to listen to"
                        : "Music"}
                {parent && ` · ${r.approved ? "Shared" : "Parent only"}`}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  className="btn"
                  aria-label={`Play ${r.title}`}
                  onClick={() => play(r)}
                >
                  <Play size={16} /> {r.text ? "Read" : "Listen"}
                </button>
                <button
                  className="btn"
                  aria-label={`${r.favourite ? "Unfavourite" : "Favourite"} ${r.title}`}
                  aria-pressed={!!r.favourite}
                  onClick={() => save({ ...r, favourite: !r.favourite })}
                >
                  <Heart
                    size={16}
                    fill={r.favourite ? "currentColor" : "none"}
                  />
                </button>
                {parent && (
                  <>
                    <button
                      className="btn"
                      onClick={() => save({ ...r, approved: !r.approved })}
                    >
                      {r.approved ? "Hide from Evie" : "Share with Evie"}
                    </button>
                    <button
                      className="btn"
                      onClick={async () => {
                        try {
                          download(
                            await backup([
                              r,
                              ...rows.filter((x) => r.items?.includes(x.id)),
                            ]),
                            "evie-library-item.zip",
                          );
                          setMessage("Item backup downloaded.");
                        } catch (e) {
                          setMessage(String(e));
                        }
                      }}
                    >
                      Back up item
                    </button>
                    {r.file && (
                      <>
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={!!r.eligible}
                            onChange={(e) =>
                              save({ ...r, eligible: e.target.checked })
                            }
                          />
                          I have copying rights
                        </label>
                        <button
                          className="btn"
                          disabled={!r.eligible}
                          onClick={() => prepareCard(r)}
                        >
                          Prepare MYO
                        </button>
                        <button
                          className="btn"
                          onClick={() =>
                            r.file && download(r.file, r.file.name)
                          }
                        >
                          Download original
                        </button>
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            aria-label={`Add ${r.title} to playlist`}
                            checked={selected.includes(r.id)}
                            onChange={(e) =>
                              setSelected(
                                e.target.checked
                                  ? [...selected, r.id]
                                  : selected.filter((id) => id !== r.id),
                              )
                            }
                          />
                          Playlist
                        </label>
                      </>
                    )}
                  </>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
      {!visible.length && (
        <div className="empty-library">
          <BookOpen size={40} />
          <h3 className="text-xl font-semibold">
            {parent ? "Start with a favourite sound" : "A little quiet for now"}
          </h3>
          <p className="max-w-md text-slate-300">
            {parent
              ? "Add a book, a song or a family recording below. Choose what to share with Evie."
              : "Ask a grown-up to add a story or song. Or try a listening adventure below."}
          </p>
        </div>
      )}
      {parent && (
        <div className="space-y-8 border-t border-white/10 pt-6">
          <section className="space-y-3">
            <h3 className="text-xl font-semibold">Add your audio</h3>
            <p className="text-sm text-slate-300">
              Files stay on this device. Nothing replaces your originals. Only
              copy audio you own or have permission to use.
            </p>
            <label className="block">
              Audio type
              <select
                aria-label="Audio type"
                className="field ml-3"
                value={kind}
                onChange={(e) => setKind(e.target.value as typeof kind)}
              >
                <option value="music">Music</option>
                <option value="audiobook">Audiobook</option>
              </select>
            </label>
            <input
              aria-label="Add local audio"
              type="file"
              multiple
              accept="audio/*,.m4b,.flac,.opus"
              onChange={(e) => {
                addFiles(Array.from(e.target.files ?? []));
                e.target.value = "";
              }}
            />
          </section>
          <section className="space-y-3">
            <h3 className="text-xl font-semibold">Make a playlist</h3>
            <p className="text-sm text-slate-300">
              Select sounds above, in the order you want them.
            </p>
            <label className="block">
              Playlist name
              <input
                className="field ml-3"
                value={playlist}
                onChange={(e) => setPlaylist(e.target.value)}
              />
            </label>
            <button
              className="btn"
              disabled={!playlist.trim() || !selected.length}
              onClick={async () => {
                await save({
                  id: crypto.randomUUID(),
                  kind: "playlist",
                  title: playlist.trim(),
                  updated: Date.now(),
                  items: selected,
                  approved: false,
                });
                setSelected([]);
                setPlaylist("");
              }}
            >
              Save playlist ({selected.length})
            </button>
          </section>
          <section className="space-y-3">
            <h3 className="text-xl font-semibold">A voice from home</h3>
            <p className="text-sm text-slate-300">
              Record a greeting or a bedtime story with everyone’s permission.
              Stop to save, then back it up.
            </p>
            <button
              className={recording ? "btn-primary" : "btn"}
              onClick={() => (recording ? recorder.current?.stop() : record())}
            >
              {recording ? (
                <>
                  <Square size={18} />
                  Stop and save recording
                </>
              ) : (
                <>
                  <Mic size={18} />
                  Record family voice
                </>
              )}
            </button>
          </section>
          <section className="space-y-3">
            <h3 className="text-xl font-semibold">Write a little adventure</h3>
            <label className="block">
              Story title
              <input
                className="field mt-2 w-full"
                value={storyTitle}
                onChange={(e) => setStoryTitle(e.target.value)}
              />
            </label>
            <label className="block">
              Your original story
              <textarea
                className="field mt-2 h-40 w-full py-3"
                placeholder="One evening, Evie found a tiny door in the moon…"
                value={story}
                onChange={(e) => setStory(e.target.value)}
              />
            </label>
            <button
              className="btn-primary"
              disabled={!storyTitle.trim() || !story.trim()}
              onClick={async () => {
                await save({
                  id: crypto.randomUUID(),
                  kind: "story",
                  title: storyTitle.trim(),
                  text: story,
                  updated: Date.now(),
                  eligible: true,
                  approved: false,
                });
                setStory("");
                setStoryTitle("");
              }}
            >
              Save story
            </button>
            <p className="text-sm text-slate-300">
              Read it aloud together, or record it above to make a card. No
              subscription required.
            </p>
          </section>
          <p className="text-slate-300">
            <a
              className="text-amber-300 underline"
              href="https://music.youtube.com"
              target="_blank"
              rel="noreferrer"
            >
              Open YouTube Music
            </a>{" "}
            for Premium playback in the official app or website.
          </p>
        </div>
      )}
      <section className="activity-strip">
        <Star size={26} />
        <div>
          <h3 className="text-lg font-semibold">A listening adventure</h3>
          <p className="mt-2 leading-relaxed">
            Close your eyes and find three sounds in the room. Can you clap a
            slow rhythm, then a fast one? Imagine an animal that makes each
            sound. Tell a grown-up your tiny story.
          </p>
        </div>
      </section>
      <p role="status" className="text-sm text-amber-200">
        {message}
      </p>
    </div>
  );
}
