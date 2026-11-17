const setting={districts:true,uses:true,places:true};
const regionStyle={
 land:['#21242c'],urban:['#2a2e39'],regionRoad:['#414652',.85],rail:['#4a4d5c',.65],outsideLane:['#363943',.8],outsideStreet:['#414652',.85],outsideRoad:['#545965',1],outsideWater:['#243c59',.8],water:['#203955'],waterLine:['#355575',1.2],cityLand:['#2b2b35'],farm:['#4e4136'],housing:['#64523f'],industry:['#4f455e'],commerce:['#684a4d'],green:['#3b4359'],district:['#70646c',.85],cityBorder:['#a38c80',1.65]};
let regionTiles,regionalIndex;
function indexRegion(){
 if(regionalIndex)return regionalIndex;
 const grid=new Map(),step=65536;let sequence=0;
 for(const packed of [REGION_PACK]){
   const rows=JSON.parse(new TextDecoder().decode(fflate.gunzipSync(bytes64(packed))));
   for(const [kind,paths] of rows){
     let a=Infinity,b=Infinity,c=-Infinity,d=-Infinity;
     for(const r of paths)for(let i=0;i<r.length;i+=2){a=Math.min(a,r[i]);b=Math.min(b,r[i+1]);c=Math.max(c,r[i]);d=Math.max(d,r[i+1])}
     const item={kind,paths,a,b,c,d,id:sequence++};
     for(let j=Math.floor(a/step);j<=Math.floor(c/step);j++)for(let k=Math.floor(b/step);k<=Math.floor(d/step);k++){const key=j+','+k;if(!grid.has(key))grid.set(key,[]);grid.get(key).push(item)}
   }
 }regionalIndex=grid;return grid;
}
function regionalMap(){
 const grid=indexRegion(),order=Object.keys(regionStyle),uses=new Set(['housing','industry','commerce','green','farm']);
 const nearbyCache=new Map();
 function nearby(level,cell){
   const key=level+'/'+cell,pack=NEARBY_CELLS[key];
   if(!pack)return [];
   if(!nearbyCache.has(key)){
     const rows=JSON.parse(new TextDecoder().decode(fflate.gunzipSync(bytes64(pack))));
     nearbyCache.set(key,rows.map(([kind,paths])=>{
       let a=Infinity,b=Infinity,c=-Infinity,d=-Infinity;
       for(const p of paths)for(let i=0;i<p.length;i+=2){a=Math.min(a,p[i]);b=Math.min(b,p[i+1]);c=Math.max(c,p[i]);d=Math.max(d,p[i+1])}
       return {kind,paths,a,b,c,d};
     }));
     if(nearbyCache.size>48)nearbyCache.delete(nearbyCache.keys().next().value);
   }return nearbyCache.get(key);
 }
 const Grid=L.GridLayer.extend({createTile(coord){
   const tile=document.createElement('canvas'),z=coord.z,f=2**(18-z),ox=coord.x*256*f,oy=coord.y*256*f,dpr=Math.min(2,devicePixelRatio||1);
   tile.width=tile.height=256*dpr;const ctx=tile.getContext('2d');ctx.scale(dpr,dpr);
   ctx.fillStyle='#1b2a3d';ctx.fillRect(0,0,256,256);
   const all=new Set(),pad=2*f;
   for(let j=Math.floor((ox-pad)/65536);j<=Math.floor((ox+256*f+pad)/65536);j++)for(let k=Math.floor((oy-pad)/65536);k<=Math.floor((oy+256*f+pad)/65536);k++){
     const cell=j+','+k,groups=[grid.get(cell)||[],nearby(8,cell)];
     if(z>=10)groups.push(nearby(10,cell));if(z>=13)groups.push(nearby(13,cell));
     for(const group of groups)for(const g of group)if(g.c>=ox-pad&&g.d>=oy-pad&&g.a<=ox+256*f+pad&&g.b<=oy+256*f+pad)all.add(g);
   }
   for(const g of [...all].sort((a,b)=>order.indexOf(a.kind)-order.indexOf(b.kind))){
     const k=g.kind;if(uses.has(k)&&(!setting.uses||Math.max(g.c-g.a,g.d-g.b)<1.15*f))continue;
     if((k==='cityBorder'||k==='district')&&!setting.districts||k==='outsideStreet'&&z<10||k==='outsideLane'&&z<13)continue;
     const [color,width]=regionStyle[k];
     ctx.beginPath();
     for(const r of g.paths){
       ctx.moveTo((r[0]-ox)/f,(r[1]-oy)/f);
       for(let i=2;i<r.length;i+=2)ctx.lineTo((r[i]-ox)/f,(r[i+1]-oy)/f);
       if(!width)ctx.closePath();
     }
     if(width){ctx.strokeStyle=color;ctx.lineWidth=width;ctx.lineJoin='round';ctx.stroke()}
     else{ctx.fillStyle=k==='cityLand'&&z>=13?'#262932':color;ctx.globalAlpha=uses.has(k)&&z>=14?.43:1;ctx.fill('evenodd');ctx.globalAlpha=1}
   }return studyTile(tile,coord);
 }});
 return new Grid({zIndex:0,maxZoom:19,attribution:'区域地理 © <a href="https://www.naturalearthdata.com/" target="_blank">Natural Earth</a> · <a href="https://datav.aliyun.com/portal/school/atlas/area_selector" target="_blank">DataV 区划</a>'});
}
const regionNames=[
 ['上海市',121.47,31.246,'metro'],['苏州市',120.585,31.299,'city'],['南通市',120.894,31.981,'city'],['嘉兴市',120.755,30.747,'city'],['无锡市',120.312,31.49,'city'],['杭州市',120.155,30.275,'city'],['宁波市',121.55,29.88,'city'],['湖州市',120.087,30.894,'city'],['昆山市',120.982,31.385,'town'],['太仓市',121.13,31.46,'town'],['常熟市',120.747,31.653,'town'],['启东市',121.656,31.808,'town'],['平湖市',121.013,30.697,'town'],['嘉善县',120.925,30.836,'town'],['海门区',121.181,31.87,'town'],['长江口',121.77,31.44,'sea'],['杭州湾',121.489,30.51,'sea'],['太湖',120.188,31.158,'sea'],['东海',122.27,31.03,'sea']];
let namesLayer;
function labelMap(){
 namesLayer.clearLayers();if(!setting.places)return;
 const z=atlas.getZoom();if(z>13)return;
 const group=regionNames.concat(z>=9?DISTRICT_NAMES.map(([n,x,y])=>[n,x,y,'district']):[]);
 const centerDistricts=['黄浦区','徐汇区','长宁区','静安区','普陀区','虹口区','杨浦区'];
 const placed=[];
 for(const [n,x,y,type] of group){
   if(type==='district'&&(!setting.districts||(centerDistricts.includes(n)&&z<11.3))||type==='town'&&z<8.5||type==='metro'&&z>=11.3)continue;
   const point=atlas.latLngToContainerPoint([y,x]);
   if(placed.some(p=>Math.abs(point.x-p.x)<(type==='district'?49:53)&&Math.abs(point.y-p.y)<21))continue;
   placed.push(point);
   L.marker([y,x],{pane:'labelPane',interactive:false,keyboard:false,icon:L.divIcon({className:'geo-name geo-'+type+(containsRing([x,y],OUTER_RING)?'':' geo-outside'),html:n,iconSize:[100,22],iconAnchor:[50,11]})}).addTo(namesLayer);
 }
}
function cityOverview(){
 setScopeFocus(false);
 atlas.fitBounds(mapBounds(outerBounds),{padding:[24,24],animate:false});
}

