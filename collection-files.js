let listings=[],verifiedScenes=[];
function tableCSV(text){
 const lines=[],row=[];let cell='',quoted=false;
 text=text.replace(/^\uFEFF/,'');
 for(let i=0;i<text.length;i++){
   const c=text[i];
   if(c==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++}else quoted=!quoted}
   else if(c===','&&!quoted){row.push(cell);cell=''}
   else if(c==='\n'&&!quoted){row.push(cell.replace(/\r$/,''));lines.push(row.splice(0));cell=''}
   else cell+=c;
 }
 if(quoted)throw Error('CSV 引号未闭合');
 if(cell||row.length){row.push(cell.replace(/\r$/,''));lines.push(row)}
 const headers=lines.shift()||[];
 return lines.filter(r=>r.length===headers.length).map(r=>Object.fromEntries(headers.map((k,i)=>[k.trim(),r[i].trim()])));
}
function loadListings(rows){
 if(!rows.length||!('房源ID' in rows[0])||!('小区名称' in rows[0])||!('房屋单价' in rows[0]))throw Error('需要链家脚本输出的房源 CSV');
 const parcels=new Map(),groups=new Map(),unique=new Map();
 const districtNames={xuhui:'徐汇',huangpu:'黄浦',jingan:'静安',putuo:'普陀',changning:'长宁',hongkou:'虹口',yangpu:'杨浦',pudong:'浦东新',pudongxinqu:'浦东新',baoshan:'宝山',minhang:'闵行',jiading:'嘉定',qingpu:'青浦',songjiang:'松江',fengxian:'奉贤',jinshan:'金山',chongming:'崇明'};
 const district=v=>String(districtNames[v]||v||'').replace(/区$/,'').replace(/^浦东新$/,'浦东');
 for(const [name,area,...bounds] of RESIDENTIAL_PARCELS){
   const key=district(area)+'|'+name.normalize('NFKC').trim();
   parcels.set(key,parcels.has(key)?null:bounds);
 }
 for(const r of rows){
   const day=Date.parse((r['采集时间']||'').slice(0,10)),id=r['房源ID'],price=Number(r['房屋单价'].replaceAll(',',''));
   if(id&&Number.isFinite(price)&&price>0&&Number.isFinite(day)&&(!unique.has(id)||day>=unique.get(id).day))
     unique.set(id,{name:district(r['区域'])+'|'+r['小区名称'].normalize('NFKC'),price,day});
 }
 const end=[...unique.values()].reduce((v,r)=>Math.max(v,r.day),0);
 let located=0;
 for(const r of unique.values()){
   const bounds=parcels.get(r.name);
   if(!bounds||end-r.day>29*86400000)continue;
   if(!groups.has(r.name))groups.set(r.name,{bounds,prices:[]});
   groups.get(r.name).prices.push(r.price);located++;
 }
 listings=[...groups.values()].map(({bounds:[w,s,e,n],prices})=>({
   corners:[[w,s],[w,n],[e,s],[e,n]].map(p=>xy(...utm51.inverse(p))),price:med(prices)
 }));
 return '近30日匹配 '+located+' 条挂牌、'+listings.length+' 个唯一小区（CSV '+rows.length+' 行）';
}
function listingPair(local,U){
 const halves=[[],[]];
 for(const item of listings){
   const corners=item.corners.map(local);
   for(const i of [0,1])if(corners.every(([u,v])=>Math.abs(u)<=U&&(i?v:-v)>=4&&(i?v:-v)<=110))halves[i].push(item.price);
 }
 return {v:halves.every(h=>h.length>=3)?ratioScore(...halves.map(med)):null,
   raw:'两侧唯一小区 '+halves.map(h=>h.length).join(' / ')+' 个，各需3个；挂牌中位数 '+halves.map(h=>h.length>=3?Math.round(med(h))+'元/㎡':'缺测').join(' / ')};
}
function exportScenePlan(){
 const lines=['id,lng,lat,bearing'];
 for(const s of model.segments.filter(s=>s.evidence[2].v===null)){
   const edges=surveyEdges(s.pts),a=s.pts[0],b=s.pts.at(-1);
   const heading=(Math.atan2(b[0]-a[0],b[1]-a[1])*180/Math.PI+360)%360;
   for(const [half,t] of [[0,.25],[1,.75]]){
     const p=station({edges},t*s.len).p;if(!model.belongs(p))continue;
     const [x,y]=lonlat(...p);lines.push([s.id+'_'+half,x.toFixed(7),y.toFixed(7),heading.toFixed(1)].join(','));
   }
 }
 const url=URL.createObjectURL(new Blob([lines.join('\r\n')],{type:'text/csv;charset=utf-8'}));
 const a=document.createElement('a');a.href=url;a.download='streetview_points.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function loadScenes(files){
 const list=[...files],manifest=list.find(f=>f.name==='downloads.csv');
 if(!manifest)throw Error('请选择包含 downloads.csv 的百度街景输出目录');
 const rows=tableCSV(await manifest.text());
 if(!rows.length||!['panoid','actual_wgs84_lng','actual_wgs84_lat','shot_date'].every(k=>k in rows[0]))
   throw Error('清单需补充实际全景 panoid、actual_wgs84_lng、actual_wgs84_lat 和 shot_date；请求坐标不足以判定道路');
 const base=manifest.webkitRelativePath.slice(0,-manifest.name.length);
 const images=new Map(list.map(f=>[f.webkitRelativePath.slice(base.length),f]));
 const seen=new Set(),owner=new Map(),scenes=[],hashes=new Map(),imageOwner=new Map();
 for(const row of rows){
   if(!['downloaded','skipped'].includes(row.status)||!row.panoid)continue;
   const prev=owner.get(row.panoid);owner.set(row.panoid,prev&&prev!==row.point_id?'ambiguous':row.point_id);
   const file=images.get(row.file?.replaceAll('\\','/'));
   if(!file)continue;
   if(!hashes.has(file)){
     const hash=await crypto.subtle.digest('SHA-256',await file.arrayBuffer());
     hashes.set(file,Array.from(new Uint8Array(hash),n=>n.toString(16).padStart(2,'0')).join(''));
   }
   const digest=hashes.get(file),other=imageOwner.get(digest);
   imageOwner.set(digest,other&&other!==row.point_id?'ambiguous':row.point_id);
 }
 for(const row of rows){
   const file=images.get(row.file?.replaceAll('\\','/')),parts=/^(.+)_([01])$/.exec(row.point_id);
   if(!parts||!file||!row.panoid||owner.get(row.panoid)!==row.point_id||!['downloaded','skipped'].includes(row.status))continue;
   if(imageOwner.get(hashes.get(file))!==row.point_id)continue;
   const x=Number(row.actual_wgs84_lng),y=Number(row.actual_wgs84_lat);
   if(!inside([x,y],outerBounds)||!/^\d{4}-\d{2}-\d{2}$/.test(row.shot_date)||!Number.isFinite(Date.parse(row.shot_date)))continue;
   const angle=[row.heading,row.pitch,row.fov].map(Number);
   if(angle.some(v=>!Number.isFinite(v))||![row.heading,row.pitch,row.fov].every(Boolean))continue;
   const batch=[row.shot_date,...angle].join('|'),key=row.panoid+'|'+batch;
   if(seen.has(key))continue;
   let img;
   try{img=await createImageBitmap(file);const metrics=await sceneMeasures(img);if(!Number.isFinite(metrics.sky))continue;
     scenes.push({segment:parts[1],half:+parts[2],panoid:row.panoid,x,y,shotDate:row.shot_date,batch,metrics});seen.add(key);
   }catch{/* An unreadable image contributes no observation. */}finally{img?.close()}
 }
 verifiedScenes=scenes;
 return '读图并完成分割 '+scenes.length+' 个有效视角（清单 '+rows.length+' 行），按实际机位核对街段';
}
function assignLocalScenes(segments,roads,belongs){
 const byId=new Map(segments.map(s=>[s.id,s])),index=surveyIndex(segments);
 for(const s of segments)s.imported=[[],[]];
 for(const q of verifiedScenes){
   const s=byId.get(q.segment),p=xy(q.x,q.y);
   if(!s||!belongs(p)||photoRoadId(p,{},roads,new Map())!==String(s.road.id))continue;
   const choices=new Map();
   for(const edge of index(p)){
     if(edge.item.road!==s.road)continue;
     const proj=projectSurvey(p,edge);
     if(proj.dist>12||proj.along<0||proj.along>edge.len)continue;
     if(!choices.has(edge.item)||proj.dist<choices.get(edge.item).dist)choices.set(edge.item,proj);
   }
   const hits=[...choices].sort((a,b)=>a[1].dist-b[1].dist);
   if(hits[0]?.[0]!==s||(hits[1]&&hits[1][1].dist-hits[0][1].dist<3)||Number(hits[0][1].m>=s.len/2)!==q.half)continue;
   const metrics=q.metrics;
   s.imported[q.half].push([...p,metrics.g,{...metrics,provider:'百度静态全景',id:q.panoid,shotDate:q.shotDate,sequenceId:q.batch,
     traffic:metrics.road+metrics.sidewalk>=.025?metrics.road/(metrics.road+metrics.sidewalk):null}]);
 }
}
function initCollectionFiles(){
 $('scenePlan').onclick=exportScenePlan;
 for(const [id,load] of [['houseFile',async files=>loadListings(tableCSV(await files[0].text()))],['sceneFiles',loadScenes]]){
   $(id).onchange=async e=>{
     const input=e.target;if(!input.files.length)return;input.disabled=true;
     const status=$(id==='sceneFiles'?'sceneFileStatus':'houseFileStatus');
     status.textContent='正在读取并核对数据…';
     try{const msg=await load(input.files);run(false);status.textContent=msg}
     catch(err){status.textContent=err.message}
     finally{input.value='';input.disabled=false}
   };
 }
}
