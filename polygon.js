// Geometry in the same local metre system as street scoring; boundaries are included.
const cross2=(a,b)=>a[0]*b[1]-a[1]*b[0],sub2=(a,b)=>[a[0]-b[0],a[1]-b[1]];
const interpolate=(a,b,t)=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];
function onEdge(p,a,b){
 const d=sub2(b,a),v=sub2(p,a),len=Math.hypot(...d);
 if(len<1e-7)return distance(p,a)<1e-6;
 return Math.abs(cross2(d,v))<=1e-5*len&&(p[0]-a[0])*(p[0]-b[0])+(p[1]-a[1])*(p[1]-b[1])<=1e-5*len;
}
function touchesRing(p,ring){
 return ring.some((a,i)=>onEdge(p,a,ring[(i+1)%ring.length]))||containsRing(p,ring);
}
function edgeCuts(a,b,c,d){
 const r=sub2(b,a),s=sub2(d,c),q=sub2(c,a),det=cross2(r,s);
 if(Math.abs(det)>1e-10){
   const t=cross2(q,s)/det,u=cross2(q,r)/det;
   return t>=-1e-9&&t<=1+1e-9&&u>=-1e-9&&u<=1+1e-9?[Math.max(0,Math.min(1,t))]:[];
 }
 if(Math.abs(cross2(q,r))>1e-6*Math.hypot(...r))return [];
 const axis=Math.abs(r[0])>Math.abs(r[1])?0:1;
 if(!r[axis])return [];
 const ts=[(c[axis]-a[axis])/r[axis],(d[axis]-a[axis])/r[axis]].sort((x,y)=>x-y);
 return ts[0]<=1&&ts[1]>=0?[Math.max(0,ts[0]),Math.min(1,ts[1])]:[];
}
function polygonAreaM(ring){
 const o=ring[0];return Math.abs(ring.reduce((s,p,i)=>s+cross2(sub2(p,o),sub2(ring[(i+1)%ring.length],o)),0))/2;
}
function polygonProblem(ring){
 if(ring.length<3)return '至少需要三个不同顶点。';
 for(let i=0;i<ring.length;i++){
   const a=ring[i],b=ring[(i+1)%ring.length],prev=ring[(i+ring.length-1)%ring.length];
   if(distance(a,b)<0.01||onEdge(b,prev,a)||onEdge(prev,a,b))return '顶点重合或边线折返，请撤销并重新落点。';
   for(let j=i+2;j<ring.length;j++){
     if(i===0&&j===ring.length-1)continue;
     if(edgeCuts(a,b,ring[j],ring[(j+1)%ring.length]).length)return '多边形边线相交，请撤销并重新落点。';
   }
 }return polygonAreaM(ring)>.01?'':'多边形面积过小，请调整顶点。';
}
function clipStreet(pts,ring){
 const pieces=[];let chain=null;
 for(let i=1;i<pts.length;i++){
   const a=pts[i-1],b=pts[i];if(distance(a,b)<1e-6)continue;
   const cuts=[0,1];
   for(const loop of ring.loops||[ring])for(let j=0;j<loop.length;j++)cuts.push(...edgeCuts(a,b,loop[j],loop[(j+1)%loop.length]));
   cuts.sort((x,y)=>x-y);
   for(let j=1;j<cuts.length;j++){
     const l=cuts[j-1],h=cuts[j];if(h-l<1e-9)continue;
     if(!touchesRegion(interpolate(a,b,(l+h)/2),ring)){chain=null;continue}
     const start=interpolate(a,b,l),end=interpolate(a,b,h);
     if(!chain||distance(chain.at(-1),start)>1e-5){chain=[start];pieces.push(chain)}chain.push(end);
   }
 }return pieces;
}
function polygonSections(part,ring){
 return clipStreet(part,ring).flatMap(pts=>{
   const len=pts.slice(1).reduce((s,p,i)=>s+distance(pts[i],p),0);
   if(len<35||distance(pts[0],pts.at(-1))<25)return [];
   let mid=interpolate(pts[0],pts.at(-1),.5);
   if(!touchesRegion(mid,ring)){
     let remaining=len/2;
     for(let i=1;i<pts.length;i++){const edge=distance(pts[i-1],pts[i]);if(remaining<=edge){mid=interpolate(pts[i-1],pts[i],remaining/edge);break}remaining-=edge}
   }
   return [{pts,mid,len}];
 });
}
function regionLatLngs(region){
 return region.kind==='blocks'?region.polygons.map(p=>p.map(leafletRing)):leafletRing(region);
}
function metricRegion(region){
 const polygons=(region.kind==='blocks'?region.polygons:[[region]]).map(poly=>poly.map(asXY));
 const loops=polygons.flat(),areaM=polygons.reduce((sum,poly)=>sum+polygonAreaM(poly[0])-poly.slice(1).reduce((s,r)=>s+polygonAreaM(r),0),0);
 return {loops,areaM};
}
function touchesRegion(p,region){
 if(!region.loops)return touchesRing(p,region);
 if(region.loops.some(r=>r.some((a,i)=>onEdge(p,a,r[(i+1)%r.length]))))return true;
 return region.loops.reduce((n,r)=>n+Number(containsRing(p,r)),0)%2===1;
}

// Union the original footprint with a round-ended strip along every boundary edge.
// Work in local metres; integer centimetres keep coincident edges stable in the union.
function analysisFootprint(b,region,radius){
 const [w,s,e,n]=b;
 const selection=region?.kind==='blocks'?region.polygons:[[region||[[w,s],[e,s],[e,n],[w,n]]]];
 const grid=p=>xy(...p).map(v=>Math.round(v*100));
 const shape=selection.map(poly=>poly.map(r=>r.map(grid)));
 const kernel=Array.from({length:48},(_,i)=>{
   const a=i*2*Math.PI/48;
   return [Math.round(100*radius*Math.cos(a)),Math.round(100*radius*Math.sin(a))];
 });
 function capsule(a,b){
   const dx=b[0]-a[0],dy=b[1]-a[1];
   // Split the round kernel at the two support vertices perpendicular to this edge.
   let hi=0,lo=0,best=-Infinity,worst=Infinity;
   kernel.forEach(([x,y],i)=>{const k=dx*y-dy*x;if(k>best){hi=i;best=k}if(k<worst){lo=i;worst=k}});
   const arc=(p,start,end)=>{
     const pts=[];for(let j=start;;j=(j+1)%kernel.length){
       pts.push([p[0]+kernel[j][0],p[1]+kernel[j][1]]);if(j===end)return pts;
     }
   };
   return [[...arc(a,hi,lo),...arc(b,lo,hi)]];
 }
 let parts=[shape];
 for(const ring of shape.flat())for(let i=0;i<ring.length;i++){
   const a=ring[i],b=ring[(i+1)%ring.length];if(a[0]!==b[0]||a[1]!==b[1])parts.push(capsule(a,b));
 }
 while(parts.length>1){
   const merged=[];for(let i=0;i<parts.length;i+=16)merged.push(polygonClipping.union(...parts.slice(i,i+16)));
   parts=merged;
 }
 const expanded=parts[0].map(poly=>poly.map(r=>r.map(([x,y])=>lonlat(x/100,y/100))));
 const outline=polygonClipping.intersection(expanded,[OUTER_RING]);
 return {selection,outline,band:polygonClipping.difference(outline,selection)};
}
