import { useEffect, useState, type ReactNode } from 'react';
import { AudioLines, Download, Nfc, Paintbrush, Settings, Upload, X, House, Library, Printer } from 'lucide-react';
import type { Output, Project } from './types';
import { completeSignInIfCallback } from './lib/yoto/auth';
import { IngestPanel } from './components/IngestPanel';
import { ChapterStudio } from './components/ChapterStudio';
import { IconStudio } from './components/IconEditor';
import { ExportPanel } from './components/ExportPanel';
import { NfcPanel } from './components/NfcPanel';
import { SettingsPanel } from './components/SettingsPanel';
import { LibraryPanel, getLibraryFile, loadProject, saveProject } from './components/LibraryPanel';
import { LabelDesigner } from './components/LabelDesigner';
import { probe } from './lib/audio/ffmpeg';
import { cleanTitle, stem } from './lib/time';
import { uid } from './types';

type Tab = 'home' | 'library' | 'import' | 'studio' | 'icons' | 'export' | 'labels' | 'nfc' | 'settings';

const TABS: { id: Tab; label: string; icon: ReactNode; needsProject?: boolean }[] = [
  { id: 'home', label: 'Home', icon: <House size={20} /> },
  { id: 'library', label: 'Library', icon: <Library size={20} /> },
  { id: 'import', label: 'Import', icon: <Upload size={20} /> },
  { id: 'studio', label: 'Chapters', icon: <AudioLines size={20} />, needsProject: true },
  { id: 'icons', label: 'Icons', icon: <Paintbrush size={20} />, needsProject: true },
  { id: 'export', label: 'Export', icon: <Download size={20} />, needsProject: true },
  { id: 'labels', label: 'Label Designer', icon: <Printer size={20} /> },
  { id: 'nfc', label: 'NFC', icon: <Nfc size={20} /> },
  { id: 'settings', label: 'Settings', icon: <Settings size={20} /> },
];

export default function App() {
  const [tab, setTab] = useState<Tab>('home');
  const [project, setProjectRaw] = useState<Project | null>(null);
  const [outputs, setOutputs] = useState<Output[]>([]);
  const [callback, setCallback] = useState(false);
  const [saveState, setSaveState] = useState('');

  useEffect(() => {
    completeSignInIfCallback()
      .then((was) => was && setCallback(true))
      .catch((e) => alert(String(e)));
  }, []);

  useEffect(() => {
    if (project?.libraryId) localStorage.setItem('yoto.lastLibraryId',project.libraryId);
  }, [project?.libraryId]);

  useEffect(() => {
    if (!project?.libraryId) return;
    setSaveState('Saving…');
    const timer = setTimeout(() => {
      const metadata = {title:project.title,artist:project.artist,codec:project.codec,duration:project.duration,
        tracks:project.tracks.map(t=>({id:t.id,title:t.title,start:t.start,icon:t.icon?Array.from(t.icon):undefined}))};
      saveProject(project.libraryId!,metadata).then(()=>setSaveState('Saved on server')).catch(()=>setSaveState('Save failed — changes not stored'));
    }, 900);
    return () => clearTimeout(timer);
  }, [project]);

  const openSaved = async (id:string, file:File) => {
    const saved=await loadProject(id);
    const details=await probe(file).catch(()=>null);
    setProjectRaw({
      libraryId:id,title:saved?.title || details?.album || stem(file.name),artist:saved?.artist || '',
      source:file,codec:saved?.codec || details?.codec,duration:saved?.duration || details?.duration || 0,
      tracks:saved?.tracks?.map((t:{id:string;title:string;start:number;icon?:number[]})=>({...t,icon:t.icon?new Uint8Array(t.icon):undefined}))
        || [{id:uid(),title:cleanTitle(file.name),start:0}]
    });
    setOutputs([]);
    setTab('studio');
  };

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

  const visible = TABS;

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
                className={`flex flex-col items-center gap-1 px-2 py-2.5 text-xs transition lg:w-full lg:flex-row lg:gap-3 lg:rounded-xl lg:px-3 lg:text-sm ${
                  tab === t.id ? 'text-amber-400 lg:bg-white/5' : 'text-slate-400 hover:text-slate-200'
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
            {project && <p className="truncate text-sm text-slate-500">{project.title} · {project.tracks.length} tracks {project.libraryId && '· '+saveState}</p>}
          </div>
          {project && (
            <button
              className="btn shrink-0"
              onClick={() => {
                if (confirm(project.libraryId ? 'Close this project? Changes still saving may be lost.' : 'Close this project? This project has no server backup yet. Unsaved work will be lost.')) {
                  setProject(null);
                  setTab('home');
                }
              }}
            >
              <X size={16} /> Close
            </button>
          )}
        </header>

        {tab === 'home' && <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
          <section className="grid grid-cols-2 gap-3 self-start">
            {TABS.filter(t=>t.id!=='home').map(t=><button key={t.id} className="card flex min-h-24 flex-col items-center justify-center gap-2 text-center hover:ring-1 hover:ring-amber-400" onClick={()=>setTab(t.id)}>{t.icon}<span>{t.label}</span></button>)}
          </section>
          <section className="space-y-4">
            <div className="card space-y-3"><h2 className="text-lg font-semibold">Continue working</h2>
              {project?<><p className="break-words">{project.title}</p><button className="btn-primary" onClick={()=>setTab('studio')}>Resume Studio</button></>:<p className="text-slate-400">Open a saved audiobook or start a new project.</p>}
              {!project && localStorage.getItem('yoto.lastLibraryId') && <button className="btn" onClick={async()=>{try{const id=localStorage.getItem('yoto.lastLibraryId')!;await openSaved(id,await getLibraryFile(id))}catch{setTab('library')}}}>Restore last project</button>}
            </div>
            <div className="card space-y-3"><h2 className="text-lg font-semibold">Your audio library</h2><p className="text-sm text-slate-400">Converted audio is saved on the server when a new import completes.</p><button className="btn" onClick={()=>setTab('library')}>Browse Library</button><button className="btn" onClick={()=>setTab('import')}>Import Audio</button></div>
          </section>
        </div>}
        {tab === 'library' && <LibraryPanel onOpen={openSaved} />}
        {tab === 'labels' && <LabelDesigner />}
        {tab === 'import' && (
          <IngestPanel
            onProject={(p) => {
              setProject(p);
              setTab(p.source ? 'studio' : 'export');
            }}
          />
        )}
        {tab === 'studio' && !project && <p className="text-slate-400">Import or open a project to edit its chapters.</p>}
        {tab === 'studio' && project && <ChapterStudio project={project} onChange={editProject} />}
        {tab === 'icons' && !project && <p className="text-slate-400">Import or open a project to edit its icons.</p>}
        {tab === 'icons' && project && <IconStudio project={project} onChange={editProject} />}
        {tab === 'export' && !project && <p className="text-slate-400">Import or open a project to export audio.</p>}
        {tab === 'export' && project && <ExportPanel project={project} onChange={editProject} outputs={outputs} setOutputs={setOutputs} />}
        {tab === 'nfc' && <NfcPanel />}
        {tab === 'settings' && <SettingsPanel />}
      </main>
    </div>
  );
}
