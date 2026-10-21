import { useState } from 'react';
import { CircleCheck, Copy } from 'lucide-react';
import { getClientId, redirectUri, setClientId } from '../lib/yoto/auth';
import * as helper from '../lib/helper';
import { Alert } from './IngestPanel';

export function SettingsPanel() {
  const [clientId, setId] = useState(getClientId());
  const [h, setH] = useState(helper.getHelper());
  const [check, setCheck] = useState<{ ok?: string; err?: string }>({});
  const [saved, setSaved] = useState(false);

  const save = () => {
    setClientId(clientId);
    helper.setHelper(h.url, h.token);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  const test = async () => {
    helper.setHelper(h.url, h.token);
    setCheck({});
    try {
      const r = await helper.health();
      setCheck(r.ytDlp && r.ffmpeg ? { ok: `Connected · yt-dlp ${r.ytDlp}` } : { err: `Helper is up but ${!r.ytDlp ? 'yt-dlp' : 'ffmpeg'} isn’t installed on the laptop.` });
    } catch (e) {
      setCheck({ err: String(e) });
    }
  };

  return (
    <div className="space-y-4">
      <section className="card space-y-3">
        <h3 className="font-medium text-white">Yoto API</h3>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-400">
          <li>Sign in at <a className="text-amber-400" href="https://dashboard.yoto.dev" target="_blank" rel="noreferrer">dashboard.yoto.dev</a> and create a public (browser) app.</li>
          <li>Add this exact callback URL to the app:</li>
        </ol>
        <button className="flex w-full items-center gap-2 rounded-lg bg-slate-950/60 px-3 py-2 text-left font-mono text-xs text-slate-300" onClick={() => navigator.clipboard?.writeText(redirectUri())}>
          <span className="flex-1 break-all">{redirectUri()}</span> <Copy size={14} />
        </button>
        <label className="block">
          <span className="text-xs text-slate-500">Client ID</span>
          <input className="field mt-1 w-full font-mono" value={clientId} onChange={(e) => setId(e.target.value)} />
        </label>
      </section>

      <section className="card space-y-3">
        <h3 className="font-medium text-white">Rip helper (laptop)</h3>
        <p className="text-sm text-slate-400">
          On the laptop itself use <code className="text-slate-300">http://localhost:8787</code>. From the phone, use the https tunnel URL the helper prints.
        </p>
        <label className="block">
          <span className="text-xs text-slate-500">Helper URL</span>
          <input className="field mt-1 w-full font-mono" inputMode="url" value={h.url} onChange={(e) => setH({ ...h, url: e.target.value })} />
        </label>
        <label className="block">
          <span className="text-xs text-slate-500">Token (printed when the helper starts)</span>
          <input className="field mt-1 w-full font-mono" value={h.token} onChange={(e) => setH({ ...h, token: e.target.value })} />
        </label>
        <button className="btn w-full" onClick={test}>Test connection</button>
        {check.ok && <p className="flex items-center gap-2 text-sm text-emerald-300"><CircleCheck size={16} /> {check.ok}</p>}
        {check.err && <Alert text={check.err} />}
      </section>

      <button className="btn-primary w-full" onClick={save}>{saved ? 'Saved' : 'Save settings'}</button>
    </div>
  );
}
