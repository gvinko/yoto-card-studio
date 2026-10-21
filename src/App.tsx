import { useEffect, useState, type ReactNode } from 'react';
import { AudioLines, Download, Nfc, Paintbrush, Settings, Upload, X } from 'lucide-react';
import type { Output, Project } from './types';
import { completeSignInIfCallback } from './lib/yoto/auth';
import { IngestPanel } from './components/IngestPanel';
import { ChapterStudio } from './components/ChapterStudio';
import { IconStudio } from './components/IconEditor';
import { ExportPanel } from './components/ExportPanel';
import { NfcPanel } from './components/NfcPanel';
import { SettingsPanel } from './components/SettingsPanel';

type Tab = 'import' | 'studio' | 'icons' | 'export' | 'nfc' | 'settings';

const TABS: { id: Tab; label: string; icon: ReactNode; needsProject?: boolean }[] = [
  { id: 'import', label: 'Import', icon: <Upload size={20} /> },
  { id: 'studio', label: 'Chapters', icon: <AudioLines size={20} />, needsProject: true },
  { id: 'icons', label: 'Icons', icon: <Paintbrush size={20} />, needsProject: true },
  { id: 'export', label: 'Export', icon: <Download size={20} />, needsProject: true },
  { id: 'nfc', label: 'NFC', icon: <Nfc size={20} /> },
  { id: 'settings', label: 'Settings', icon: <Settings size={20} /> },
];

export default function App() {
  const [tab, setTab] = useState<Tab>('import');
  const [project, setProjectRaw] = useState<Project | null>(null);
  const [outputs, setOutputs] = useState<Output[]>([]);
  const [callback, setCallback] = useState(false);

  useEffect(() => {
    completeSignInIfCallback()
      .then((was) => was && setCallback(true))
      .catch((e) => alert(String(e)));
  }, []);

  // Any edit to tracks invalidates built files.
  const setProject = (p: Project | null) => {
    setProjectRaw(p);
    setOutputs([]);
  };
  const editProject = (p: Project) => {
    setProjectRaw((prev) => {
      if (prev && (prev.tracks !== p.tracks || prev.title !== p.title || prev.artist !== p.artist)) setOutputs([]);
      return p;
    });
  };

  if (callback)
    return <div className="grid min-h-dvh place-items-center p-6 text-center text-slate-300">Signed in to Yoto. You can close this tab.</div>;

  const visible = TABS.filter((t) => !t.needsProject || project);

  return (
    <div className="min-h-dvh pb-24 lg:pb-0 lg:pl-56">
      <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-white/5 bg-[#0b0f17]/90 backdrop-blur-xl lg:inset-y-0 lg:left-0 lg:right-auto lg:w-56 lg:border-r lg:border-t-0">
        <div className="hidden px-5 pb-6 pt-7 lg:block">
          <p className="text-sm font-semibold tracking-wide text-white">Yoto Card Studio</p>
          <p className="text-xs text-slate-500">Personal edition</p>
        </div>
        <ul className="flex justify-around px-1 pb-[env(safe-area-inset-bottom)] lg:flex-col lg:gap-1 lg:px-3">
          {visible.map((t) => (
            <li key={t.id}>
              <button
                onClick={() => setTab(t.id)}
                className={`flex flex-col items-center gap-1 px-2 py-2.5 text-[11px] transition lg:w-full lg:flex-row lg:gap-3 lg:rounded-xl lg:px-3 lg:text-sm ${
                  tab === t.id ? 'text-amber-400 lg:bg-white/5' : 'text-slate-500 hover:text-slate-200'
                }`}
              >
                {t.icon}
                {t.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <main className="mx-auto max-w-5xl px-4 pt-6 lg:px-8 lg:pt-10">
        <header className="mb-6 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight text-white">{TABS.find((t) => t.id === tab)!.label}</h1>
            {project && <p className="truncate text-sm text-slate-500">{project.title} · {project.tracks.length} tracks</p>}
          </div>
          {project && (
            <button
              className="btn shrink-0"
              onClick={() => {
                if (confirm('Close this project? Unsaved work is lost.')) {
                  setProject(null);
                  setTab('import');
                }
              }}
            >
              <X size={16} /> Close
            </button>
          )}
        </header>

        {tab === 'import' && (
          <IngestPanel
            onProject={(p) => {
              setProject(p);
              setTab(p.source ? 'studio' : 'export');
            }}
          />
        )}
        {tab === 'studio' && project && <ChapterStudio project={project} onChange={editProject} />}
        {tab === 'icons' && project && <IconStudio project={project} onChange={editProject} />}
        {tab === 'export' && project && <ExportPanel project={project} onChange={editProject} outputs={outputs} setOutputs={setOutputs} />}
        {tab === 'nfc' && <NfcPanel />}
        {tab === 'settings' && <SettingsPanel />}
      </main>
    </div>
  );
}
