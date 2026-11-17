'use strict';
const TILEBOX=[120.80,30.65,122.10,31.90];
const footprintTags=['amenity','shop','tourism','office','healthcare','leisure','public_transport'];
function category(t){
 if(t.shop&&t.shop!=='no'&&t.shop!=='vacant')return '零售';
 if(t.healthcare||['hospital','clinic','pharmacy','dentist','doctors'].includes(t.amenity))return '健康';
 if(['school','university','college','kindergarten','library','language_school'].includes(t.amenity))return '教育';
 if(['restaurant','cafe','fast_food','bar','pub','food_court','ice_cream'].includes(t.amenity))return '餐饮';
 if(['hotel','hostel','guest_house','motel'].includes(t.tourism))return '住宿';
 if(['museum','attraction','gallery','artwork'].includes(t.tourism)||['cinema','theatre','arts_centre'].includes(t.amenity)||['park','sports_centre','fitness_centre','playground'].includes(t.leisure))return '文化休闲';
 if(t.office&&t.office!=='no')return '办公';
 if(['bank','post_office','community_centre','police','townhall','social_facility','place_of_worship','marketplace'].includes(t.amenity))return '公共及社区服务';
 return null;
}
function footprint(ids,nodes){
 if(ids[0]!==ids.at(-1)||ids.length<4)return null;
 const p=ids.map(id=>xy(...nodes[id])),o=p[0];let twice=0,x=0,y=0;
 for(let i=0;i<p.length-1;i++){const ax=p[i][0]-o[0],ay=p[i][1]-o[1],bx=p[i+1][0]-o[0],by=p[i+1][1]-o[1],q=ax*by-bx*ay;twice+=q;x+=(ax+bx)*q;y+=(ay+by)*q}
 if(Math.abs(twice)<8)return null;
 return [...lonlat(o[0]+x/(3*twice),o[1]+y/(3*twice)),Math.abs(twice)/2];
}
function parseMap(xmlText){
 const xml=new DOMParser().parseFromString(xmlText,'application/xml');
 if(xml.documentElement.tagName!=='osm')throw Error('地图响应格式错误');
 const nodes={},ways=[],marks=[];
 const tags=e=>Object.fromEntries([...e.getElementsByTagName('tag')].map(t=>[t.getAttribute('k'),t.getAttribute('v')]));
 for(const n of xml.getElementsByTagName('node')){
   const id=n.getAttribute('id'),p=[+n.getAttribute('lon'),+n.getAttribute('lat')],t=tags(n);nodes[id]=p;
   if(category(t))marks.push([...p,t,'n'+id]);
 }
 for(const w of xml.getElementsByTagName('way')){
   const t=tags(w),ids=[...w.getElementsByTagName('nd')].map(n=>n.getAttribute('ref'));
   if(ids.length>1&&ids.every(id=>nodes[id])&&(t.highway||t.building||t.natural==='water'||t.leisure==='park'||['grass','forest','recreation_ground'].includes(t.landuse)||category(t)))ways.push([w.getAttribute('id'),ids,t]);
 }
 if(!ways.some(w=>w[2].highway))throw Error('本区没有返回道路');
 return {nodes,ways,marks,source:'OSM 在线采集',date:new Date().toLocaleDateString('sv-SE')};
}
function cityField(data,bbox){
 const box=boundsXY(bbox),pad=box.map((n,i)=>n+(i<2?-240:240)),out={build:[],poi:[],views:[],photos:[]},named=new Map();
 function addPOI(x,y,t,id){
   const cat=category(t),p=xy(x,y);if(!cat||!inside(p,pad))return;
   const key=cat+'|'+(t.name||'').trim().toLowerCase(),others=named.get(key)||[];
   if(t.name&&others.some(q=>distance(p,q)<25))return;
   others.push(p);named.set(key,others);out.poi.push([...p,cat,t.name||t['name:zh']||'',id,null,'osm',[t['name:zh'],t['name:en']].filter(Boolean)]);
 }
 for(const [x,y,t,id] of data.marks||[])addPOI(x,y,t,id);
 for(const [id,ids,t] of data.ways){
   if(!t.building&&!category(t))continue;
   const poly=footprint(ids,data.nodes);if(!poly)continue;
   const [x,y,area]=poly,p=xy(x,y);if(!inside(p,pad))continue;
   if(t.building&&t.building!=='no')out.build.push([...p,area,id]);
   addPOI(x,y,t,'w'+id);
 }
 out.facilitySamples=[];
 out.poi=supplementFacilities(mergeShopSources(out.poi,dianpingShops(pad)),bbox,data.facilities?.rows,out.facilitySamples);
 for(const [x,y,g] of CITY_GVI){const p=xy(x,y);if(inside(p,pad))out.views.push([...p,g])}
 const observations=new Map();
 function addPhotos(im) {
   for(const q of im?.observations||[]){
     const provider=q.provider||im.provider, key=provider+'/'+q.id,p=xy(q.x,q.y);
     if(!inside(p,pad))continue;
     const previous=observations.get(key);
     if(previous&&(Number.isFinite(previous[3].sky)||!Number.isFinite(q.sky)))continue;
     observations.set(key,[...p,q.g,{...q,provider,traffic:Number.isFinite(q.road)&&q.road+q.sidewalk>=.025?q.road/(q.road+q.sidewalk):null}]);
   }
 }
 addPhotos(data.imagery);
 if(data.savedPhotos)addPhotos({observations:data.savedPhotos});
 if(data!==SNAPSHOT)addPhotos(SNAPSHOT.imagery);
 out.photos=[...observations.values()];
 return out;
}
function linkedSignal(signal,ms){
 const timer=new AbortController(),id=setTimeout(()=>timer.abort(),ms);
 return {signal:AbortSignal.any([signal,timer.signal]),done:()=>clearTimeout(id)};
}
async function greenFraction(href,signal){
 const s=linkedSignal(signal,5200);
 try{const resp=await fetch(href,{signal:s.signal,credentials:'omit'});if(!resp.ok)throw Error('影像不可读');
 const img=await createImageBitmap(await resp.blob());try{
 return await sceneMeasures(img);
 }finally{img.close()}}finally{s.done()}
}
async function panoramaxFor(b,signal,accept=()=>true){
 const out={status:'完成',listed:0,attempted:0,observations:[],capped:false},pts=[];
 const scoped=linkedSignal(signal,13000);
 try{const url='https://api.panoramax.xyz/api/search?limit=100&bbox='+b.join(',');
 const res=await fetch(url,{signal:scoped.signal});if(!res.ok)throw Error('HTTP '+res.status);
 const js=await res.json();if(!Array.isArray(js.features))throw Error('响应格式错误');
 out.listed=js.features.length;out.capped=Boolean(js.links?.some(l=>l.rel==='next'));
 for(const f of js.features){
   if(f.geometry?.type!=='Point')continue;
   const [x,y]=f.geometry.coordinates;if(!inside([x,y],b)||!accept(x,y))continue;
   const a=f.assets||{},href=a.thumb?.href||a.thumbnail?.href||Object.values(a).find(a=>a.roles?.includes('thumbnail'))?.href;
   if(href&&href.startsWith('https://'))pts.push({x,y,href,id:f.id,big:a.hd?.href||a.sd?.href,full:a.hd?.href||a.sd?.href,shotDate:f.properties?.datetime,sequenceId:f.collection,author:f.properties?.['geovisio:producer']||f.properties?.providers?.[0]?.name,license:f.properties?.license});
 }
 }catch(err){if(signal.aborted)throw err;out.status='查询失败：'+err.message;return out}finally{scoped.done()}
 out.catalog=pts;
 const limit=Math.min(16,pts.length);out.capped||=pts.length>limit;out.attempted=limit;
 for(let start=0;start<limit;start+=4){
   if(signal.aborted)throw Error('已取消');
   const batch=Array.from({length:Math.min(4,limit-start)},(_,j)=>pts[Math.floor((start+j)*pts.length/limit)]);
   const got=await Promise.all(batch.map(async q=>{try{return {...q,...await greenFraction(q.href,signal)}}catch{return null}}));out.observations.push(...got.filter(Boolean));
 }return out;
}
async function kartaViewFor(b,signal,deep=false,accept=()=>true){
 const midX=(b[0]+b[2])/2,midY=(b[1]+b[3])/2;
 const cells=[[b[0],b[1],midX,midY],[midX,b[1],b[2],midY],[b[0],midY,midX,b[3]],[midX,midY,b[2],b[3]]];
 const seen=new Set(),selected=[],catalog=[],notes=[];
 let capped=false;
 for(const cell of cells){
   const eligible=[];
   for(let page=1;page<=(deep?8:2);page++){
   const req=linkedSignal(signal,12000);
   try{
     const params=new URLSearchParams({nwLat:cell[3],nwLng:cell[0],seLat:cell[1],seLng:cell[2],itemsPerPage:100,page});
     const resp=await fetch('https://api.kartaview.org/2.0/photo/?'+params,{signal:req.signal});if(!resp.ok)throw Error('HTTP '+resp.status);
     const js=await resp.json();const items=js.result?.data;if(!Array.isArray(items))throw Error('目录响应异常');
     const before=seen.size;
     for(const item of items){
       const id=String(item.id),x=Number(item.lng),y=Number(item.lat);
       if(!inside([x,y],cell)||seen.has(id))continue;seen.add(id);
       if(!accept(x,y))continue;
       if(item.imageThUrl?.startsWith('https://'))eligible.push({x,y,id,href:item.imageThUrl,shotDate:item.shotDate||'',big:item.imageLthUrl,full:item.imageProcUrl,way:item.wayId,sequenceId:item.sequenceId,sequenceIndex:item.sequenceIndex,author:item.username});
     }
     if(!js.result.hasMoreData||!items.length)break;
     if(page===(deep?8:2)||seen.size===before){capped=true;break}
   }catch(err){if(signal.aborted)throw err;notes.push(err.message);break}finally{req.done()}
   }
   const limit=Math.min(deep?160:32,eligible.length);capped||=eligible.length>limit;
   catalog.push(...eligible);
   selected.push(...spatialSample(eligible,limit));
 }
 const frames=[];
 for(let i=0;i<selected.length;i+=6){
   if(signal.aborted)throw Error('已取消');
   const got=await Promise.all(selected.slice(i,i+6).map(async p=>{try{return {...p,...await greenFraction(p.href,signal)}}catch{return null}}));
   frames.push(...got.filter(Boolean));
 }
 const status=notes.length?'有 '+notes.length+' 个子区查询失败（'+notes[0]+'）':'完成';
 return {provider:'KartaView',catalog,status,listed:seen.size,attempted:selected.length,observations:frames,capped};
}
// Round-robin across 45 m cells so a slow drive at one junction does not consume the sample.
function spatialSample(rows,limit){
 if(rows.length<=limit)return rows;
 const cells=new Map();
 for(const row of rows){
   const key=xy(row.x,row.y).map(v=>Math.floor(v/45)).join(',');
   if(!cells.has(key))cells.set(key,[]);
   cells.get(key).push(row);
 }
 const groups=[...cells.values()],out=[];
 for(let n=0;out.length<limit;n++){
   const available=groups.filter(g=>g.length>n),take=Math.min(limit-out.length,available.length);
   for(let i=0;i<take;i++)out.push(available[Math.floor(i*available.length/take)][n]);
 }
 return out;
}
async function mapillaryFor(b,signal,deep,token,accept=()=>true){
 const out={provider:'Mapillary',status:'完成',listed:0,attempted:0,observations:[],capped:false};
 const params=new URLSearchParams({bbox:b.join(','),fields:'id,geometry,captured_at,sequence,thumb_1024_url',limit:200});
 const rows=new Map();
 try{
   for(let page=0;page<(deep?6:2);page++){
     const req=linkedSignal(signal,15000);
     let json;
     try{
       const res=await fetch('https://graph.mapillary.com/images?'+params,{headers:{Authorization:'OAuth '+token},signal:req.signal});
       if(!res.ok)throw Error('HTTP '+res.status);
       json=await res.json();
     }finally{req.done()}
     if(!Array.isArray(json.data))throw Error('目录格式异常');
     for(const item of json.data){
       const pos=item.geometry?.coordinates;
       if(!pos||!inside(pos,b)||!accept(pos[0],pos[1])||!item.thumb_1024_url?.startsWith('https://'))continue;
       rows.set(item.id,{id:item.id,x:pos[0],y:pos[1],href:item.thumb_1024_url,full:'https://www.mapillary.com/app/?pKey='+encodeURIComponent(item.id),shotDate:item.captured_at?new Date(item.captured_at).toISOString():'',sequenceId:item.sequence});
     }
     if(!json.paging?.next)break;
     if(!json.paging.cursors?.after||page===(deep?5:1)){out.capped=true;break}
     params.set('after',json.paging.cursors.after);
   }
 }catch(err){if(signal.aborted)throw err;out.status='查询失败：'+err.message}
 out.catalog=[...rows.values()];out.listed=rows.size;
 const selected=spatialSample([...rows.values()],Math.min(rows.size,deep?180:48));
 out.capped||=selected.length<rows.size;out.attempted=selected.length;
 for(let i=0;i<selected.length;i+=4){
   if(signal.aborted)throw Error('已取消');
   const got=await Promise.all(selected.slice(i,i+4).map(async q=>{try{return {...q,...await greenFraction(q.href,signal)}}catch{return null}}));
   out.observations.push(...got.filter(Boolean));
 }
 return out;
}
async function imageryFor(b,signal,deep=false,ring=null){
 const token=document.getElementById('mapillaryKey').value.trim();
 const region=ring?metricRegion(ring):null;
 const accept=(x,y)=>!region||touchesRegion(xy(x,y),region);
 const jobs=[kartaViewFor(b,signal,deep,accept),panoramaxFor(b,signal,accept).then(x=>({...x,provider:'Panoramax'}))];
 if(token)jobs.push(mapillaryFor(b,signal,deep,token,accept));
 const sources=await Promise.all(jobs);
 return {provider:sources.map(s=>s.provider).join('、'),listed:sources.reduce((n,s)=>n+s.listed,0),
   attempted:sources.reduce((n,s)=>n+s.attempted,0),capped:sources.some(s=>s.capped),
   status:sources.map(s=>s.provider+' '+s.status+'（读图 '+s.observations.length+'）').join('；'),
   catalog:sources.flatMap(s=>(s.catalog||[]).map(q=>({...q,provider:s.provider}))),
   observations:sources.flatMap(s=>s.observations.map(q=>({...q,provider:s.provider})))};
}
