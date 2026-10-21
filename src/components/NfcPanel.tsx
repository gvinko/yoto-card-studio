import { useRef, useState } from 'react';
import { CircleCheck, Eraser, LoaderCircle, Nfc, ShieldAlert, X } from 'lucide-react';
import { chipFit, estimateBytes, guardedWrite, nfcSupported, readTag, type TagInfo, type WritePayload } from '../lib/nfc/webnfc';
import { Alert } from './IngestPanel';

export function NfcPanel() {
  const [tag, setTag] = useState<TagInfo | null>(null);
  const [mode, setMode] = useState<'idle' | 'read' | 'write' | 'wipe'>('idle');
  const [kind, setKind] = useState<'url' | 'text'>('url');
  const [value, setValue] = useState('');
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const abort = useRef<AbortController | null>(null);

  if (!nfcSupported())
    return (
      <section className="card text-center">
        <Nfc className="mx-auto mb-3 text-slate-500" size={36} />
        <p className="font-medium text-white">Open this on your Android phone</p>
        <p className="mx-auto mt-1 max-w-sm text-sm text-slate-400">
          Web NFC only exists in Chrome on Android. Desktop browsers and USB readers (ACR122U) aren’t supported by it.
        </p>
      </section>
    );

  const start = async (m: 'read' | 'write' | 'wipe') => {
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setError('');
    setMsg('');
    setMode(m);
    try {
      if (m === 'read') setTag(await readTag(ctrl.signal));
      else {
        const payload: WritePayload = m === 'wipe' ? { kind: 'empty' } : { kind, value };
        const before = await guardedWrite(payload, ctrl.signal);
        setTag(before);
        setMsg(m === 'wipe' ? `Wiped tag ${before.serial}` : `Written to tag ${before.serial}`);
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError((e as Error).message);
    }
    setMode('idle');
  };

  const payload: WritePayload = { kind, value };
  const bytes = value ? estimateBytes(payload) : 0;

  return (
    <div className="space-y-4">
      <p className="flex gap-2 rounded-xl bg-slate-800/60 p-3 text-sm text-slate-300 ring-1 ring-white/5">
        <ShieldAlert size={16} className="mt-0.5 shrink-0 text-amber-400" />
        For blank NTAG213/215/216 tags only. Tags carrying a Yoto link are detected and never written. Yoto MYO cards are linked in the Yoto app, not here.
      </p>

      {mode !== 'idle' && (
        <section className="card flex items-center gap-3">
          <LoaderCircle className="animate-spin text-amber-400" size={22} />
          <p className="flex-1 text-white">Hold a tag against the back of the phone…</p>
          <button className="btn" onClick={() => abort.current?.abort()}><X size={16} /></button>
        </section>
      )}

      <section className="card">
        <h3 className="mb-3 font-medium text-white">Read</h3>
        <button className="btn w-full" disabled={mode !== 'idle'} onClick={() => start('read')}>
          <Nfc size={16} /> Scan a tag
        </button>
        {tag && (
          <div className="mt-3 rounded-xl bg-slate-950/50 p-3 text-sm">
            <p className="font-mono text-white">UID {tag.serial || '—'}</p>
            {tag.isYoto && <p className="mt-1 text-amber-300">Yoto card — read-only here.</p>}
            {tag.records.length === 0 ? (
              <p className="mt-1 text-slate-400">No NDEF records (blank or unformatted).</p>
            ) : (
              <ul className="mt-2 space-y-1">
                {tag.records.map((r, i) => (
                  <li key={i} className="break-all text-slate-300">
                    <span className="mr-2 rounded bg-white/5 px-1.5 py-0.5 font-mono text-xs text-slate-400">{r.type}</span>
                    {r.value || <span className="text-slate-500">({r.bytes} bytes)</span>}
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-xs text-slate-500">Chip model and memory size aren’t exposed by Web NFC.</p>
          </div>
        )}
      </section>

      <section className="card">
        <h3 className="mb-3 font-medium text-white">Write</h3>
        <div className="mb-2 flex gap-2">
          {(['url', 'text'] as const).map((k) => (
            <button key={k} className={`btn flex-1 ${kind === k ? 'bg-amber-500 text-slate-950 hover:bg-amber-400' : ''}`} onClick={() => setKind(k)}>
              {k === 'url' ? 'Link' : 'Text'}
            </button>
          ))}
        </div>
        <input className="field w-full" placeholder={kind === 'url' ? 'https://…' : 'Text'} value={value} onChange={(e) => setValue(e.target.value)} />
        {value && <p className="mt-2 text-xs text-slate-400">≈{bytes} bytes · {chipFit(bytes)}</p>}
        <button className="btn-primary mt-3 w-full" disabled={!value || mode !== 'idle'} onClick={() => start('write')}>
          Write on next tap
        </button>
        <button className="btn mt-2 w-full" disabled={mode !== 'idle'} onClick={() => confirm('Erase the next tag you tap?') && start('wipe')}>
          <Eraser size={16} /> Wipe a tag
        </button>
        {msg && (
          <p className="mt-3 flex items-center gap-2 text-sm text-emerald-300">
            <CircleCheck size={16} /> {msg}
          </p>
        )}
        {error && <div className="mt-3"><Alert text={error} /></div>}
      </section>
    </div>
  );
}
