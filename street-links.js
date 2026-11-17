function distanceToStreet(p,points){
 let best=Infinity;
 for(let i=1;i<points.length;i++){
   const a=points[i-1],b=points[i],dx=b[0]-a[0],dy=b[1]-a[1],den=dx*dx+dy*dy;
   const t=den?Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/den)):0;
   best=Math.min(best,Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy));
 }
 return best;
}
function photoRoadId(point,photo,roads,roadsById){
 const tagged=roadsById.get(String(photo.way||'0'));
 if(tagged&&distanceToStreet(point,tagged.pts)<=25)return String(tagged.id);
 const nearby=roads.map(road=>({road,gap:distanceToStreet(point,road.pts)}))
   .filter(hit=>hit.gap<=25).sort((a,b)=>a.gap-b.gap);
 if(!nearby.length||(nearby[1]&&nearby[1].gap-nearby[0].gap<3))return null;
 if(tagged?.t.name&&tagged.t.name!==nearby[0].road.t.name)return null;
 return String(nearby[0].road.id);
}
