import { useEffect, useState } from "react";
import type { Project } from "../types";
import {
  backup,
  download,
  listRecords,
  putRecord,
  recoverDraft,
  restore,
  type LibraryRecord,
} from "../lib/storage";
export function ProjectShelf({
  project,
  onOpen,
}: {
  project: Project | null;
  onOpen: (p: Project) => void;
}) {
  const [rows, setRows] = useState<LibraryRecord[]>([]);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const refresh = () =>
    listRecords().then((r) => setRows(r.filter((x) => x.kind === "project")));
  useEffect(() => {
    refresh().catch((e) => setStatus(String(e)));
  }, []);
  async function run(job: () => Promise<string>) {
    setBusy(true);
    try {
      setStatus(await job());
      await refresh();
    } catch (e) {
      setStatus(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-6">
      <section className="card space-y-3">
        <h2 className="text-lg font-semibold">Keep your work safe</h2>
        <p className="text-sm text-slate-300">
          Edits recover on this device. Save a named snapshot before
          experimenting; download backups for safekeeping on another device.
          Browser storage can be cleared or evicted.
        </p>
        <div className="flex flex-wrap gap-3">
          <button
            className="btn-primary"
            disabled={!project || busy}
            onClick={() =>
              run(async () => {
                await putRecord({
                  id: crypto.randomUUID(),
                  kind: "project",
                  title: project!.title,
                  updated: Date.now(),
                  project: project!,
                });
                return "Snapshot saved with original audio and icons.";
              })
            }
          >
            Save snapshot
          </button>
          <button
            className="btn"
            disabled={busy}
            onClick={() =>
              run(async () => {
                const p = await recoverDraft(true);
                if (!p) throw new Error("No previous draft is available.");
                onOpen(p);
                return "Previous draft recovered.";
              })
            }
          >
            Recover previous draft
          </button>
          <button
            className="btn"
            disabled={busy}
            onClick={() =>
              run(async () => {
                const records = await listRecords();
                if (project)
                  records.push({
                    id: crypto.randomUUID(),
                    kind: "project",
                    title: project.title,
                    updated: Date.now(),
                    project,
                  });
                download(
                  await backup(records),
                  `evie-library-${new Date().toISOString().slice(0, 10)}.zip`,
                );
                return "Backup downloaded. Keep a copy outside this browser.";
              })
            }
          >
            Back up library
          </button>
          <label className="btn cursor-pointer">
            Restore backup
            <input
              className="sr-only"
              aria-label="Restore backup"
              type="file"
              accept=".zip"
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f)
                  run(
                    async () =>
                      `${await restore(f)} records restored as new copies. Review them before sharing with Evie.`,
                  );
              }}
            />
          </label>
        </div>
        <button
          className="btn"
          onClick={() =>
            run(async () => {
              const ok = await navigator.storage?.persist?.();
              const estimate = await navigator.storage?.estimate?.();
              return `${ok ? "Persistent storage granted." : "Persistent storage is not guaranteed; keep backups."} ${Math.round((estimate?.usage ?? 0) / 1e6)} MB used on this origin.`;
            })
          }
        >
          Check device storage
        </button>
        <p role="status" className="text-sm text-amber-200">
          {busy ? "Working…" : status}
        </p>
      </section>
      <section>
        <h2 className="mb-3 text-lg font-semibold">Saved projects</h2>
        {!rows.length && (
          <p className="text-slate-300">
            Your saved snapshots will appear here.
          </p>
        )}
        <ul className="divide-y divide-white/10">
          {rows
            .sort((a, b) => b.updated - a.updated)
            .map((r) => (
              <li
                className="flex items-center justify-between gap-4 py-4"
                key={r.id}
              >
                <div>
                  <p className="font-semibold">{r.title}</p>
                  <p className="text-sm text-slate-300">
                    {new Date(r.updated).toLocaleString()} ·{" "}
                    {r.project?.tracks.length} tracks
                  </p>
                </div>
                <button
                  className="btn"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      download(await backup([r]), "evie-project.zip");
                      return "Project backup downloaded.";
                    })
                  }
                >
                  Back up project
                </button>
                <button
                  className="btn"
                  onClick={() => r.project && onOpen(r.project)}
                >
                  Open copy
                </button>
              </li>
            ))}
        </ul>
      </section>
    </div>
  );
}
