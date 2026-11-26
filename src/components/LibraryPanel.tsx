import { useEffect, useState } from 'react';
import { getHelper } from '../lib/helper';
export type LibraryItem = {id:string;name:string;size:number;created:string};
async function api(path:string, init:RequestInit={}) {
 const {url,token}=getHelper();
 const r=await fetch(url+path,{...init,headers:{'x-helper-token':token,...init.headers}});
 if(!r.ok) throw new Error(await r.text());
 return r;
}
export const uploadLibraryFile=async(file:File):Promise<{id:string}> => {
 const r=await api('/library/upload',{method:'POST',headers:{'Content-Type':'application/octet-stream','x-audio-filename':encodeURIComponent(file.name)},body:file});
 return r.json();
};
export const getLibrary=async():Promise<LibraryItem[]> => (await api('/library')).json();
export const getLibraryFile=async(id:string):Promise<File> => {
 const r=await api('/library/'+id+'/file');
 const name=decodeURIComponent(r.headers.get('x-filename')||'audio.mp3');
 return new File([await r.blob()],name,{type:'audio/mpeg'});
};
export const loadProject=async(id:string) => (await api('/library/'+id+'/project')).json();
export const saveProject=async(id:string,p:unknown) => api('/library/'+id+'/project',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(p)});
export const removeLibraryItem=async(id:string) => api('/library/'+id,{method:'DELETE'});
export function LibraryPanel({onOpen}:{onOpen:(id:string,file:File)=>Promise<void>}) {
 const [items,setItems]=useState<LibraryItem[]>([]);
 const [error,setError]=useState('');
 const [busy,setBusy]=useState('');
 const refresh=()=>getLibrary().then(setItems).catch(e=>setError(String(e)));
 useEffect(()=>{refresh()},[]);
 return <section className="space-y-4">
 <div className="flex items-center justify-between"><h2 className="text-lg font-semibold">Saved audio</h2><button className="btn" onClick={refresh}>Refresh</button></div>
 <p className="text-sm text-slate-400">Completed YouTube conversions are stored on the Dell server. Deleting audio also removes its saved chapter project.</p>
 {error&&<p className="text-red-300">{error}</p>}
 {items.length===0&&<p className="text-slate-400">No saved audio yet, or the server is unavailable.</p>}
 {items.map(i=><div key={i.id} className="card flex flex-wrap items-center justify-between gap-3">
 <div className="min-w-0"><p className="break-words font-medium">{i.name}</p><p className="text-xs text-slate-400">{(i.size/1048576).toFixed(1)} MB · {i.created?.slice(0,10)}</p></div>
 <div className="flex flex-wrap gap-2">
 <button className="btn" disabled={!!busy} onClick={async()=>{setBusy(i.id);try{await onOpen(i.id,await getLibraryFile(i.id))}catch(e){setError(String(e))}finally{setBusy('')}}}>{busy===i.id?'Loading…':'Open Studio'}</button>
 <button className="btn" disabled={!!busy} onClick={async()=>{setBusy(i.id);try{const f=await getLibraryFile(i.id);const u=URL.createObjectURL(f);const a=document.createElement('a');a.href=u;a.download=f.name;a.click();setTimeout(()=>URL.revokeObjectURL(u),30000)}catch(e){setError(String(e))}finally{setBusy('')}}}>Download</button>
 <button className="btn" disabled={!!busy} onClick={async()=>{if(!confirm('Permanently delete this audio and its saved project?'))return;setBusy(i.id);try{await removeLibraryItem(i.id);refresh()}catch(e){setError(String(e))}finally{setBusy('')}}}>Delete</button>
 </div></div>)}
 </section>
}
