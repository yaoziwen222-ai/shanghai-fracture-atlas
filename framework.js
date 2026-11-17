const clamp01=v=>Math.max(0,Math.min(1,v));
const mean=a=>a.reduce((s,v)=>s+v,0)/a.length;
const ratioScore=(a,b)=>clamp01(Math.abs(Math.log2(a/b))/2);
const add=(a,b)=>a+b;
function ringsOfRoads(roads,coords){
 const adj=new Map(),used=new Set(),faces=[];
 function connect(a,b){if(!adj.has(a))adj.set(a,new Set());adj.get(a).add(b)}
 for(const w of roads){
   if(!roadTypes.has(w.t.highway)||w.t.tunnel==='yes'||w.t.bridge==='yes'||(+w.t.layer||0)!==0)continue;
   for(let i=1;i<w.ids.length;i++){const a=w.ids[i-1],b=w.ids[i];if(a!==b){connect(a,b);connect(b,a)}}
 }
 const leaves=[...adj].filter(([,nb])=>nb.size===1).map(([id])=>id);
 while(leaves.length){
   const id=leaves.pop(),nb=adj.get(id);if(!nb||nb.size>1)continue;
   for(const other of nb){const rest=adj.get(other);rest.delete(id);if(rest.size===1)leaves.push(other)}
   adj.delete(id);
 }
 const around=new Map();
 for(const [a,neighbors] of adj){const o=coords[a];const angle=b=>Math.atan2(coords[b][1]-o[1],coords[b][0]-o[0]);around.set(a,[...neighbors].sort((a,b)=>angle(a)-angle(b)))}
 for(const [a,nb] of around)for(const b of nb){
   if(used.has(a+':'+b))continue;
   const points=[];let u=a,v=b;
   while(!used.has(u+':'+v)){
     used.add(u+':'+v);points.push(coords[u]);const ns=around.get(v),w=ns[(ns.indexOf(u)+ns.length-1)%ns.length];u=v;v=w;
   }
   if(u!==a||v!==b||points.length<3||new Set(points).size!==points.length)continue;
   let twice=0,perimeter=0;const origin=points[0];
   for(let i=0;i<points.length;i++){const p=points[i],q=points[(i+1)%points.length];twice+=(p[0]-origin[0])*(q[1]-origin[1])-(q[0]-origin[0])*(p[1]-origin[1]);perimeter+=distance(p,q)}
   if(twice>1000)faces.push({points,area:twice/2,complexity:perimeter*perimeter/(2*Math.PI*twice)});
 }
 return faces;
}
function containsRing(p,ring){
 let hit=false;
 for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])hit=!hit}
 return hit;
}
function clipRect(points,loX,hiX,loY,hiY){
 let poly=points;
 for(const [k,wall,sign] of [[0,loX,1],[0,hiX,-1],[1,loY,1],[1,hiY,-1]]){
   const next=[];
   for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length],av=(a[k]-wall)*sign,bv=(b[k]-wall)*sign;
     if(av>=0)next.push(a);if((av>=0)!==(bv>=0)){const f=av/(av-bv);next.push([a[0]+(b[0]-a[0])*f,a[1]+(b[1]-a[1])*f])}
   }poly=next;
 }
 return Math.abs(poly.reduce((s,p,i)=>{const q=poly[(i+1)%poly.length];return s+p[0]*q[1]-p[1]*q[0]},0))/2;
}
function tagNumber(s,unit=''){const match=String(s??'').trim().match(/^([0-9]+(?:\.[0-9]+)?)\s*(m)?$/);return match&&(!match[2]||unit==='m')&&Number(match[1])>0?Number(match[1]):null}
function buildingUse(t){
 const b=t['building:use']||t.building;
 if(['apartments','residential','house','detached','terrace','dormitory'].includes(b))return '居';
 if(t.office||['office','industrial','warehouse','factory'].includes(b))return '职';
 if(category(t)||['retail','hotel','school','hospital','church','public','university','civic','supermarket','kindergarten'].includes(b))return '服';
 return null;
}
function commercialDistances(pois){
 const cells=new Map(),known=new WeakMap(),size=125;
 for(const p of pois){
   if(p[2]!=='零售'&&p[2]!=='餐饮')continue;
   const key=Math.floor(p[0]/size)+','+Math.floor(p[1]/size);
   if(!cells.has(key))cells.set(key,[]);
   cells.get(key).push(p);
 }
 if(!cells.size)return null;
 return p=>{
   if(known.has(p))return known.get(p);
   let best=size;
   const x=Math.floor(p[0]/size),y=Math.floor(p[1]/size);
   for(let i=x-1;i<=x+1;i++)for(let j=y-1;j<=y+1;j++){
     for(const q of cells.get(i+','+j)||[])best=Math.min(best,distance(p,q));
   }
   known.set(p,best);return best;
 };
}
function setupFramework(roads,coords,graph,land,bbox){
 const faces=ringsOfRoads(roads,coords),polys=[];
 for(const w of land){
   if(!w.t.building||w.t.building==='no'||w.ids[0]!==w.ids.at(-1))continue;
   const xs=w.pts.map(p=>p[0]),ys=w.pts.map(p=>p[1]),y=String(w.t.start_date||'').match(/^([12]\d{3})(?:$|-)/);
   polys.push({pts:w.pts,bounds:[Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)],floor:tagNumber(w.t['building:levels']),height:tagNumber(w.t.height,'m'),year:y&&+y[1],use:buildingUse(w.t)});
 }
 const links=[];for(const [a,ns] of graph)for(const [b,len] of ns)if(a<b)links.push({a,b,len,mid:[(coords[a][0]+coords[b][0])/2,(coords[a][1]+coords[b][1])/2]});
 const box=boundsXY(bbox);
 return {faces,polys,links,graph,coords,heightCells:terrainHeightCells(bbox),commercialSafe:box.map((v,i)=>v+(i<2?-115:115))};
}
// Share of walkable links in a 200 m circle accessible by a 200 m walk along the mapped network.
function walkReach(seg,context){
 const {graph,coords,links}=context,rad=200;
 const ids=seg.road.ids.filter(id=>graph.has(id)).sort((a,b)=>distance(seg.mid,coords[a])-distance(seg.mid,coords[b]));
 if(!ids.length)return null;
 const origin=ids[0],offset=distance(seg.mid,coords[origin]);if(offset>90)return null;
 const queue=[[offset,origin]],ds=new Map(queue.map(([d,i])=>[i,d]));
 while(queue.length){queue.sort((a,b)=>b[0]-a[0]);const [d,a]=queue.pop();if(d!==ds.get(a))continue;
   for(const [b,w] of graph.get(a)){const cost=d+w;if(cost<rad&&cost<(ds.get(b)??Infinity)){ds.set(b,cost);queue.push([cost,b])}}
 }
 let available=0,reached=0;
 for(const e of links){if(distance(e.mid,seg.mid)>rad)continue;available+=e.len;reached+=Math.min(e.len,Math.max(0,rad-(ds.get(e.a)??Infinity))+Math.max(0,rad-(ds.get(e.b)??Infinity)))}
 return available?{value:1-clamp01(reached/available),detail:'200 m 内可达步行边长约 '+Math.round(reached)+' / '+Math.round(available)+' m（道路中点归窗）'}:null;
}
// Select at most one junction per compass sector to avoid overweighting dense side roads.
function throughPaths(seg,context){
 const {graph,coords}=context,sectors=Array(8).fill(null),axis=seg.pts,edges=new Set();
 const key=(a,b)=>a<b?a+':'+b:b+':'+a;
 for(let i=1;i<seg.road.ids.length;i++){
   const u=seg.road.ids[i-1],v=seg.road.ids[i],a=coords[u],b=coords[v];
   if(axis.some(p=>{
     const l=distance(a,b);if(!l)return false;
     const t=((p[0]-a[0])*(b[0]-a[0])+(p[1]-a[1])*(b[1]-a[1]))/(l*l);
     return t>1e-6&&t<1-1e-6&&distance(p,[a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])])<.2
   })||(axis.includes(a)&&axis.includes(b)))edges.add(key(u,v));
   else if(axis.some(p=>distance(a,p)<.1)&&axis.some(p=>distance(b,p)<.1))edges.add(key(u,v));
 }
 if(!edges.size)return null;
 for(const [id,neighbours] of graph){
   if(neighbours.length<3)continue;const q=coords[id],d=distance(q,seg.mid);if(d<85||d>190)continue;
   const angle=Math.atan2(q[1]-seg.mid[1],q[0]-seg.mid[0])+Math.PI;
   const k=Math.min(7,Math.floor(angle*4/Math.PI)),err=Math.abs(d-145);
   if(!sectors[k]||err<sectors[k].err)sectors[k]={id,err};
 }
 const ends=sectors.filter(Boolean);if(ends.length<4)return null;let through=0,total=0;
 for(let i=0;i<ends.length-1;i++){
   const src=ends[i].id,ds=new Map([[src,0]]),prev=new Map(),queue=[[0,src]];
   while(queue.length){
     queue.sort((a,b)=>b[0]-a[0]);const [v,u]=queue.pop();if(v!==ds.get(u))continue;
     for(const [t,w] of graph.get(u)){const next=v+w;if(next<450&&next<(ds.get(t)??Infinity)&&distance(coords[t],seg.mid)<=215){ds.set(t,next);prev.set(t,u);queue.push([next,t])}}
   }
   for(let j=i+1;j<ends.length;j++){
     let t=ends[j].id;if(!ds.has(t))continue;total++;let passed=false;
     while(t!==src){const u=prev.get(t);if(edges.has(key(t,u)))passed=true;t=u}if(passed)through++;
   }
 }
 return total>=6?{through,total}:null;
}
function* evidenceDimensions(s,field,context){
 const base = baseIndicators(s, field);
 const a=s.pts[0],b=s.pts.at(-1),c=distance(a,b),dx=(b[0]-a[0])/c,dy=(b[1]-a[1])/c,U=c/2+35,W=106,windowArea=2*U*W;
 const local=p=>{const x=p[0]-s.mid[0],y=p[1]-s.mid[1];return [dx*x+dy*y,dx*y-dy*x]};
 const buckets=(rows,view=false)=>{const out=[[],[]];for(const p of rows){const [u,v]=local(p);if(Math.abs(u)>U||Math.abs(v)>(view?35:110)||(!view&&Math.abs(v)<4))continue;out[(view?u:v)>=0?1:0].push(p)}return out};
 const records=[[],[],[]],min2=arr=>Math.min(...arr)>=2;
 function put(dim,group,label,v,raw){records[dim].push({group,label,v:Number.isFinite(v)?clamp01(v):null,raw})}
 const pair=(arr,fn)=>arr.every(Number.isFinite)?fn(...arr):null;
 const fmt=(arr,fn)=>arr.map(x=>Number.isFinite(x)?fn(x):'缺测').join(' / ');
 const pp=(a,b,scale)=>Math.abs(a-b)/scale;
 const builds=buckets(field.build),n=builds.map(xs=>xs.length);
 if(base[0].v!==null)for(const half of builds)for(const p of half)context.referenceSamples.add(p);
 put(0,'肌理','建筑基底粒度',base[0].v,base[0].why);
 const sides=[[],[]],R=Math.hypot(U,110);
 for(const p of context.polys){
   const box=p.bounds;if(box[2]<s.mid[0]-R||box[0]>s.mid[0]+R||box[3]<s.mid[1]-R||box[1]>s.mid[1]+R)continue;
   const pts=p.pts.map(local);for(const i of [0,1]){const ar=clipRect(pts,-U,U,i?4:-110,i?110:-4);if(ar>1)sides[i].push({...p,ar})}
 }
 const gsi=sides.map(rs=>rs.length>=2?rs.reduce((v,p)=>v+p.ar,0)/windowArea:null);
 const gsiValid=gsi.map(v=>v!==null&&v<=1.001?v:null);
 put(0,'开发强度','建筑覆盖率 GSI',pair(gsiValid,(a,b)=>pp(a,b,.4)),fmt(gsiValid,percent)+' · 轮廓裁入等面积侧窗');
 function tagged(key){
   return sides.map(rs=>{const valid=rs.filter(p=>p[key]!=null),sum=rs.reduce((v,p)=>v+p.ar,0),known=valid.reduce((v,p)=>v+p.ar,0);
     return {coverage:sum?known/sum:0,val:valid.length>=2&&known>=.65*sum?valid.reduce((v,p)=>v+p.ar*p[key],0)/known:null}});
 }
 const height=tagged('height'),floors=tagged('floor'),years=tagged('year');
 const floorSource=floors.every(p=>p.val!==null)?'OSM':'QGIS 建筑1203';
 const floorPair=floorSource==='OSM'?floors:localFloorPair(context.qgisBuildings,s,R,local,U);
 for(const [data,name,key,unit,scale] of [[height,'实标建筑高度','垂直尺度','m',35],[floorPair,'平均层数','垂直尺度','层',10],[years,'建成年代','年代','年',50]]){
   const vals=data.map(x=>x.val);put(0,key,name,pair(vals,(a,b)=>pp(a,b,scale)),fmt(vals,x=>x.toFixed(1)+unit)+' · '+(name==='平均层数'?floorSource:'OSM')+' 已绘轮廓有效面积占比 '+data.map(x=>percent(x.coverage)).join(' / '));
 }
 const pixels=buckets(context.heightCells),heightPair=pixels.map(ps=>ps.length>=4?med(ps.map(p=>p[2])):null);
 put(0,'垂直尺度','遥感估计建筑高度',pair(heightPair,(a,b)=>pp(a,b,35)),fmt(heightPair,x=>x.toFixed(1)+' m')+' · 2020 CNBH；两侧有效20 m格数 '+pixels.map(ps=>ps.length).join(' / '));
 let fsi=floors.map((p,i)=>p.val!=null&&gsiValid[i]!=null?p.val*gsiValid[i]:null),fsiSource='OSM';
 if(!fsi.every(Number.isFinite)){
   const corners=[-U,U].flatMap(u=>[-110,110].map(v=>utm51.forward(lonlat(s.mid[0]+u*dx-v*dy,s.mid[1]+u*dy+v*dx))));
   if(corners.every(p=>inside(p,QGIS_EXTENT))){
     const f=floorSource==='OSM'?localFloorPair(context.qgisBuildings,s,R,local,U):floorPair;
     if(f.every(p=>p.val!=null&&p.area<=windowArea*1.001)){fsi=f.map(p=>p.area*p.val/windowArea);fsiSource='QGIS 建筑1203'}
   }
 }
 put(0,'开发强度','楼面强度 FSI 估计',pair(fsi,(a,b)=>pp(a,b,2)),fmt(fsi,x=>x.toFixed(2))+' · '+fsiSource+' 同源已绘基底覆盖率 × 面积加权层数');
 const probes=[-1,1].map(i=>[s.mid[0]-dy*10*i,s.mid[1]+dx*10*i]);
 const blocks=probes.map(p=>context.faces.find(f=>containsRing(p,f.points)));
 if(blocks[0]&&blocks[1]&&blocks[0]!==blocks[1])for(const p of probes)context.referenceSamples.add(p);
 for(const [key,label] of [['area','封闭街坊面积'],['complexity','街坊形状复杂度']]){
   const vals=blocks.map(f=>f&&f[key]);
   put(0,'街坊',label,blocks[0]===blocks[1]?null:pair(vals,ratioScore),fmt(vals,x=>key==='area'?(x/10000).toFixed(2)+' ha':x.toFixed(2))+' · 两侧独立路网闭合面');
 }
 const reach=walkReach(s,context);put(0,'步行联系','步行可达比例偏低',reach?.value,reach?.detail||'缺少可定位的步行起点');
 const paths=throughPaths(s,context);
 s.pathNote=paths?'局部步行流量潜力参考 · 周边交叉口之间有 '+paths.through+' / '+paths.total+' 条抽样最短路经过该街段（不计分）。':'步行流量潜力参考 · 可连通交叉口样本不足。';
 function summarize(dim){
   const items=records[dim];
   const groups=new Map();for(const d of items){if(d.v===null)continue;if(!groups.has(d.group))groups.set(d.group,[]);groups.get(d.group).push(d.v)}
   const v=groups.size?mean([...groups.values()].map(mean)):null,top=items.filter(x=>x.v!=null).sort((a,b)=>b.v-a.v)[0];
   const visualGroups=dim===2?Array.from(groups,([name,values])=>({name,value:mean(values)})).sort((a,b)=>b.value-a.value):undefined;
   return {v,n:base[dim].n,items,visualGroups,why:top?'最高分项：'+top.label+' · '+top.raw+'。参与 '+groups.size+' 个指标组。':dim===2?'外环采样前/后 '+s.survey.map(g=>g.length).join('/')+' 点，同街实拍前/后 '+photos.map(g=>g.length).join('/')+' 张，历史绿视率前/后 '+base[2].n.join('/')+' 点，未形成有效配对。':'可用数据未达到该维度的比较条件'};
 }
 yield summarize(0);
 const pois=buckets(field.poi),pn=pois.map(z=>z.length);
 if(Math.min(...pn)>=2)for(const half of pois)for(const p of half)context.referenceSamples.add(p);
 put(1,'设施构成','设施类别构成',base[1].v,base[1].why+' · 设施 '+pn.join(' / '));
 const intensity=pois.map(z=>z.reduce((sum,p)=>{const [u,v]=local(p);return sum+Math.exp(-.5*((u/U)**2+(v/80)**2))},0));
 put(1,'设施集聚','POI 局地加权密度',Math.min(...pn)>=2?ratioScore(...intensity):null,fmt(intensity,x=>(x/windowArea*1e4).toFixed(2))+' 加权处/ha · 两侧至少各2处');
 const prices=pois.map(rows=>rows.map(p=>p[5]).filter(v=>Number.isFinite(v)&&v>0));
 const priceMedians=prices.map(xs=>xs.length>=3?med(xs):null);
 put(1,'消费水平','餐饮人均消费',pair(priceMedians,ratioScore),
   fmt(priceMedians,x=>x.toFixed(1)+' 元/人')+' · 两侧有效美食商户 '+prices.map(xs=>xs.length).join(' / ')+' 家，各需至少3家');
 const near=builds.map(rs=>{
   const samples=rs.filter(context.commercialWindow);
   return context.nearestShop&&samples.length>=2?med(samples.map(context.nearestShop)):null;
 });
 put(1,'商业邻近','距餐饮零售设施',min2(n)?pair(near,(a,b)=>pp(a,b,125)):null,fmt(near,x=>Math.round(x)+' m')+' · 建筑质心最近直线距离，中位数，上限125 m');
 const uses=sides.map(rs=>{const known=rs.filter(p=>p.use&&p.floor),sum=rs.reduce((v,p)=>v+p.ar,0);
   const k=known.reduce((v,p)=>v+p.ar,0),by=[0,0,0];for(const p of known)by[['居','职','服'].indexOf(p.use)]+=p.ar*p.floor;
   return {ok:known.length>=2&&k>=.65*sum,by:by.map(v=>v/(by.reduce(add,0)||1)),share:sum?k/sum:0}});
 put(1,'职住服','职住服楼面构成',uses.every(z=>z.ok)?uses[0].by.reduce((v,p,i)=>v+Math.abs(p-uses[1].by[i]),0)/2:null,'居/职/服 '+uses.map(x=>x.ok?x.by.map(percent).join('·'):'缺测').join(' / ')+' · 有用途及楼层覆盖 '+uses.map(x=>percent(x.share)).join(' / '));
 const housing=listingPair(local,U);
 put(1,'住房市场','住宅挂牌单价',housing.v,housing.raw);
 yield summarize(1);
 const photos=buckets(context.photosByRoad.get(String(s.road.id))||[],true);
 s.imported.forEach((points,i)=>photos[i].push(...points));
 const series=new Map();
 photos.forEach((half,i)=>{for(const p of half){
   const q=p[3],day=q.shotDate?.slice(0,10),sequence=q.sequenceId;
   if(!sequence&&!day)continue;
   const id=[q.provider,sequence||'',day||''].join('|');
   if(!series.has(id))series.set(id,[[],[]]);
   series.get(id)[i].push(p);
 }});
 function atSpots(items,k){
   const spots=new Map();for(const p of items){const v=p[3]?.[k];if(!Number.isFinite(v))continue;const id=p[0].toFixed(0)+','+p[1].toFixed(0);if(!spots.has(id))spots.set(id,[]);spots.get(id).push(v)}
   return [...spots.values()].map(med);
 }
 for(const [k,label,family,scale] of [['vegetation','绿视率','植被',.35],['sky','天空可见度','开敞',.35],['building','建筑界面占比','街墙',.35],['road','车行道占比','路权',.35],['sidewalk','人行道占比','路权',.25],['traffic','车人空间配比','路权',.5],['colour','色彩多样性','色彩',.35]]){
   const comparisons=[];
   for(const halves of series.values()){
     const spots=halves.map(g=>atSpots(g,k));
     if(spots.some(g=>!g.length))continue;
     const vals=spots.map(med);
     comparisons.push({v:pp(...vals,scale),vals,counts:spots.map(g=>g.length),q:halves[0][0][3]});
   }
   const best=comparisons.sort((a,b)=>Math.min(...b.counts)-Math.min(...a.counts)||b.counts.reduce(add)-a.counts.reduce(add)||String(a.q.id).localeCompare(String(b.q.id)))[0];
   let v=best?.v??null,raw=best?fmt(best.vals,x=>k==='colour'?x.toFixed(2):percent(x))+' · '+best.q.provider+' '+(best.q.shotDate||'').slice(0,10)+' · 前/后 '+best.counts.join('/')+' 个位置':'同一道路可用实拍前/后 '+photos.map(g=>atSpots(g,k).length).join('/')+' 个位置，缺少同批配对';
   if(k==='traffic')raw+=' · 车行道/(车行道+人行道)';
   const index={vegetation:0,sky:1,building:2,road:3,sidewalk:4,traffic:8,colour:7}[k];
   if(v===null){
     const local=surveyDifference(s,index,k==='colour'?ARCHIVE_SCALES[2]:scale);
     if(local){v=local.v;raw=local.raw+(k==='colour'?' · 存档色彩多样性 SC':'')}
   }
   if(k==='vegetation'&&v===null){v=base[2].v;raw+=(v===null?'；':'；采用')+base[2].why}
   put(2,family,label,v,raw);
   if(k==='sky')s.liveSkyPair=Boolean(best);
 }
 for(const [idx,label,group,scale] of [[5,'界面渗透率 STL','界面渗透',ARCHIVE_SCALES[0]],[6,'街道家具与设施占比','街道设施',ARCHIVE_SCALES[1]]]){
   const item=surveyDifference(s,idx,scale);
   put(2,group,label,item?.v,item?.raw||'缺少外环存档同街段前后有效值');
 }
 return summarize(2);
}
