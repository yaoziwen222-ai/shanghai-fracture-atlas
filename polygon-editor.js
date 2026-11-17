let polyEditing=false,vertices=[],pendingRing=null,polyMarks=null,polyError='';
const asXY=ring=>ring.map(p=>xy(...p));
const leafletRing=ring=>ring.map(([lng,lat])=>[lat,lng]);
function ringBounds(ring){
 const xs=ring.map(p=>p[0]),ys=ring.map(p=>p[1]);
 return [Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)];
}
function updatePolygonUI(){
 $('polygon').setAttribute('aria-pressed',String(polyEditing));
 $('undoPoint').hidden=!polyEditing&&!pendingRing;$('undoPoint').disabled=busy||!vertices.length;
 $('closeRing').hidden=!polyEditing;$('closeRing').disabled=vertices.length<3;
 if(!polyEditing&&!pendingRing)return;
 $('discard').hidden=false;$('map').classList.toggle('drawing',polyEditing);
 if(polyEditing){
   $('analyze').hidden=true;
   $('drawingstatus').textContent=polyError||('已标 '+vertices.length+' 个顶点 · 点击街坊转角；点起点或「闭合」完成。拖动可移动地图。');
 }else if(!busy){
   const size=polygonAreaM(asXY(pendingRing));
   $('drawingstatus').textContent='待分析多边形 · '+(size<10000?Math.round(size)+' m²':(size/1e6).toFixed(3)+' km²')+' · '+vertices.length+' 个顶点'+(selectionProblem(draft)?' · '+selectionProblem(draft):'');
 }
}
function resetPolygon(){
 polyEditing=false;vertices=[];pendingRing=null;polyError='';if(polyMarks)polyMarks.clearLayers();
}
function paintPolygon(){
 polyMarks.clearLayers();const pts=leafletRing(vertices),style={pane:'selectionPane',interactive:false,color:'#ffd28c',weight:3};
 if(pts.length>=2){(pendingRing?L.polygon(pts,{...style,fillOpacity:.16}):L.polyline(pts,style)).addTo(polyMarks)}
 if(polyEditing)pts.forEach((p,i)=>L.circleMarker(p,{...style,radius:i===0?6:3,fillColor:i===0?'#fff':'#ffd28c',fillOpacity:1}).addTo(polyMarks));
 showDraft();
}
function closePolygon(){
 const ring=asXY(vertices),bad=polygonProblem(ring);
 if(bad){polyError=bad;showDraft();return}
 pendingRing=vertices.map(p=>p.slice());draft=ringBounds(vertices);polyEditing=false;atlas.doubleClickZoom.enable();paintPolygon();
}
function initPolygon(){
 polyMarks=L.layerGroup().addTo(atlas);
 $('polygon').onclick=()=>{const exit=polyEditing;cancelSelection();if(exit)return;polyEditing=true;atlas.doubleClickZoom.disable();showDraft()};
 $('closeRing').onclick=closePolygon;
 $('undoPoint').onclick=()=>{pendingRing=null;draft=null;polyEditing=true;atlas.doubleClickZoom.disable();vertices.pop();polyError='';paintPolygon()};
 const el=$('map');let start=null,suppressClick=false;
 // Keep Leaflet drag, wheel and pinch navigation available while placing vertices.
 el.addEventListener('pointerdown',e=>{
   if(!polyEditing||e.button!==0||!e.isPrimary||e.target.closest('.leaflet-control'))return;
   start=[e.clientX,e.clientY];suppressClick=true;
 },true);
 el.addEventListener('pointercancel',()=>{start=null},true);
 el.addEventListener('pointerup',e=>{
   if(!polyEditing||!start||!e.isPrimary)return;
   const p=start;start=null;if(Math.hypot(e.clientX-p[0],e.clientY-p[1])>5)return;
   const pos=atlas.mouseEventToLatLng(e),screen=atlas.latLngToContainerPoint(pos);
   const near=v=>screen.distanceTo(atlas.latLngToContainerPoint([v[1],v[0]]));
   if(vertices.length>=3&&near(vertices[0])<=9){closePolygon();return}
   if(vertices.length&&near(vertices.at(-1))<2)return;
   vertices.push([pos.lng,pos.lat]);polyError='';paintPolygon();
 },true);
 el.addEventListener('click',e=>{if(suppressClick&&!e.target.closest('.leaflet-control')){e.stopImmediatePropagation();suppressClick=false}},true);
 el.addEventListener('pointerdown',()=>{if(!polyEditing)suppressClick=false},true);
 document.addEventListener('keydown',e=>{
   if(!polyEditing||e.target.matches('input,select,textarea,button')&&e.key!=='Escape')return;
   if(e.key==='Enter'&&vertices.length>=3){e.preventDefault();closePolygon()}
   if(e.key==='Backspace'&&vertices.length){e.preventDefault();$('undoPoint').click()}
 });
}
