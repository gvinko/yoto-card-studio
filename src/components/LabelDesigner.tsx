import {useState} from 'react';
export function LabelDesigner(){
 const [image,setImage]=useState('');
 const [title,setTitle]=useState('');
 const [zoom,setZoom]=useState(100);
 const [w,setW]=useState(54);
 const [h,setH]=useState(86);
 const [count,setCount]=useState(6);
 return <div className="space-y-4">
 <h2 className="font-semibold">Full-face card labels</h2>
 <p className="text-sm text-slate-400">Print on A4 adhesive paper using your Canon PIXMA. Confirm the dimensions against your existing template before printing.</p>
 <div className="flex flex-wrap gap-3">
 <label className="text-sm">Image<input className="field block" type="file" accept="image/*" onChange={e=>{const f=e.target.files?.[0];if(f){const reader=new FileReader();reader.onload=()=>setImage(String(reader.result));reader.readAsDataURL(f)}}}/></label>
 <label className="text-sm">Title<input className="field block" value={title} onChange={e=>setTitle(e.target.value)}/></label>
 <label className="text-sm">Width mm<input className="field block w-24" type="number" min="20" max="100" value={w} onChange={e=>setW(+e.target.value)}/></label>
 <label className="text-sm">Height mm<input className="field block w-24" type="number" min="20" max="130" value={h} onChange={e=>setH(+e.target.value)}/></label>
 <label className="text-sm">Copies<input className="field block w-24" type="number" min="1" max="12" value={count} onChange={e=>setCount(+e.target.value)}/></label>
 <label className="text-sm">Zoom {zoom}%<input className="block" type="range" min="100" max="200" value={zoom} onChange={e=>setZoom(+e.target.value)}/></label>
 </div>
 <button className="btn-primary" onClick={()=>window.print()}>Print A4 sheet at 100% scale</button>
 <div className="label-sheet" style={{width:'210mm',minHeight:'297mm',padding:'12mm',background:'white',display:'flex',flexWrap:'wrap',alignContent:'flex-start',gap:'3mm'}}>
 {Array.from({length:Math.min(12,Math.max(1,count))},(_,i)=><div key={i} style={{width:w+'mm',height:h+'mm',border:'1px dashed #999',position:'relative',overflow:'hidden',background:'#eee',flexShrink:0}}>
 {image&&<img src={image} style={{width:'100%',height:'100%',objectFit:'cover',transform:'scale('+zoom/100+')'}} alt="Card artwork"/>}
 {title&&<div style={{position:'absolute',bottom:4,left:4,right:4,textAlign:'center',fontSize:12,fontWeight:700,color:'white',textShadow:'0 1px 3px black'}}>{title}</div>}
 </div>)}
 </div>
 <style>{'@media print { body * { visibility:hidden!important } .label-sheet,.label-sheet * { visibility:visible!important } .label-sheet { position:absolute!important;left:0;top:0; margin:0!important;box-shadow:none!important } @page {size:A4; margin:0} }'}</style>
 </div>
}
