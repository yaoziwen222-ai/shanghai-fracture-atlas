'use strict';
const DEFAULT=[121.43357656806573, 31.20562392442573, 121.44842343193427, 31.21837607557427];
const MX=111320*Math.cos(31.166*Math.PI/180), MY=110900;
const xy=(x,y)=>[(x-121.4525)*MX,(y-31.1661)*MY];
const lonlat=(x,y)=>[x/MX+121.4525,y/MY+31.1661];
const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
const inside=(p,b)=>p[0]>=b[0]&&p[0]<=b[2]&&p[1]>=b[1]&&p[1]<=b[3];
const area=b=>(b[2]-b[0])*MX*(b[3]-b[1])*MY/1e6;
const boundsXY=b=>[...xy(b[0],b[1]),...xy(b[2],b[3])];
const contextRadius=240;
function analysisContextBounds(b){
 return b.map((v,i)=>v+(i<2?-contextRadius:contextRadius)/(i%2?MY:MX));
}
const roadTypes=new Set(['primary','secondary','tertiary','residential','unclassified','living_street','pedestrian']);
const walkTypes=new Set([...roadTypes,'service','footway','path','steps','track']);
const med=arr=>{const a=arr.slice().sort((x,y)=>x-y);return (a[(a.length-1)>>1]+a[a.length>>1])/2};
const percent=n=>(n*100).toFixed(0)+'%';
const dims=['形态','功能','感知'];
function makeModel(data,bbox,polygon=null){
 const steps=modelSteps(data,bbox,polygon);
 let step=steps.next();
 while(!step.done)step=steps.next();
 return step.value;
}
function* modelSteps(data,bbox,polygon){
 const ring=polygon?metricRegion(polygon):null;
 yield {stage:'读取选区建筑、设施和采样点'};
 const field=cityField(data,bbox);
 field.survey=archivedStreetSamples(bbox);
 const footprint=analysisFootprint(bbox,polygon,contextRadius);
 const contextRegion={loops:footprint.outline.flat().map(asXY)};
 const inContext=p=>touchesRegion(p,contextRegion);
 for(const key of ['build','poi','facilitySamples','photos','views'])field[key]=field[key].filter(inContext);
 const coords=Object.fromEntries(Object.entries(data.nodes).map(([i,p])=>[i,xy(...p)]));
 const box=boundsXY(bbox),pad=boundsXY(analysisContextBounds(bbox)),roads=[],land=[],refs=new Map(),graph=new Map();
 const nodeContext=new Map();
 function contextNode(id){
   if(!nodeContext.has(id))nodeContext.set(id,inside(coords[id],pad)&&inContext(coords[id]));
   return nodeContext.get(id);
 }
 const selectedRegion=ring||{loops:[[[box[0],box[1]],[box[2],box[1]],[box[2],box[3]],[box[0],box[3]]]]};
 for(const [id,ids,t] of data.ways){
   const pts=ids.map(i=>coords[i]); if(!pts.every(Boolean))continue;
   if(!pts.some(p=>inside(p,pad))&&!pts.some((p,i)=>i&&Math.min(p[0],pts[i-1][0])<=pad[2]&&Math.max(p[0],pts[i-1][0])>=pad[0]&&Math.min(p[1],pts[i-1][1])<=pad[3]&&Math.max(p[1],pts[i-1][1])>=pad[1]))continue;
   const way={id,ids,t,pts};
   if(!t.highway){if(t.building||t.leisure==='park'||t.natural==='water'||['grass','forest','recreation_ground'].includes(t.landuse))land.push(way);continue}
   roads.push(way);
   for(const i of new Set(ids))refs.set(i,(refs.get(i)||0)+1);
   if(!walkTypes.has(t.highway)||['private','no'].includes(t.foot)||(['private','no'].includes(t.access)&&!['yes','designated','permissive'].includes(t.foot))||t.tunnel==='yes')continue;
   for(let j=1;j<ids.length;j++){
     const a=ids[j-1],b=ids[j];if(a===b||!contextNode(a)||!contextNode(b))continue;
     const len=distance(coords[a],coords[b]);if(!len)continue;
     if(!graph.has(a))graph.set(a,[]);if(!graph.has(b))graph.set(b,[]);
     graph.get(a).push([b,len]);graph.get(b).push([a,len]);
   }
 }
 const belongs=p=>inside(p,box)&&(!ring||touchesRegion(p,ring));
 yield {stage:'沿路口切分分析街段'};
 const segments=[];
 for(const w of roads.filter(w=>roadTypes.has(w.t.highway)&&w.t.tunnel!=='yes')){
   let part=[w.pts[0]],len=0,idx=0;
   for(let j=1;j<w.pts.length;j++){
     const a=w.pts[j-1],b=w.pts[j],d=distance(a,b);
     const n=Math.max(1,Math.ceil(d/130));
     for(let k=1;k<=n;k++){
       const p=[a[0]+(b[0]-a[0])*k/n,a[1]+(b[1]-a[1])*k/n];part.push(p);len+=d/n;
       if(len>=145||(k===n&&(refs.get(w.ids[j])>1||j===w.pts.length-1))){
          const first=part[0],last=p;
          if(len>=35&&distance(first,last)>=25){
            const sections=polygonSections(part,selectedRegion);
            sections.forEach((section,k)=>segments.push({id:w.id+'-'+idx+(sections.length>1?'~'+(k+1):''),road:w,name:w.t.name||'未命名街段',...section,order:idx}));
          }
          idx++;part=[p];len=0;
       }
     }
   }
 }
 yield {stage:'构建街坊与道路两侧的比较窗口',total:segments.length};
 const context=setupFramework(roads,coords,graph,land,bbox);
 context.heightCells=context.heightCells.filter(inContext);
 context.commercialWindow=p=>inside(p,context.commercialSafe)&&contextRegion.loops.every(r=>distanceToStreet(p,r)>=125);
 context.referenceSamples=new Set();
 context.nearestShop=commercialDistances(field.poi);
 context.qgisBuildings=localBuildings(bbox);
 const roadIndex=new Map(roads.map(road=>[String(road.id),road]));
 context.photosByRoad=new Map();
 for(const point of field.photos){
   const id=photoRoadId(point,point[3],roads,roadIndex);
   if(!id)continue;
   if(!context.photosByRoad.has(id))context.photosByRoad.set(id,[]);
   context.photosByRoad.get(id).push(point);
 }
 yield {stage:'核对采样点与街段的归属',total:segments.length};
 matchArchivedSamples(segments,field,roads,belongs,bbox);
 assignLocalScenes(segments,roads,belongs);
 const calculations=segments.map(seg=>{
   const place=SOCIAL[String(seg.road.id)];
   seg.archivedPlaceMentions=place&&place[0]===seg.name?place[1]:null;
   seg.evidence=[];
   return evidenceDimensions(seg,field,context);
 });
 for(let dim=0;dim<dims.length;dim++){
   yield {dim,total:segments.length,processed:0};
   for(let i=0;i<segments.length;i++){
     const evidence=calculations[i].next().value;
     segments[i].evidence.push(evidence);
     yield {dim,total:segments.length,processed:i+1,evidence};
   }
 }
 const counts=Object.fromEntries(Object.entries(field).map(([k,v])=>[k,v.filter(belongs).length]));
 return {coords,roads,land,segments,graph,box,bbox,counts,field,belongs,polygon,footprint,referenceSamples:context.referenceSamples,areaKm2:ring?ring.areaM/1e6:area(bbox),source:data.source,date:data.date};
}
function baseIndicators(seg,field){
 const a=seg.pts[0],b=seg.pts.at(-1),chord=distance(a,b),dx=(b[0]-a[0])/chord,dy=(b[1]-a[1])/chord;
 function groups(rows){
   const out=[[],[]];
   for(const p of rows){
     const x=p[0]-seg.mid[0],y=p[1]-seg.mid[1],along=x*dx+y*dy,side=dx*y-dy*x;
     if(Math.abs(side)>110||Math.abs(along)>chord/2+35||Math.abs(side)<4)continue;
     out[side>=0?1:0].push(p);
   }return out;
 }
 const pair=(sets,calc,min)=>{const n=sets.map(s=>s.length);return Math.min(...n)<min?{v:null,n,why:'样本不足'}:{...calc(...sets),n}};
 const m=pair(groups(field.build),(l,r)=>{
   const left=med(l.map(p=>p[2])),right=med(r.map(p=>p[2])),ratio=Math.max(left,right)/Math.min(left,right);
   return {v:Math.min(1,Math.log2(ratio)/2),why:'两侧建筑基底中位面积 '+Math.round(left)+' / '+Math.round(right)+' m² · 相差 '+ratio.toFixed(2)+' 倍'};
 },2);
 const f=pair(groups(field.poi),(l,r)=>{
   const shares=a=>{const h={};for(const p of a)h[p[2]]=(h[p[2]]||0)+1/a.length;return h},s=shares(l),t=shares(r);
   const diff=Object.fromEntries([...new Set([...Object.keys(s),...Object.keys(t)])].map(k=>[k,Math.abs((s[k]||0)-(t[k]||0))]));
   return {v:Math.min(1,Object.values(diff).reduce((a,b)=>a+b,0)/2),why:'两侧设施类别构成差异最大项：'+Object.keys(diff).sort((a,b)=>diff[b]-diff[a])[0]};
 },3);
 // Collapse repeated views at identical sample coordinates before comparing the two halves.
 function visual(halves,label){
   const perHalf=halves.map(rs=>{
     const spots=new Map();for(const q of rs){const id=q[0].toFixed(0)+','+q[1].toFixed(0);if(!spots.has(id))spots.set(id,[]);spots.get(id).push(q[2])}
     return [...spots.values()].map(med);
   });
   return pair(perHalf,(a,b)=>{const diff=Math.abs(med(a)-med(b));return {v:Math.min(1,diff/.35),why:label+' · 前后 '+percent(med(a))+' / '+percent(med(b))+' · 差 '+(diff*100).toFixed(1)+' 个百分点'+(Math.min(a.length,b.length)===1?'（含单点比较）':'')}},1);
 }
 const archived=visual(seg.history,'道路唯一匹配的历史绿视率');
 if(archived.v===null)archived.why='历史绿视率前/后 '+archived.n.join('/')+' 点，无法配对';
 return [m,f,archived];
}
