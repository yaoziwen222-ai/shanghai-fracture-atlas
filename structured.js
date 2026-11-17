function localBuildings(bbox){
 const corners=[[bbox[0],bbox[1]],[bbox[0],bbox[3]],[bbox[2],bbox[1]],[bbox[2],bbox[3]]].map(ll=>utm51.forward(ll));
 const xs=corners.map(p=>p[0]),ys=corners.map(p=>p[1]),seen=new Set(),out=[];
 for(let i=Math.floor((Math.min(...xs)-240)/500);i<=Math.floor((Math.max(...xs)+240)/500);i++){
   for(let j=Math.floor((Math.min(...ys)-240)/500);j<=Math.floor((Math.max(...ys)+240)/500);j++){
     const tile=QGIS_BUILDINGS[i+','+j];if(!tile)continue;
     for(const [id,floors,rings] of JSON.parse(new TextDecoder().decode(fflate.gunzipSync(bytes64(tile))))){
       if(seen.has(id))continue;seen.add(id);
       const parts=rings.map(r=>{
         const pts=r.map(p=>xy(...utm51.inverse([p[0]/10,p[1]/10])));
         let winding=0;for(let k=1;k<pts.length;k++)winding+=pts[k-1][0]*pts[k][1]-pts[k][0]*pts[k-1][1];
         return {pts,sign:-Math.sign(winding)};
       });
       const pts=parts.flatMap(p=>p.pts),px=pts.map(p=>p[0]),py=pts.map(p=>p[1]);
       out.push({floors,parts,box:[Math.min(...px),Math.min(...py),Math.max(...px),Math.max(...py)]});
     }
   }
 }
 return out;
}
function localFloorPair(buildings,s,R,local,U){
 const sides=[{n:0,area:0,known:0,sum:0},{n:0,area:0,known:0,sum:0}];
 for(const b of buildings){
   const [w,south,e,n]=b.box;
   if(e<s.mid[0]-R||w>s.mid[0]+R||n<s.mid[1]-R||south>s.mid[1]+R)continue;
   const areas=[0,0];
   for(const part of b.parts){
     const pts=part.pts.map(local);
     for(const k of [0,1])areas[k]+=part.sign*clipRect(pts,-U,U,k?4:-110,k?110:-4);
   }
   sides.forEach((side,i)=>{const a=areas[i];if(a<=1)return;side.area+=a;
     if(b.floors>0){side.n++;side.known+=a;side.sum+=a*b.floors}
   });
 }
 return sides.map(v=>({area:v.area,coverage:v.area?v.known/v.area:0,val:v.n>=2&&v.known>=.65*v.area?v.sum/v.known:null}));
}
const amapCategories={'06':'零售','07':'生活服务','08':'文化休闲','09':'健康','11':'文化休闲','14':'教育'};
function supplementFacilities(points,bbox,rows,raw){
 const pad=[bbox[0]-240/MX,bbox[1]-240/MY,bbox[2]+240/MX,bbox[3]+240/MY];
 const all=new Map(),byName=new Map(),originals=new Map();
 function add([x,y,id,name,code],label){
   const category=amapCategories[String(code).slice(0,2)];
   if(!id||!name||!category||!inside([x,y],pad))return;
   const old=all.get(id),sources=old?.sources||new Set();
   originals.set(label+'|'+id,[...xy(x,y),label]);sources.add(label);all.set(id,{p:[...xy(x,y),category,name,id,null,'extra'],sources});
 }
 archiveTiles(QGIS_POIS,pad,record=>add(record,'QGIS'));
 for(const row of rows||[])add(row.slice(0,5),row[5]||'高德在线');
 for(const p of points){
   const key=shopNames(p[3]).full;
   if(!byName.has(key))byName.set(key,[]);byName.get(key).push(p);
 }
 const matches=[],used=new Set(),merged=new Set();
 for(const entry of all.values()){
   const p=entry.p,key=shopNames(p[3]).full;
   if(!key)continue;
   for(const existing of byName.get(key)||[]){
     const gap=distance(p,existing);if(gap<=25)matches.push({entry,existing,gap});
   }
 }
 for(const {entry,existing} of matches.sort((a,b)=>a.gap-b.gap)){
   if(used.has(existing)||merged.has(entry))continue;
   existing[8]=[...entry.sources];used.add(existing);merged.add(entry);
 }
 for(const entry of all.values())if(!merged.has(entry)){
   entry.p[8]=[...entry.sources];points.push(entry.p);
 }
 for(const record of originals.values())raw.push(record);
 return points;
}
const collectionService=location.protocol==='http:'&&location.hostname==='127.0.0.1'&&location.pathname==='/';
async function queryFacilities(box,signal){
 if(!collectionService)return {rows:[],status:'本地存档'};
 try{
   const res=await fetch('/api/amap?bbox='+box.join(','),{signal,headers:{'X-Atlas-Selection':'1'}});
   if(!res.ok)throw Error();
   const data=await res.json();
   if(!Array.isArray(data.rows))throw Error();
   return data;
 }catch(err){if(signal.aborted)throw err;return {rows:[],status:'在线设施查询失败，采用本地存档'}}
}
