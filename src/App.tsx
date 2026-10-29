import { useEffect, useRef, useState } from "react";
import {
  AudioLines,
  BookOpen,
  Download,
  FolderOpen,
  Lock,
  Nfc,
  Paintbrush,
  Settings,
  Upload,
} from "lucide-react";
import type { Output, Project } from "./types";
import { completeSignInIfCallback } from "./lib/yoto/auth";
import { IngestPanel } from "./components/IngestPanel";
import { ChapterStudio } from "./components/ChapterStudio";
import { IconStudio } from "./components/IconEditor";
import { ExportPanel } from "./components/ExportPanel";
import { NfcPanel } from "./components/NfcPanel";
import { SettingsPanel } from "./components/SettingsPanel";
import { ProjectShelf } from "./components/ProjectShelf";
import { FamilyLibrary } from "./components/FamilyLibrary";
import { Connections } from "./components/Connections";
import { hasParentPin, setParentPin, unlockParent } from "./lib/parent";
import { putRecord, recoverDraft, saveDraft } from "./lib/storage";

type Tab =
  | "library"
  | "projects"
  | "import"
  | "studio"
  | "icons"
  | "export"
  | "nfc"
  | "settings"
  | "connections";
const TABS = [
  { id: "library", label: "Library", icon: BookOpen },
  { id: "projects", label: "Projects", icon: FolderOpen },
  { id: "import", label: "Import", icon: Upload },
  { id: "studio", label: "Chapters", icon: AudioLines, needsProject: true },
  { id: "icons", label: "Icons", icon: Paintbrush, needsProject: true },
  { id: "export", label: "Export", icon: Download, needsProject: true },
  { id: "nfc", label: "NFC", icon: Nfc },
  { id: "connections", label: "Connections", icon: BookOpen },
  { id: "settings", label: "Settings", icon: Settings },
] as const;
// One callback exchange even under React StrictMode's development effect replay.
let callbackResult: Promise<boolean> | undefined;
export default function App() {
  const savedProject = useRef<Project | null>(null);
  const [tab, setTab] = useState<Tab>("library");
  const [project, setProjectRaw] = useState<Project | null>(null);
  const [outputs, setOutputs] = useState<Output[]>([]);
  const [callback, setCallback] = useState(false);
  const [parent, setParent] = useState(() => !hasParentPin());
  const [gate, setGate] = useState(false);
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [ready, setReady] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  useEffect(() => {
    (callbackResult ??= completeSignInIfCallback())
      .then((was) => was && setCallback(true))
      .catch((e) => setError(String(e)));
    recoverDraft()
      .then((p) => {
        if (p) {
          savedProject.current = p;
          setProjectRaw(p);
          setStatus("Draft recovered on this device");
        }
      })
      .catch((e) => setError(`Recovery unavailable: ${String(e)}`))
      .finally(() => setReady(true));
  }, []);
  useEffect(() => {
    if (!ready || !project || project === savedProject.current) return;
    setStatus("Saving draft…");
    const timer = setTimeout(() => {
      saveDraft(project)
        .then(() => {
          savedProject.current = project;
          setStatus("Draft saved on this device");
        })
        .catch((e) => {
          setStatus("Draft not saved");
          setError(
            `Save failed: ${String(e)}. Download a backup from Projects.`,
          );
        });
    }, 350);
    return () => clearTimeout(timer);
  }, [project, ready]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (project && project !== savedProject.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [project]);
  useEffect(() => {
    if (!parent || !hasParentPin()) return;
    let timer: ReturnType<typeof setTimeout>;
    const lock = () => {
      setParent(false);
      setTab("library");
      setGate(false);
      setPin("");
    };
    const activity = () => {
      clearTimeout(timer);
      timer = setTimeout(lock, 5 * 60_000);
    };
    const hide = () => {
      if (document.hidden) lock();
    };
    activity();
    window.addEventListener("pointerdown", activity);
    window.addEventListener("keydown", activity);
    document.addEventListener("visibilitychange", hide);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("pointerdown", activity);
      window.removeEventListener("keydown", activity);
      document.removeEventListener("visibilitychange", hide);
    };
  }, [parent]);
  async function openProject(p: Project) {
    try {
      if (project)
        await putRecord({
          id: crypto.randomUUID(),
          kind: "project",
          title: project.title,
          updated: Date.now(),
          project,
        });
      await saveDraft(p);
      savedProject.current = p;
      setStatus("Draft saved on this device");
      setProjectRaw(p);
      setOutputs([]);
      setTab(p.source ? "studio" : "export");
    } catch (e) {
      setError(
        `Could not preserve the project: ${String(e)}. Back up your current work before importing.`,
      );
    }
  }
  const editProject = (p: Project) => {
    setProjectRaw(p);
    setOutputs([]);
  };
  async function unlock() {
    setUnlocking(true);
    setError("");
    try {
      if (hasParentPin()) await unlockParent(pin);
      else await setParentPin(pin);
      setParent(true);
      setGate(false);
      setPin("");
    } catch (e) {
      setError(String(e));
    } finally {
      setUnlocking(false);
    }
  }
  if (callback)
    return (
      <main className="p-8">Signed in to Yoto. You can close this tab.</main>
    );
  return (
    <div className="min-h-dvh pb-10">
      <header className="app-header">
        <a href="#main" className="sr-only focus:not-sr-only">
          Skip to content
        </a>
        <div className="flex items-center gap-3">
          <BookOpen className="text-amber-300" />
          <div>
            <h1 className="text-xl font-semibold">
              {parent ? "Yoto Card Studio" : "Evie’s listening room"}
            </h1>
            <p className="text-sm text-slate-300">
              {parent
                ? "Family library & card maker"
                : "A world of stories and sounds"}
            </p>
          </div>
        </div>
        <button
          className="btn shrink-0"
          onClick={() => {
            if (parent) {
              setParent(false);
              setTab("library");
            } else if (!hasParentPin()) {
              setParent(true);
              setGate(false);
            } else setGate(!gate);
          }}
        >
          <Lock size={16} />
          {parent ? "Child view" : hasParentPin() ? "Unlock tools" : "Editing tools"}
        </button>
      </header>
      <main id="main" className="mx-auto max-w-5xl px-4 py-6 md:px-8 md:py-10">
        {error && (
          <p
            role="alert"
            className="mb-5 rounded-xl bg-red-950 p-4 text-red-100"
          >
            {error}
            <button className="btn ml-3" onClick={() => setError("")}>
              Dismiss
            </button>
          </p>
        )}
        {gate && !parent && (
          <form
            className="card mb-8 max-w-md space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              unlock();
            }}
          >
            <h2 className="text-xl font-semibold">
              {hasParentPin()
                ? "Welcome back, grown-up"
                : "Set up the parent area"}
            </h2>
            <p className="text-sm text-slate-300">
              {hasParentPin()
                ? "Enter your PIN to manage audio and cards."
                : "A grown-up should choose a 6–12 digit PIN. This locks editing on this browser; it is not a family account."}
            </p>
            <label className="block">
              Parent PIN
              <input
                className="field mt-2 w-full"
                type="password"
                inputMode="numeric"
                autoComplete="off"
                minLength={6}
                maxLength={12}
                value={pin}
                onChange={(e) => setPin(e.target.value)}
              />
            </label>
            <button className="btn-primary" disabled={unlocking}>
              {unlocking
                ? "Checking…"
                : hasParentPin()
                  ? "Unlock parent area"
                  : "Set PIN and unlock"}
            </button>
          </form>
        )}
        {parent && (
          <>
            <nav
              aria-label="Parent navigation"
              className="mb-8 flex flex-wrap gap-2"
            >
              {TABS.filter((t) => !("needsProject" in t) || project).map(
                (t) => (
                  <button
                    className={tab === t.id ? "btn-primary" : "btn"}
                    aria-current={tab === t.id ? "page" : undefined}
                    key={t.id}
                    onClick={() => setTab(t.id)}
                  >
                    <t.icon size={17} />
                    {t.label}
                  </button>
                ),
              )}
            </nav>
            {project && (
              <p className="mb-5 text-sm text-slate-300">
                {project.title} · {project.tracks.length} tracks ·{" "}
                <span role="status">{status}</span>
              </p>
            )}
          </>
        )}
        {(!parent || tab === "library") && (
          <FamilyLibrary
            key={parent ? "parent" : "child"}
            parent={parent}
            onProject={(p) => parent && openProject(p)}
          />
        )}
        {parent && tab === "projects" && (
          <ProjectShelf project={project} onOpen={openProject} />
        )}
        {parent && tab === "import" && <IngestPanel onProject={openProject} />}
        {parent && tab === "studio" && project && (
          <ChapterStudio project={project} onChange={editProject} />
        )}
        {parent && tab === "icons" && project && (
          <IconStudio project={project} onChange={editProject} />
        )}
        {parent && tab === "export" && project && (
          <ExportPanel
            project={project}
            onChange={editProject}
            outputs={outputs}
            setOutputs={setOutputs}
          />
        )}
        {parent && tab === "nfc" && <NfcPanel />}
        {parent && tab === "settings" && <SettingsPanel />}
        {parent && tab === "connections" && <Connections />}
      </main>
    </div>
  );
}
