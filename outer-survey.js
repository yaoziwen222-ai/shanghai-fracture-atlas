function archiveTiles(index,bbox,visit){
 const decoder=new TextDecoder();
 for(let i=Math.floor(bbox[0]*100);i<=Math.floor(bbox[2]*100);i++){
   for(let j=Math.floor(bbox[1]*100);j<=Math.floor(bbox[3]*100);j++){
     const pack=index[i+','+j];if(!pack)continue;
     for(const row of JSON.parse(decoder.decode(fflate.gunzipSync(bytes64(pack)))))visit(row,i,j);
   }
 }
}
function archivedStreetSamples(bbox){
 const out=[];
 archiveTiles(OUTER_SAMPLES,bbox,([x,y,id,lines,...values],i,j)=>{
   const ll=[(i*10000+x)/1e6,(j*10000+y)/1e6];
   if(inside(ll,bbox))out.push([...xy(...ll),lines,id,values.map(v=>v===null?null:v/10000)]);
 });
 return out;
}
function surveyEdges(pts){
 let start=0;const edges=[];
 for(let i=1;i<pts.length;i++){
   const a=pts[i-1],b=pts[i],len=distance(a,b);if(!len)continue;
   edges.push({a,b,len,start,dx:(b[0]-a[0])/len,dy:(b[1]-a[1])/len});start+=len;
 }
 return edges;
}
function projectSurvey(p,e){
 const x=p[0]-e.a[0],y=p[1]-e.a[1],along=x*e.dx+y*e.dy;
 const pos=Math.max(0,Math.min(e.len,along));
 return {dist:Math.hypot(x-e.dx*pos,y-e.dy*pos),m:e.start+pos,along};
}
function archiveRoads(bbox){
 const map=new Map();
 archiveTiles(OUTER_ROADS,bbox,([id,name,shape,values])=>{
   if(map.has(id))return;
   const pts=shape.map(p=>xy(p[0]/1e6,p[1]/1e6)),edges=surveyEdges(pts);if(!edges.length)return;
   const len=edges.at(-1).start+edges.at(-1).len;
   map.set(id,{id,name,edges,len,values:values?.map(v=>v===null?null:v/10000)});
 });
 return map;
}
function station(line,m){
 const e=line.edges.find(e=>m<=e.start+e.len)||line.edges.at(-1);
 const t=Math.max(0,Math.min(m-e.start,e.len));
 return {p:[e.a[0]+e.dx*t,e.a[1]+e.dy*t],e};
}
function surveyIndex(items){
 const cells=new Map();
 for(const item of items)for(const e of surveyEdges(item.pts)){
   e.item=item;
   for(let i=Math.floor((Math.min(e.a[0],e.b[0])-18)/50);i<=Math.floor((Math.max(e.a[0],e.b[0])+18)/50);i++)
     for(let j=Math.floor((Math.min(e.a[1],e.b[1])-18)/50);j<=Math.floor((Math.max(e.a[1],e.b[1])+18)/50);j++){
       const key=i+','+j;if(!cells.has(key))cells.set(key,[]);cells.get(key).push(e);
     }
 }
 return p=>cells.get(Math.floor(p[0]/50)+','+Math.floor(p[1]/50))||[];
}
function matchArchivedSamples(segments,field,roads,belongs,bbox){
 const roadEdges=surveyIndex(roads),targetEdges=surveyIndex(segments),lines=archiveRoads(bbox);
 for(const s of segments){s.survey=[[],[]];s.history=[[],[]];s.sourceMeans=[[],[]];s.nearSurvey=0;s.nearSame=0;s.nearOther=0}
 // A nearby non-diagnostic road can win the match or rule out an ambiguous assignment.
 function options(p,dir){
   const candidates=new Map();
   for(const e of roadEdges(p)){
     const q=projectSurvey(p,e),r=e.item;
     if(q.dist>18)continue;
     const angle=dir?Math.acos(Math.min(1,Math.abs(dir.dx*e.dx+dir.dy*e.dy)))*180/Math.PI:0;
     if(angle>30)continue;
     const cost=q.dist+angle/10,prev=candidates.get(r);
     if(!prev||cost<prev.cost)candidates.set(r,{r,cost,dist:q.dist});
   }
   return [...candidates.values()].sort((x,y)=>x.cost-y.cost);
 }
 function compatible(a,dir,name){
   const names=[a.r.t.name,a.r.t['name:zh']].filter(Boolean);
   return !(name&&names.length&&!names.includes(name))&&a.dist<=(dir?(name&&names.length?18:10):8);
 }
 function owner(p,dir,name){
   const [a,b]=options(p,dir);
   if(!a||(b&&b.cost-a.cost<3))return null;
   return compatible(a,dir,name)?a.r:null;
 }
 function continues(a,b){
   if(a===b)return true;
   if(!a.t.name||a.t.name!==b.t.name||a.t.highway!==b.t.highway||
      (a.t.layer||'0')!==(b.t.layer||'0')||a.t.bridge!==b.t.bridge||a.t.tunnel!==b.t.tunnel)return false;
   // Consecutive ends only. Two parallel carriageways do not qualify by name.
   const end=(r,i)=>r.ids.at(i);
   for(const i of [0,-1])for(const j of [0,-1]){
     if(end(a,i)!==end(b,j))continue;
     if((a.t.oneway==='yes'||b.t.oneway==='yes')&&(a.t.oneway!==b.t.oneway||i===j))continue;
     const node=a.pts.at(i),u=a.pts.at(i===0?1:-2),v=b.pts.at(j===0?1:-2);
     const denom=distance(node,u)*distance(node,v);
     if(denom&&((u[0]-node[0])*(v[0]-node[0])+(u[1]-node[1])*(v[1]-node[1]))/denom<-.7)return true;
   }
   return false;
 }
 function target(p,road){
   if(!road)return null;
   const options=new Map();
   for(const e of targetEdges(p)){
     if(e.item.road!==road)continue;
     const q=projectSurvey(p,e);
     if(q.along<-.15||q.along>e.len+.15)continue;
     const prev=options.get(e.item);
     if(!prev||q.dist<prev.dist)options.set(e.item,{s:e.item,m:q.m,dist:q.dist});
   }
   const [a,b]=[...options.values()].sort((x,y)=>x.dist-y.dist);
   return a&&a.dist<=18&&(!b||b.dist-a.dist>=3)?a:null;
 }
 function pointOnLine(p,line){
   if(!line)return null;
   const refs=line.edges.map(e=>({e,...projectSurvey(p,e)})).sort((a,b)=>a.dist-b.dist);
   const ref=refs[0];if(ref.dist>.3)return null;
   const probes=[...new Set([-25,-10,10,25].map(k=>Math.max(0,Math.min(line.len,ref.m+k))))].filter(m=>Math.abs(m-ref.m)>=5);
   if(!probes.length)return null;
   const nearby=options(p,ref.e),accepted=[];
   for(const candidate of nearby){
     if(candidate.cost>nearby[0].cost+1||!compatible(candidate,ref.e,line.name))continue;
     const hit=target(p,candidate.r);if(!hit)continue;
     let strong=0,consistent=true;
     for(const m of probes){
       const a=station(line,m),opts=options(a.p,a.e);
       const same=opts.find(o=>compatible(o,a.e,line.name)&&continues(candidate.r,o.r));
       if(!same||same.cost>opts[0].cost+1){consistent=false;break}
       const rival=opts.find(o=>!continues(candidate.r,o.r));
       if(!rival||rival.cost-same.cost>=3)strong++;
     }
     const other=nearby.find(o=>o.r!==candidate.r);
     const pointClear=!other||other.cost-candidate.cost>=3;
     if(consistent&&strong>=(pointClear?1:2))accepted.push(hit);
   }
   return accepted.length===1?accepted[0]:null;
 }
 for(const p of field.survey){
   if(!belongs(p))continue;
   const nearby=new Set();
   for(const e of targetEdges(p))if(projectSurvey(p,e).dist<=18)nearby.add(e.item);
   const names=p[2].map(id=>lines.get(id)?.name||'');
   for(const s of nearby){
     s.nearSurvey++;
     if(names.some(n=>n&&(n===s.road.t.name||n===s.road.t['name:zh'])))s.nearSame++;
     else if(s.road.t.name&&names.length&&names.every(Boolean))s.nearOther++;
   }
   const hits=p[2].map(id=>pointOnLine(p,lines.get(id))),a=hits[0];
   if(!a||!hits.every(h=>h&&h.s===a.s&&Math.abs(h.m-a.m)<1))continue;
   a.s.survey[Number(a.m>=a.s.len/2)].push(p);
 }
 // Entire original sections only. Two halves can never reuse the same section average.
 for(const line of lines.values()){
   if(!line.values||line.len<10)continue;
   const measures=new Set([0,line.len,...line.edges.map(e=>e.start)]);
   for(let m=5;m<line.len;m+=8)measures.add(m);
   const stations=[...measures].sort((a,b)=>a-b).map(m=>station(line,m));
   if(!stations.every(a=>belongs(a.p)))continue;
   const hits=stations.map(a=>target(a.p,owner(a.p,a.e,line.name)));
   const first=hits.find(Boolean);if(!first)continue;
   const half=Number(first.m>=first.s.len/2);
   if(hits.some(h=>h&&(h.s!==first.s||Number(h.m>=h.s.len/2)!==half)))continue;
   const chain=hits.slice(hits.indexOf(first),hits.findLastIndex(Boolean)+1);
   if(chain.some(h=>!h))continue;
   const span=Math.max(...chain.map(h=>h.m))-Math.min(...chain.map(h=>h.m));
   if(span<.8*line.len)continue;
   // Ambiguous endpoint probes still have to project onto the same half.
   if(!stations.every(a=>{const h=target(a.p,first.s.road);return h&&h.s===first.s&&Number(h.m>=h.s.len/2)===half}))continue;
   first.s.sourceMeans[half].push(line);
 }
 for(const p of field.views){
   if(!belongs(p))continue;
   const a=target(p,owner(p,null,''));if(a)a.s.history[Number(a.m>=a.s.len/2)].push(p);
 }
}
function archiveMissingReason(s){
 if(s.survey.every(h=>h.length)||s.sourceMeans.every(h=>h.length))return '已形成同街段前后对照';
 if(s.survey.some(h=>h.length))return '只匹配到半段采样点';
 if(s.nearSame)return '附近有同名原路段，无法唯一定位到本段';
 if(s.nearSurvey&&s.nearOther===s.nearSurvey)return '附近采样点均来自其他路名';
 if(s.nearSurvey)return '附近有点，路名、走向或唯一归属证据不足';
 return '18 m 内没有本选区存档点';
}

