// No HTTP tiles: draw the licensed Shanghai extract directly in a Leaflet grid.
function localBasemap(){
 const index=new Map(),loaded=new Set(),cell=32768;
 const styles={park:[9,'#394055'],lake:[8,'#263d5c'],river:[9,'#3f5e7c',1.2],stream:[14,'#425574',1],major:[8,'#8d7059',1.5],primary:[9,'#7e6a59',2],secondary:[10,'#6b6161',1.7],tertiary:[12,'#625f66',1.6],street:[14,'#525461',1.2],lane:[16,'#414450',1],city:[8],town:[12]};
 function load(n){
   if(loaded.has(n))return;
   const bytes=fflate.gunzipSync(bytes64(LOCAL_BASEMAP[n]));
   for(const [kind,name,paths] of JSON.parse(new TextDecoder().decode(bytes))){
     let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
     for(const p of paths)for(let i=0;i<p.length;i+=2){x0=Math.min(x0,p[i]);x1=Math.max(x1,p[i]);y0=Math.min(y0,p[i+1]);y1=Math.max(y1,p[i+1])}
     const feature={kind,name,paths,x0,y0,x1,y1};
     for(let x=Math.floor(x0/cell);x<=Math.floor(x1/cell);x++)for(let y=Math.floor(y0/cell);y<=Math.floor(y1/cell);y++){
       const key=x+','+y;if(!index.has(key))index.set(key,[]);index.get(key).push(feature);
     }
   }loaded.add(n);
 }
 const Grid=L.GridLayer.extend({createTile(coord){
   const tile=document.createElement('canvas'),size=256,z=coord.z,f=2**(18-z),ox=coord.x*size*f,oy=coord.y*size*f;
   const labelsOnly=this.options.labelsOnly;
   const dpr=Math.min(2,window.devicePixelRatio||1);tile.width=tile.height=size*dpr;
   const ctx=tile.getContext('2d');ctx.scale(dpr,dpr);
   load(0);if(z>=10)load(1);if(z>=14)load(2);
   if(labelsOnly&&z<13)return tile;
   const fs=new Set(),pad=(labelsOnly?180:45)*f;
   for(let x=Math.floor((ox-pad)/cell);x<=Math.floor((ox+size*f+pad)/cell);x++)for(let y=Math.floor((oy-pad)/cell);y<=Math.floor((oy+size*f+pad)/cell);y++)for(const g of index.get(x+','+y)||[]){
     if(z>=styles[g.kind][0]&&g.x1>=ox-pad&&g.x0<=ox+size*f+pad&&g.y1>=oy-pad&&g.y0<=oy+size*f+pad)fs.add(g)
   }
   const order=['park','lake','stream','river','lane','street','tertiary','secondary','primary','major','town','city'];
   const ordered=[...fs].sort((a,b)=>order.indexOf(a.kind)-order.indexOf(b.kind)),labels=[];
   for(const g of ordered){
     const [,color,weight]=styles[g.kind],place=g.kind==='city'||g.kind==='town',fill=g.kind==='park'||g.kind==='lake';
     if(!place&&Math.max(g.x1-g.x0,g.y1-g.y0)<f*1.2)continue;
     if(!place&&!labelsOnly){
       ctx.beginPath();
       for(const p of g.paths){
         if(!p.length)continue;ctx.moveTo((p[0]-ox)/f,(p[1]-oy)/f);
         for(let i=2;i<p.length;i+=2)ctx.lineTo((p[i]-ox)/f,(p[i+1]-oy)/f);
         if(fill)ctx.closePath();
       }
       if(fill){ctx.fillStyle=color;ctx.fill('evenodd')}
       else{ctx.strokeStyle=color;ctx.lineWidth=weight*(z>=16?1.6:z<=10?.78:1);ctx.lineJoin='round';ctx.stroke()}
     }
     if(labelsOnly&&g.name&&((place&&z>=13)||(!fill&&z>=14&&Math.max(g.x1-g.x0,g.y1-g.y0)>f*72))){
       const path=g.paths[0],i=Math.floor(path.length/4)*2;
       labels.push({x:(path[i]-ox)/f,y:(path[i+1]-oy)/f,text:g.name,place,priority:order.indexOf(g.kind)});
     }
   }
   if(!labelsOnly)return studyTile(tile,coord);
   ctx.textAlign='center';ctx.textBaseline='middle';ctx.lineJoin='round';
   // Include neighbours across tile edges so a label is drawn on both halves of a seam.
   const nearby=[];
   labels.sort((a,b)=>b.priority-a.priority||a.y-b.y||a.x-b.x||a.text.localeCompare(b.text));
   for(const l of labels){
     if(l.x< -180||l.x>size+180||l.y< -24||l.y>size+24)continue;
     ctx.font=(l.place?'600 14':'500 12.5')+'px "Microsoft YaHei",sans-serif';
     const half=ctx.measureText(l.text).width/2+5;
     const blocked=nearby.some(q=>Math.abs(q.x-l.x)<q.half+half&&Math.abs(q.y-l.y)<17);
     nearby.push({...l,half});
     if(blocked||l.x+half<0||l.x-half>size||l.y< -10||l.y>size+10)continue;
     ctx.lineWidth=3;ctx.strokeStyle='#262933';ctx.strokeText(l.text,l.x,l.y);
     ctx.fillStyle=l.place?'#e0e0e7':'#c6c9d2';ctx.fillText(l.text,l.x,l.y);
   }
   return tile;
 }});
 const geometry=new Grid({zIndex:2,maxZoom:19,attribution:'© <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap contributors</a> · <a href="https://download.geofabrik.de/asia/china/shanghai.html" target="_blank">Geofabrik</a> · 本地矢量底图'});
 return L.layerGroup([geometry,new Grid({pane:'streetNamePane',labelsOnly:true,minZoom:13,maxZoom:19})]);
}

