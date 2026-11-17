const $=id=>document.getElementById(id),map=$('map'),color=['#ff975d','#67b9ff','#ca9bff'];
const safe=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let source=SNAPSHOT,bbox=DEFAULT.slice(),activeRing=null,model,threshold=.5,ranked=[],selected=null,request=0,abort=null;
const typeNames={residential:'居住道路',secondary:'次干路',primary:'主干路',tertiary:'集散道路',pedestrian:'步行街',unclassified:'一般道路',living_street:'生活街道'};
const chosenDims=new Set([0,1,2]);
let useVisualGroups=true;
function viaVisualGroups(e){
 return useVisualGroups&&e.v!==null&&e.v<threshold&&e.v>=.6*threshold&&
   e.visualGroups?.length>=2&&e.visualGroups[1].value>=threshold;
}
const meetsCut=e=>e.v!==null&&(e.v>=threshold||viaVisualGroups(e));
const active=s=>s.evidence.map((e,i)=>chosenDims.has(i)&&meetsCut(e));
const selectedHits=s=>active(s).filter(Boolean).length;
const allHits=s=>s.evidence.filter(meetsCut).length;
const maxActive=s=>Math.max(...Array.from(chosenDims,i=>s.evidence[i].v??-1));
function syncDims(){
 const all=chosenDims.size===dims.length;
 const names=dims.filter((_,i)=>chosenDims.has(i));
 $('resultLayer').textContent=all?'':names.join(' · ')||'未选维度';
 $('multi').disabled=chosenDims.size<2;
 if($('multi').disabled)$('multi').checked=false;
}
function fit(){
 setScopeFocus(true);
 atlas.fitBounds(mapBounds(analysisContextBounds(bbox)),{padding:[22,22],animate:false});
}
function run(reset=true,prepared=null){
 model=prepared||makeModel(source,bbox,activeRing);selected=null;
 rememberIndicators(model.segments);
 $('area').textContent=model.areaKm2.toFixed(model.areaKm2<.1?4:3);$('roads').textContent=model.segments.length;
 $('scopeName').textContent=(source.source||'当前选区').split(' · ')[0];
 $('source').textContent=source.source+' · '+source.date+(model.polygon?.kind==='blocks'?' · '+model.polygon.ids.length+' 个街坊':model.polygon?' · 多边形选区':'');
 const localPoi=model.field.poi.filter(model.belongs);
 const dp=localPoi.filter(p=>['dp','both'].includes(p[6])).length,osm=localPoi.filter(p=>['osm','both'].includes(p[6])).length;
 const extra=label=>model.field.facilitySamples.filter(p=>p[2]===label&&model.belongs(p)).length;
 $('buildingCount').textContent='OSM 建筑 '+model.counts.build+' 栋';
 $('facilityCount').textContent='去重设施 '+localPoi.length+' 处';
 const sources=[['大众点评',dp],['OSM',osm],['QGIS',extra('QGIS')],['高德在线',extra('高德在线')],['高德 CSV',extra('高德CSV')]];
 const contributing=sources.filter(([,n])=>n>0);
 $('poiSources').textContent=contributing.length?'分来源（可重叠） · '+contributing.map(([name,n])=>name+' '+n).join(' / '):'选区内无设施记录';
 $('poiStatus').textContent=source.facilities?.status||'本地存档';
 $('surveyCount').textContent='外环街景采样 '+model.counts.survey+' 点';
 $('visualSources').textContent='历史绿视率 '+model.counts.views+' 条 · 开放街景实拍 '+model.counts.photos+' 张（含存档）';
 const im=source.imagery;
 $('imagestatus').textContent=im?(source.savedPhotos?'本轮选区查询':'存档查询（含缓冲区）')+' · 目录 '+im.listed+' 条，尝试 '+im.attempted+' 张，读图 '+im.observations.length+' 张，完成语义分割 '+im.observations.filter(q=>Number.isFinite(q.sky)).length+' 张'+(im.capped?'（限额抽样）':''):'尚无开放街景查询记录';
 $('imageProviders').textContent=im?[im.provider,im.status].filter(Boolean).join(' · '):'';
 const total=model.segments.length;
 $('available').innerHTML=total?dims.map((name,i)=>{
   const items=model.segments[0].evidence[i].items;
   const rows=items.map((item,j)=>{
     const count=model.segments.filter(seg=>seg.evidence[i].items[j].v!==null).length;
     return '<div><dt>'+safe(item.label)+'</dt><dd>'+count+' / '+total+' 段</dd></div>';
   }).join('');
   return '<h3>'+name+'</h3><dl>'+rows+'</dl>';
 }).join(''):'选区内没有可分析的街段。';
 update(true);
 if(reset)fit();
}
function update(prefer=false){
 threshold=+$('cut').value/100;
 useVisualGroups=$('visualGroupFilter').checked;
 syncDims();
 $('cutval').textContent=threshold.toFixed(2); $('cut').setAttribute('aria-valuetext',threshold.toFixed(2));
 const minimumHits = $('multi').checked ? 2 : 1;
 ranked=model.segments.filter(s=>selectedHits(s)>=minimumHits)
 .sort((a,b)=>(selectedHits(b)-selectedHits(a))||maxActive(b)-maxActive(a)||a.id.localeCompare(b.id));
 $('hits').textContent=ranked.length;

 $('mixcounts').textContent='全选区共现 · '+[1,2,3].map((n,i)=>['单维','双维','三维'][i]+' '+model.segments.filter(s=>allHits(s)===n).length).join(' / ');
 const next=ranked.find(s=>s.id===selected?.id)||(prefer&&ranked.find(s=>allHits(s)===3))||ranked[0]||null;
 select(next);
}
function select(seg){
 selected=seg;
 $('list').innerHTML=ranked.length?ranked.map(s=>'<button class="item '+(s===seg?'on':'')+'" data-id="'+safe(s.id)+'"><strong>'+safe(s.name)+'</strong><span class="badge">'+active(s).map((on,i)=>on?'<i class="d'+i+'" title="'+dims[i]+'"></i>':'').join('')+'</span><small>'+Math.round(s.len)+' m</small></button>').join(''):'<p class="empty">'+(chosenDims.size?'当前筛选条件下没有候选街段。':'请勾选要查看的维度。')+'</p>';
 $('segname').textContent=seg?.name||'街段详情';$('length').textContent=seg?Math.round(seg.len)+' m':'';
 $('segid').textContent=seg?typeNames[seg.road.t.highway]+' · '+seg.id:'点击候选街段查看分项';
 $('metrics').innerHTML=seg?seg.evidence.map((e,i)=>'<div class="metric"><strong>'+dims[i]+'</strong><b style="color:'+color[i]+'">'+(e.v===null?'缺测':e.v.toFixed(2)+(e.v>=threshold?' · 触发':viaVisualGroups(e)?' · 分组补筛':' · 未触发'))+'</b><p>'+safe(e.why)+'<br>'+(i===2?'前 / 后位置':'左 / 右样本')+'　'+e.n.join(' / ')+'</p><div class="bar"><i class="d'+i+'" style="width:'+100*(e.v??0)+'%"></i></div></div>').join(''):'';
 if(seg){
   [...$('metrics').children].forEach((el,i)=>{
     const evidence=seg.evidence[i],description=el.querySelector('p');
     description.textContent=evidence.why;
     if(viaVisualGroups(evidence)){
       const triggers=evidence.visualGroups.filter(g=>g.value>=threshold).map(g=>g.name+' '+g.value.toFixed(2));
       description.textContent='分组补筛依据：'+triggers.join('、')+'。感知原始均分 '+evidence.v.toFixed(2)+'。'+evidence.why;
     }
     const groups=seg.evidence[i].items;const det=document.createElement('details'),sum=document.createElement('summary');
     sum.textContent='查看分项与缺测（'+groups.filter(x=>x.v!==null).length+'/'+groups.length+'）';det.append(sum);
     for(const item of groups){const p=document.createElement('p');p.textContent=item.label+' · '+(item.v==null?'缺测':item.v.toFixed(2))+'　'+item.raw;det.append(p)}
     if(i===2){const p=document.createElement('p');p.textContent='外环存档核对 · '+archiveMissingReason(seg)+'。前后采样 '+seg.survey.map(h=>h.length).join(' / ')+' 点，完整原路段 '+seg.sourceMeans.map(h=>h.length).join(' / ')+' 条。';det.prepend(p);det.prepend(sum)}
     el.append(det);
   });
   const routeNote=document.createElement('p');routeNote.textContent=seg.pathNote;$('metrics').children[0].querySelector('details').append(routeNote);
 }
 render();
}
$('layers').onchange = event => {
 const input = event.target;
 const dimension = Number(input.dataset.layer);
 if (input.checked) chosenDims.add(dimension);
 else chosenDims.delete(dimension);
 update();
};
$('list').onclick=e=>{const id=e.target.closest('[data-id]')?.dataset.id;if(id){const s=model.segments.find(s=>s.id===id);select(s);atlas.fitBounds(s.pts.map(mapPoint),{padding:[80,70],maxZoom:17,animate:false})}};
$('visualGroupFilter').onchange=()=>update();$('cut').oninput=()=>update();$('multi').onchange=()=>update();
function invalidate(){++request;if(abort)abort.abort();$('deep').disabled=$('fetch').disabled=false}
const cache=new Map(),cacheKey=b=>b.map(x=>x.toFixed(6)).join(',');
cache.set(cacheKey(DEFAULT),SNAPSHOT);cache.set(cacheKey(ringBounds(BLOCK_EXAMPLE)),BLOCK_SNAPSHOT);
cache.set(cacheKey(LONGHUA_FACES.bbox),BLOCK_PAIR_SNAPSHOT);
let retryBox=null;
async function acquire(b,force=false,deep=false,ring=null){
 if(selectionProblem(b,ring))return false;
 retryBox=null;invalidate();const key=cacheKey(b),token=request;
 const query=analysisContextBounds(b).map(v=>+v.toFixed(6));
 const reusable=cache.get(key)||[...cache.values(),BLOCK_PAIR_SNAPSHOT,SNAPSHOT].find(data=>data.bounds&&inside(query.slice(0,2),data.bounds)&&inside(query.slice(2),data.bounds));
 const controller=new AbortController();abort=controller;

 $('deep').disabled=$('fetch').disabled=true;$('message').textContent='正在采集建筑、设施和街景并做语义分割。完成后切换结果…';
 const progress=beginProgress(b,ring,controller.signal);
 try{
   const loadOSM=async()=>{const timer=linkedSignal(controller.signal,45000);try{
    const res=await fetch('https://api.openstreetmap.org/api/0.6/map?bbox='+query.join(','),{signal:timer.signal});
    if(!res.ok)throw Error('OSM HTTP '+res.status);return parseMap(await res.text());
   }finally{timer.done()}};
   const cached=reusable&&(!force||deep);
   const [mapData,imagery,facilities]=await Promise.all([
     Promise.resolve(cached?reusable:loadOSM()).then(data=>{progress.source(0,cached?'已读存档':'已获取');return data}),
     imageryFor(b,controller.signal,deep,ring).then(data=>{progress.source(2,'读图 '+data.observations.length+' 张');return data}),
     queryFacilities(query,controller.signal).then(data=>{progress.source(1,data.rows.length?'返回 '+data.rows.length+' 处':data.status);return data}),
     ensureLocalData(b,controller.signal)
   ]);
   if(token!==request)return;
   const archived=new Map();
   for(const q of [...(reusable?.savedPhotos||[]),...(reusable?.imagery?.observations||[])]){
     if(!inside([q.x,q.y],query))continue;
     const provider=q.provider||reusable.imagery.provider;
     const id=provider+'/'+q.id;
     if(Number.isFinite(q.sky)||!archived.has(id))archived.set(id,{...q,provider});
   }
   const photoCatalog=new Map();
   for(const q of [...(reusable?.photoCatalog||[]),...(imagery.catalog||[])]){
     if(inside([q.x,q.y],query))photoCatalog.set(q.provider+"/"+q.id,q);
   }
   const data={...mapData,photoCatalog:[...photoCatalog.values()],source:'自选区域 · '+(mapData===reusable?'已存路网':'在线路网')+'与街景采集',bounds:mapData.bounds||query,imagery,facilities,savedPhotos:[...archived.values()]};
   const nextModel=await buildWithProgress(data,b,ring,progress,controller.signal);
   if(token!==request)return;
   activeRing=ring;source=data;bbox=b;run(true,nextModel);
   cache.set(key,data);if(cache.size>5)cache.delete([...cache.keys()].find(k=>k!==cacheKey(DEFAULT)&&k!==cacheKey(LONGHUA_FACES.bbox)&&k!==cacheKey(ringBounds(BLOCK_EXAMPLE))));
   const insidePhotos=imagery.observations.filter(q=>model.belongs(xy(q.x,q.y)));
   $('message').textContent='本轮读到选区内实拍 '+insidePhotos.length+' 张，语义分割成功 '+insidePhotos.filter(q=>Number.isFinite(q.sky)).length+' 张。';
   progress.end(true,model.segments.length?'已分析 '+model.segments.length+' 段 · 当前筛选下有 '+ranked.length+' 段候选':'选区内没有符合条件的分析街段');return true;
 }catch(err){if(token===request){retryBox=b;$('message').textContent='目标选区采集失败（'+err.message+'）。'+(draft?'可重试所选区域，或取消选区返回上次结果。':'地图保留上次结果。');progress.end(false,'采集或计算失败 · '+err.message)}}
 finally{if(token===request){controller.abort();$('deep').disabled=$('fetch').disabled=false}}
}
$('fetch').onclick=()=>acquire(bbox,true,false,activeRing);$('deep').onclick=()=>acquire(bbox,true,true,activeRing);
async function initializeAtlas(){
 initMainMap();cityOverview();initAtlasShell();
 setBootStatus('正在载入默认片区的建筑、设施与感知数据');
 await ensureLocalData(DEFAULT);
 run(false);
 document.getElementById('bootLoading').remove();
 loadMapDetails();
}
$('amapHelp').textContent=collectionService?'设置 AMAP_KEY 并重启在线采集服务后，重新采集即可查询高德。':'当前使用内置设施存档。实时增查高德需在项目目录启动「在线采集.cmd」并配置 AMAP_KEY。';
initCollectionFiles();
async function initializeFacilities(){
if(collectionService){
 const initial=source,box=bbox.slice(),key=request;
 const pad=analysisContextBounds(box);
 queryFacilities(pad,new AbortController().signal).then(facilities=>{
   if(source!==initial||request!==key)return;
   source={...initial,facilities};
   if(facilities.rows.length)run(false);
   else $('poiStatus').textContent=facilities.status;
 });
}
}
initializeAtlas().then(initializeFacilities).catch(showBootError);


