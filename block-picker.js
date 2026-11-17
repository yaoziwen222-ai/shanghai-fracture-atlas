const blockIds=new Set(),faceGrid=new Map();
let blockPicking=false,blockRegion=null,blockIssue='',roadFaces=null,faceGuides=null,mergedOutline=null;
let demoLabels=null;
const gridCell=v=>Math.floor(v*50);
function decodeFaces(){
 if(roadFaces)return;
 const bytes=fflate.gunzipSync(bytes64(ROAD_FACE_PACK));
 roadFaces=JSON.parse(new TextDecoder().decode(bytes)).map(([paths,neighbors],id)=>{
   const rings=paths.map(flat=>{
     const ring=[];let x=0,y=0;
     for(let i=0;i<flat.length;i+=2){x+=flat[i];y+=flat[i+1];ring.push([x/1e7,y/1e7])}return ring;
   });
   const bounds=ringBounds(rings[0]);
   for(let x=gridCell(bounds[0]);x<=gridCell(bounds[2]);x++)for(let y=gridCell(bounds[1]);y<=gridCell(bounds[3]);y++){
     const key=x+','+y;if(!faceGrid.has(key))faceGrid.set(key,[]);faceGrid.get(key).push(id);
   }return {id,rings,bounds,neighbors};
 });
}
function visibleFaces(b){
 const ids=new Set();
 for(let x=gridCell(b[0]);x<=gridCell(b[2]);x++)for(let y=gridCell(b[1]);y<=gridCell(b[3]);y++)
   for(const id of faceGrid.get(x+','+y)||[])ids.add(id);
 return [...ids].map(i=>roadFaces[i]).filter(({bounds:r})=>r[0]<=b[2]&&r[1]<=b[3]&&r[2]>=b[0]&&r[3]>=b[1]);
}
function faceAt(x,y){
 return visibleFaces([x,y,x,y]).find(({rings})=>containsRing([x,y],rings[0])&&!rings.slice(1).some(r=>containsRing([x,y],r)));
}
function connected(ids){
 if(!ids.size)return true;
 const queue=[ids.values().next().value],seen=new Set(queue);
 for(let i=0;i<queue.length;i++)for(const n of roadFaces[queue[i]].neighbors)
   if(ids.has(n)&&!seen.has(n)){seen.add(n);queue.push(n)}
 return seen.size===ids.size;
}
function redrawFaceGuides(){
 if(!faceGuides)return;
 faceGuides.clearLayers();
 if(!blockPicking||atlas.getZoom()<14)return;
 const v=atlas.getBounds();
 const visible=visibleFaces([v.getWest(),v.getSouth(),v.getEast(),v.getNorth()]);
 const adjacent=new Set([...blockIds].flatMap(i=>roadFaces[i].neighbors));
 for(const face of visible){
   if(blockIds.has(face.id))continue;
   const next=adjacent.has(face.id);
   L.polygon(face.rings.map(leafletRing),{pane:'selectionPane',interactive:false,color:next?'#98b9ff':'#7b8294',weight:next?1.8:1,opacity:next?.85:.48,fillColor:'#819cdc',fillOpacity:next?.20:.035}).addTo(faceGuides);
 }
}
function rebuildBlockRegion(){
 if(mergedOutline){mergedOutline.remove();mergedOutline=null}
 blockRegion=null;draft=null;
 const ids=[...blockIds];
 if(ids.length){
   const polygons=polygonClipping.union(...ids.map(i=>roadFaces[i].rings)).map(poly=>poly.map(r=>r.slice(0,-1)));
   blockRegion={kind:'blocks',ids,polygons};
   draft=polygons.reduce((b,p)=>{const v=ringBounds(p[0]);return [Math.min(b[0],v[0]),Math.min(b[1],v[1]),Math.max(b[2],v[2]),Math.max(b[3],v[3])]},[Infinity,Infinity,-Infinity,-Infinity]);
   mergedOutline=L.polygon(regionLatLngs(blockRegion),{pane:'selectionPane',interactive:false,color:'#ffcf87',weight:3,fillColor:'#f9b96e',fillOpacity:.29}).addTo(atlas);
 }redrawFaceGuides();showDraft();
}
function toggleBlock(face){
 if(!face){blockIssue='这里没有可选的道路围合面，可用多边形沿边界手绘。';showDraft();return}
 const id=face.id;
 if(blockIds.has(id)){
   const rest=new Set(blockIds);rest.delete(id);
   if(!connected(rest)){blockIssue='移除这个街坊会分开选区，请先移除外围街坊。';showDraft();return}
   blockIds.delete(id);
 }else{
   if(blockIds.size&&!face.neighbors.some(n=>blockIds.has(n))){blockIssue='这个街坊与已选街坊不直接相邻。可点浅蓝色邻坊，或清空重选。';showDraft();return}
   blockIds.add(id);
 }blockIssue='';rebuildBlockRegion();
}
function updateBlockUI(){
 $('blockpick').setAttribute('aria-pressed',String(blockPicking));
 $('clearBlocks').hidden=!blockPicking||!blockIds.size;$('clearBlocks').disabled=busy;
 $('blockpick').textContent=blockPicking?'退出街坊点选':model?.polygon?.kind==='blocks'?'继续选街坊':'按街坊选区';
 if(!blockPicking)return;
 $('discard').hidden=false;$('analyze').hidden=!blockIds.size;
 if(busy)return;
 const text=blockRegion?'已选 '+blockIds.size+' 个街坊 · 合计 '+(metricRegion(blockRegion).areaM/1e6).toFixed(4)+' km²'+(blockRegion.polygons.length>1?' · '+blockRegion.polygons.length+' 片':''):'点街坊内部开始选区';
 const hint=atlas.getZoom()<14?'请放大至街坊尺度后点选。':blockIds.size?'点浅蓝色邻坊续选，换片区请清空重选。':'点任一街坊开始选区。';
 $('drawingstatus').textContent=text+' · '+(blockIssue||(draft&&selectionProblem(draft))||hint);
}
function resetBlockPick(){
 blockPicking=false;blockIds.clear();blockRegion=null;blockIssue='';faceGuides?.clearLayers();demoLabels?.clearLayers();
 if(mergedOutline){mergedOutline.remove();mergedOutline=null}
}
function beginBlockPicking(restore=false){
 const saved=restore&&model?.polygon?.kind==='blocks'?model.polygon.ids:[];
 cancelSelection();decodeFaces();blockPicking=true;atlas.doubleClickZoom.disable();for(const id of saved)blockIds.add(id);rebuildBlockRegion();
 if(saved.length&&!atlas.getBounds().contains(mapBounds(draft))){
   atlas.fitBounds(mapBounds(draft),{padding:[38,45],maxZoom:17,animate:false});
 }
}
function initBlockPicker(){
 faceGuides=L.layerGroup().addTo(atlas);demoLabels=L.layerGroup().addTo(atlas);
 $('blockpick').onclick=()=>blockPicking?cancelSelection():beginBlockPicking(true);
 $('clearBlocks').onclick=()=>{blockIds.clear();blockIssue='';rebuildBlockRegion()};
 atlas.on('moveend',()=>{if(blockPicking){redrawFaceGuides();updateBlockUI()}});
 const el=$('map');let start=null;
 el.addEventListener('pointerdown',e=>{start=blockPicking&&!busy&&e.isPrimary&&e.button===0&&!e.target.closest('.leaflet-control')?[e.clientX,e.clientY]:null},true);
 el.addEventListener('pointercancel',()=>{start=null},true);
 el.addEventListener('pointerup',e=>{
   const down=start;start=null;
   if(!down||!e.isPrimary||!blockPicking||busy||Math.hypot(e.clientX-down[0],e.clientY-down[1])>5)return;
   if(atlas.getZoom()<14){showDraft();return}
   const p=atlas.mouseEventToLatLng(e);toggleBlock(faceAt(p.lng,p.lat));
 },true);
 el.addEventListener('click',e=>{if(blockPicking&&!e.target.closest('.leaflet-control'))e.stopImmediatePropagation()},true);
}
function openLonghuaBlocks(){
 beginBlockPicking();
 atlas.fitBounds(mapBounds(LONGHUA_FACES.bbox),{padding:[60,60],maxZoom:17,animate:false});
 LONGHUA_FACES.points.forEach(([x,y],i)=>L.marker([y,x],{pane:'selectionPane',interactive:false,keyboard:false,icon:L.divIcon({className:'face-demo-label',html:i?'B':'A',iconSize:[20,20],iconAnchor:[10,10]})}).addTo(demoLabels));
 blockIssue='点 A、B 可依次选中龙华示例街坊，也可从其他街坊开始。';showDraft();
}
