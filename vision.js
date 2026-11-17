// Street-scene indicators use one segmentation pass per photograph.
let sessionTask, inferenceTail=Promise.resolve();
const bytes64=s=>Uint8Array.fromBase64?Uint8Array.fromBase64(s):Uint8Array.from(atob(s),c=>c.charCodeAt(0));
function loadVisionScript(name){
 return new Promise((resolve,reject)=>{
   const script=document.createElement('script'),packed=document.getElementById(name);
   if(packed){script.textContent=packed.textContent;document.head.append(script);script.remove();resolve();return}
   script.onload=resolve;script.onerror=()=>reject(Error('无法读取本地分割模型 '+name));
   script.src=name;document.head.append(script);
 });
}
function visionSession(){
 if(!sessionTask){
   sessionTask=(async()=>{
     if(typeof ort==='undefined')await loadVisionScript('ort.min.js');
     if(typeof VISION_MODEL==='undefined')await loadVisionScript('vision-assets.js');
     ort.env.wasm.numThreads=1;
     ort.env.wasm.wasmPaths={'ort-wasm-simd.wasm':URL.createObjectURL(new Blob([bytes64(VISION_WASM)],{type:'application/wasm'}))};
     return ort.InferenceSession.create(bytes64(VISION_MODEL),{executionProviders:['wasm']});
   })().catch(err=>{sessionTask=null;throw err});
 }
 return sessionTask;
}
function colourEntropy(img){
 const bins=Array(27).fill(0);let count=0,green=0;
 for(let i=0;i<img.length;i+=4){
   if(img[i+3]<128)continue;
   const r=img[i],g=img[i+1],b=img[i+2],hi=Math.max(r,g,b),lo=Math.min(r,g,b),delta=hi-lo;
   count++;if(g>45&&g>1.12*r&&g>1.12*b)green++;
   let bin=Math.min(2,Math.floor(hi/86));
   if(hi>35&&delta/hi>.17){
     let hue=hi===r?(g-b)/delta:hi===g?(b-r)/delta+2:(r-g)/delta+4;
     bin=3+Math.floor(((hue+6)%6)*2)+(hi>=150?12:0);
   }
   bins[bin]++;
 }
 if(!count)throw Error('空图');
 return {g:green/count,colour:-bins.reduce((s,n)=>s+(n?n/count*Math.log(n/count):0),0)/Math.log(27)};
}
function sceneMeasures(bitmap){
 const canvas=document.createElement('canvas');canvas.width=120;canvas.height=80;
 const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(bitmap,0,0,120,80);
 const base=colourEntropy(ctx.getImageData(0,0,120,80).data);
 const scale=480/Math.max(bitmap.width,bitmap.height);
 const w=canvas.width=Math.max(64,32*Math.round(bitmap.width*scale/32));
 const h=canvas.height=Math.max(64,32*Math.round(bitmap.height*scale/32));
 ctx.drawImage(bitmap,0,0,w,h);
 const px=ctx.getImageData(0,0,w,h).data,size=w*h,values=new Float32Array(3*size);
 for(let j=0;j<3;j++)for(let i=0;i<size;i++)values[j*size+i]=(px[4*i+j]/255-[.485,.456,.406][j])/[.229,.224,.225][j];
 const run=async()=>{
   const session=await visionSession(),tensor=new ort.Tensor('float32',values,[1,3,h,w]);
   let result;
   try{
     result=await session.run({[session.inputNames[0]]:tensor});
     const logits=result[session.outputNames[0]],n=logits.dims[2]*logits.dims[3],classes=logits.dims[1],counts=Array(classes).fill(0);
     if(classes!==19)throw Error('模型标签不匹配');
     for(let i=0;i<n;i++){let best=0;for(let j=1;j<classes;j++)if(logits.data[j*n+i]>logits.data[best*n+i])best=j;counts[best]++}
     return {...base,road:counts[0]/n,sidewalk:counts[1]/n,building:counts[2]/n,vegetation:counts[8]/n,sky:counts[10]/n};
   }finally{tensor.dispose?.();for(const t of Object.values(result||{}))t.dispose?.()}
 };
 const current=inferenceTail.then(run);inferenceTail=current.catch(()=>{});
 return current.catch(e=>({...base,semanticError:String(e.message).slice(0,140)}));
}
