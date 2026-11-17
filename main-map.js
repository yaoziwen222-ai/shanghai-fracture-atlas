let atlas,baseShapes,results,baseKey=null,draft=null,draftShape=null,armed=false,gesture=null,firstCorner=null,busy=false;
const mapPoint=p=>{const [lng,lat]=lonlat(...p);return [lat,lng]};
const mapBounds=b=>[[b[1],b[0]],[b[3],b[2]]];
let scopeFocus=false,scopeLayers,scopeModel;
function setScopeFocus(on){
 scopeFocus=on;
 syncScope();
}
function syncScope(){
 const pending=!!(armed||polyEditing||blockPicking||gesture||draft||busy);
 for(const layer of [baseShapes,results]){
   if(!layer)continue;
   if(pending)layer.remove();
   else if(!atlas.hasLayer(layer))layer.addTo(atlas);
 }
 const visible=scopeFocus&&model&&!pending;
 $('scopeLegend').hidden=!visible;
 if(!visible){scopeLayers?.remove();return}
 if(scopeModel!==model){
   scopeLayers?.remove();
   scopeLayers=L.layerGroup();scopeModel=model;
   const study=[OUTER_RING];
   const {selection,outline:context,band}=model.footprint;
   const options={pane:'scopePane',interactive:false,smoothFactor:0.35};
   function draw(polygons,style){
     if(polygons.length)L.polygon(polygons.map(poly=>poly.map(leafletRing)),{...options,...style}).addTo(scopeLayers);
   }
   const selectedShape=polygonClipping.intersection(selection,study);
   draw(selectedShape,{pane:'scopeGroundPane',stroke:false,fillColor:'#b7b9c4',fillOpacity:.18});
   draw(polygonClipping.difference(study,context),{stroke:false,fillColor:'#101116',fillOpacity:.58});
   draw(band,{stroke:false,fillColor:'#171b25',fillOpacity:.29});
   decodeFaces();
   const faces=new Set();
   for(const p of model.referenceSamples){
     if(model.belongs(p))continue;
     const ll=lonlat(p[0],p[1]),face=faceAt(...ll);
     if(face)faces.add(face);
   }
   let count=0;
   for(const face of faces){
     const portion=polygonClipping.intersection(face.rings,band);
     if(!portion.length)continue;
     draw(portion,{color:'#8292ae',weight:.9,opacity:.68,fillColor:'#667ba4',fillOpacity:.12});
     count++;
   }
   $('referenceFaceCount').textContent='有参照样本的街坊 · '+count;
   draw(context,{fill:false,color:'#8f97a9',weight:1.3,dashArray:'4 5'});
   draw(selectedShape,{fill:false,color:'#d7bd95',weight:1.8});
 }
 if(!atlas.hasLayer(scopeLayers))scopeLayers.addTo(atlas);
}
function selectionProblem(b,region=blockPicking?blockRegion:pendingRing){
 if(!b||b.length!==4||!b.every(Number.isFinite)||b[2]<=b[0]||b[3]<=b[1])return '请画出有宽度和高度的矩形。';
 if(!inside(b.slice(0,2),TILEBOX)||!inside(b.slice(2),TILEBOX))return '请将选区放在上海工作范围内。';
 if(!studyContains(b,region))return '请将选区全部放在上海外环线内的彩色区域。';
 const requestArea=(b[2]-b[0]+480/MX)*(b[3]-b[1]+480/MY);
 return requestArea>.25?'范围超过单次地图数据请求上限，请缩小选区。':'';
}
function showDraft(){
 const info=$('drawingstatus'),error=draft?selectionProblem(draft):'';
 $('box').setAttribute('aria-pressed',String(armed));
 $('box').textContent=armed?'退出框选':'矩形框选';
 $('analyze').hidden=!draft;$('analyze').disabled=!!error||busy||!!gesture||!!firstCorner;
 $('discard').hidden=!draft&&!armed&&!busy;
 $('map').classList.toggle('drawing',armed||!!gesture);
 if(busy)info.textContent='正在查询选区街景并计算感知差异… 可取消。';
 else if(draft){
   const w=(draft[2]-draft[0])*MX,h=(draft[3]-draft[1])*MY,m2=w*h;
   info.textContent='待分析选区 '+(m2<10000?Math.round(m2)+' m²':(m2/1e6).toFixed(2)+' km²')+' · '+Math.round(w)+' × '+Math.round(h)+' m'+(error?' · '+error:'');
 }else info.textContent=armed?(firstCorner?'请点另一个角，完成后自动采集。':'拖出矩形，松开后自动采集街景。也可依次点两个对角。'):'拖动平移，滚轮缩放；Shift 拖出矩形后自动分析。';
 updatePolygonUI();updateBlockUI();$('map').classList.toggle('pickingArea',armed||polyEditing||blockPicking||busy);syncScope();info.parentElement.classList.toggle('idle',!draft&&!armed&&!polyEditing&&!blockPicking&&!busy);
}
function setArmed(on){
 armed=on;firstCorner=null;
 if(on){atlas.dragging.disable();atlas.doubleClickZoom.disable()}
 else{atlas.dragging.enable();atlas.doubleClickZoom.enable()}
 showDraft();
}
function clearDraft(){
 resetPolygon();resetBlockPick();
 draft=null;if(draftShape){draftShape.remove();draftShape=null}
 gesture=null;setArmed(false);
}
function cancelSelection(){
 if(busy||$('fetch').disabled){invalidate();busy=false;$('message').textContent='采集已取消，地图显示最近一次成功分析的结果。'}
 clearDraft();
}
function updateDraft(a,b){
 draft=[Math.min(a.lng,b.lng),Math.min(a.lat,b.lat),Math.max(a.lng,b.lng),Math.max(a.lat,b.lat)];
 const style={color:selectionProblem(draft)?'#ff647a':'#ffd28c',weight:3,dashArray:'7 4',fillOpacity:.12,interactive:false,pane:'selectionPane'};
 if(draftShape)draftShape.setBounds(mapBounds(draft)).setStyle(style);
 else draftShape=L.rectangle(mapBounds(draft),style).addTo(atlas);
 showDraft();
}
function initMainMap(){
 atlas=L.map('map',{zoomControl:false,boxZoom:false,maxZoom:19,minZoom:8,zoomSnap:.25,zoomDelta:1,zoomAnimation:false,preferCanvas:true,maxBounds:[[29.65,119.65],[32.5,122.68]],maxBoundsViscosity:.85});
 atlas.createPane('selectionPane').style.zIndex=550;
 // Ground below footprints, names above footprints, zone masks below result streets.
 for(const [name,z] of [['scopeGroundPane',350],['streetNamePane',410]]){
   const pane=atlas.createPane(name);pane.style.zIndex=z;pane.style.pointerEvents='none';
 }
 const scopePane=atlas.createPane('scopePane');scopePane.style.zIndex=415;scopePane.style.pointerEvents='none';
 atlas.createPane('streetPane').style.zIndex=430;
 regionTiles=regionalMap().addTo(atlas);localBasemap().addTo(atlas);
 showStudyBoundary();
 atlas.createPane('labelPane').style.zIndex=480;atlas.getPane('labelPane').style.pointerEvents='none';namesLayer=L.layerGroup().addTo(atlas);atlas.on('moveend',labelMap);
 L.control.zoom({position:'bottomright',zoomInTitle:'放大地图',zoomOutTitle:'缩小地图'}).addTo(atlas);
 L.control.scale({imperial:false,position:'bottomleft'}).addTo(atlas);
 baseShapes=L.layerGroup().addTo(atlas);results=L.layerGroup().addTo(atlas);
 atlas.on('zoomend',()=>{if(model)render()});
 new ResizeObserver(()=>atlas.invalidateSize({pan:false})).observe($('map'));
 $('locate').onclick=fit;
 const places=$('places'),order=new Intl.Collator('zh-CN-u-co-pinyin');
 for(const group of places.querySelectorAll('optgroup')){
   group.append(...Array.from(group.children).sort((a,b)=>order.compare(a.text,b.text)));
 }
 function finishLocation(){
   if(compactLayout.matches){setSidebar('left',false);atlas.invalidateSize()}
 }
 places.onchange=()=>{
   if(!places.value)return;
   setScopeFocus(false);
   atlas.setView(places.value.split(',').map(Number),15,{animate:false});
   $('coordmsg').textContent='';finishLocation();
 };
 atlas.on('moveend',()=>{
   if(places.value&&atlas.getCenter().distanceTo(places.value.split(',').map(Number))>100)places.value='';
 });
 $('overview').onclick=()=>{places.value='';$('coordmsg').textContent='';finishLocation();cityOverview()};
 $('coordform').oninput=()=>{$('coordmsg').textContent=''};
 $('coordform').onsubmit=e=>{
   e.preventDefault();const x=$('lnginput').valueAsNumber,y=$('latinput').valueAsNumber;
   if(!inside([x,y],TILEBOX)){$('coordmsg').textContent='该坐标超出上海地图范围，请检查经度和纬度。';return}
   places.value='';finishLocation();setScopeFocus(false);atlas.setView([y,x],16,{animate:false});
   $('coordmsg').textContent='已定位到 '+x+'°E，'+y+'°N';
 };
 $('box').onclick=()=>{if(armed){cancelSelection();return}cancelSelection();setArmed(true)};
 $('discard').onclick=cancelSelection;
 async function analyzeDraft(){
   if(busy||selectionProblem(draft))return;
   const b=draft.slice();busy=true;setArmed(false);
   const task=acquire(b,false,false,blockPicking?blockRegion:pendingRing),token=request;
   const ok=await task;if(token!==request)return;
   busy=false;if(ok){clearDraft();showResults()}else showDraft();
 }
 $('analyze').onclick=analyzeDraft;
 const el=$('map');
 const point=e=>atlas.mouseEventToLatLng(e);
 const stop=e=>{e.preventDefault();e.stopImmediatePropagation()};
 el.addEventListener('pointerdown',e=>{
   if(blockPicking||polyEditing||e.button!==0||!e.isPrimary||e.target.closest('.leaflet-control')||!(armed||e.shiftKey))return;
   stop(e);if(pendingRing||busy||$('fetch').disabled)cancelSelection();
   atlas.stop();atlas.dragging.disable();atlas.doubleClickZoom.disable();
   gesture={id:e.pointerId,start:firstCorner||point(e),x:e.clientX,y:e.clientY,finishOnTap:!!firstCorner};el.setPointerCapture(e.pointerId);showDraft();
 },true);
 el.addEventListener('pointermove',e=>{
   if(!gesture||e.pointerId!==gesture.id)return;
   stop(e);if(Math.hypot(e.clientX-gesture.x,e.clientY-gesture.y)>3)updateDraft(gesture.start,point(e));
 },true);
 el.addEventListener('pointerup',e=>{
   if(!gesture||e.pointerId!==gesture.id)return;stop(e);const g=gesture;gesture=null;
   if(el.hasPointerCapture(e.pointerId))el.releasePointerCapture(e.pointerId);
   if(g.finishOnTap||Math.hypot(e.clientX-g.x,e.clientY-g.y)>3){
     updateDraft(g.start,point(e));setArmed(false);analyzeDraft();
   }else{setArmed(true);firstCorner=g.start;showDraft()}
 },true);
 // Suppress Leaflet's compatibility mouse events when drawing on top of a street.
 for(const type of ['mousedown','click','dblclick'])el.addEventListener(type,e=>{
   if(!e.target.closest('.leaflet-control')&&(armed||gesture||e.shiftKey))stop(e);
 },true);
 el.addEventListener('pointercancel',e=>{if(gesture?.id===e.pointerId)cancelSelection()});
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('analysisProgress').open&&(armed||draft||gesture||polyEditing||blockPicking))cancelSelection()});
 initPolygon();initBlockPicker();showDraft();
}
function render(){
 if(!model||!atlas)return;
 syncScope();
 const detailed=atlas.getZoom()>=14;
 if(baseKey!==model||baseShapes.detail!==detailed){
   baseKey=model;baseShapes.detail=detailed;baseShapes.clearLayers();
   if(detailed){
     for(const w of model.land){
       const building=!!w.t.building,fill=building?'#747987':w.t.natural==='water'?'#395578':'#42455a';
       L.polygon(w.pts.map(mapPoint),{interactive:false,stroke:building,color:'#a0a4b1',weight:.75,opacity:.65,fillOpacity:building?.62:.53,fillColor:fill}).addTo(baseShapes);
     }
     for(const w of model.roads){L.polyline(w.pts.map(mapPoint),{color:'#646370',weight:1,opacity:.65,interactive:false}).addTo(baseShapes)}
   }
 }
 results.clearLayers();
 function stroke(pts,style){return L.polyline(pts,{pane:'streetPane',interactive:false,...style}).addTo(results)}
 function street(s,pts){const hit=stroke(pts,{weight:12,opacity:0,interactive:true,bubblingMouseEvents:false});hit.bindTooltip(safe(s.name),{sticky:true});hit.on('click',()=>{if(!blockPicking&&!polyEditing&&!armed&&!gesture){select(s);showResults(true)}})}
 for(const s of [...ranked.filter(s=>s!==selected),...(selected?[selected]:[])]){
   const pts=s.pts.map(mapPoint),colors=s===selected&&!ranked.includes(s)?[]:color.filter((_,i)=>active(s)[i]),w=colors.length;
   if(s===selected)stroke(pts,{weight:3*w+5,color:'#f3e5d8'});
   colors.forEach((c,i)=>stroke(pts,{weight:3*(w-i),color:c,opacity:1}));street(s,pts);
 }
}