function surveyDifference(s,index,scale){
 function value(values){
   return index===8?(values[3]!==null&&values[4]!==null&&values[3]+values[4]>=.025?values[3]/(values[3]+values[4]):null):values[index];
 }
 const halves=s.survey.map(points=>{
   const positions=new Map();
   for(const p of points){
     const v=value(p[4]);
     if(!Number.isFinite(v))continue;
     const key=Math.round(p[0])+','+Math.round(p[1]);
     if(!positions.has(key))positions.set(key,[]);positions.get(key).push(v);
   }
   return [...positions.values()].map(med);
 });
 const pointPair=halves.every(g=>g.length);
 const groups=pointPair?halves:s.sourceMeans.map(lines=>lines.map(l=>value(l.values)).filter(Number.isFinite));
 if(groups.some(g=>!g.length))return null;
 const vals=groups.map(med),format=index===7?v=>v.toFixed(2):percent;
 return {v:Math.abs(vals[0]-vals[1])/scale,raw:'外环街景存档 · 前后 '+groups.map(g=>g.length).join(' / ')+(pointPair?' 个位置':' 条独立原始路段均值')+' · '+vals.map(format).join(' / ')};
}

const outerBounds=ringBounds(OUTER_RING);
function studyContains(b,region){
 if(!inside(b.slice(0,2),outerBounds)||!inside(b.slice(2),outerBounds))return false;
 const rect=[[b[0],b[1]],[b[2],b[1]],[b[2],b[3]],[b[0],b[3]]];
 const shape=region?.kind==='blocks'?region.polygons:[region||rect];
 return polygonClipping.difference(shape,[OUTER_RING]).length===0;
}
// Use tile coordinates throughout so the outside colour follows Leaflet during a pan or zoom.
let ringPixels;
function studyTile(tile,coord){
 if(!ringPixels)ringPixels=leafletRing(OUTER_RING).map(ll=>{
   const p=L.CRS.EPSG3857.latLngToPoint(L.latLng(ll),18);return [p.x,p.y];
 });
 const f=2**(18-coord.z),size=256*f,x=coord.x*size,y=coord.y*size;
 const border=ringPixels.some((a,i)=>{
   const b=ringPixels[(i+1)%ringPixels.length];
   return Math.min(a[0],b[0])<=x+size&&Math.max(a[0],b[0])>=x&&
          Math.min(a[1],b[1])<=y+size&&Math.max(a[1],b[1])>=y;
 });
 if(!border){
   if(!containsRing([x+size/2,y+size/2],ringPixels))tile.style.filter='grayscale(1)';
   return tile;
 }
 const gray=document.createElement('canvas');gray.width=tile.width;gray.height=tile.height;
 const g=gray.getContext('2d');g.filter='grayscale(1)';g.drawImage(tile,0,0);
 const ctx=tile.getContext('2d'),scale=tile.width/size;
 ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.beginPath();ctx.rect(0,0,tile.width,tile.height);
 ringPixels.forEach(([px,py],i)=>{
   if(i===0)ctx.moveTo((px-x)*scale,(py-y)*scale);
   else ctx.lineTo((px-x)*scale,(py-y)*scale);
 });
 ctx.closePath();ctx.clip('evenodd');ctx.clearRect(0,0,tile.width,tile.height);ctx.drawImage(gray,0,0);ctx.restore();
 return tile;
}
function showStudyBoundary(){
 const ring=leafletRing(OUTER_RING);
 L.polyline([...ring,ring[0]],{interactive:false,color:'#b2a09a',weight:1.5,opacity:.8}).addTo(atlas);
}
