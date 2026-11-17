// The framework is taken from the same evidence records shown in street details.
let indicatorSchema;
function rememberIndicators(segments){
 if(segments.length)indicatorSchema=segments[0].evidence.map(e=>e.items.map(i=>i.label));
}
const dimensionCaptions=[
 '比较街道两侧的建筑肌理、开发强度与街坊边界，并核对步行联系。',
 '比较街道两侧的设施构成、消费水平、职住服用途与住房市场。',
 '沿同一街段比较前后两半的视野、街道界面与路权变化。'
];
function drawDimension(canvas,dim){
 const g=canvas.getContext('2d'),ink=color[dim];
 const w=canvas.width,h=canvas.height;
 g.clearRect(0,0,w,h);g.fillStyle='#222630';g.fillRect(0,0,w,h);
 if(dim<2){
   for(let row=-1;row<4;row++){
     for(let col=-1;col<17;col++){
       const x=col*48+row*6,y=row*34;
       if(x>300&&x<365)continue;
       if(dim===0&&x>365&&col%2===0)continue;
       g.fillStyle=dim===0?(x<335?'#655c5a':'#937967'):'#343e51';
       g.fillRect(x,y,dim===0&&x>365?83:36,23);
       if(dim===1){
         for(let n=0;n<(x<335?3:1);n++){
           g.beginPath();g.fillStyle=n===0?'#67b9ff':n===1?'#ff975d':'#ca9bff';
           g.arc(x+8+n*9,y+8+(col+row+n)%3*2,3.5,0,2*Math.PI);g.fill();
         }
       }
     }
   }
   g.fillStyle='#17191f';g.fillRect(300,0,60,h);g.strokeStyle=ink;g.lineWidth=3;g.setLineDash([9,6]);g.beginPath();g.moveTo(330,0);g.lineTo(330,h);g.stroke();g.setLineDash([]);
 }else{
   g.fillStyle='#353d57';g.fillRect(0,0,w,68);
   g.fillStyle='#39353d';g.fillRect(0,68,w,50);
   for(let x=0;x<w;x+=42){
     const height=x<350?20+(x%5)*4:43+(x%3)*6;
     g.fillStyle=x<350?'#565266':'#6a6178';g.fillRect(x,68-height,37,height);
     g.fillStyle='#878195';g.fillRect(x+18,56,3,16);
     g.fillStyle=x<350?'#9791aa':'#817d99';g.beginPath();g.arc(x+20,52,x<350?14:6,0,2*Math.PI);g.fill();
   }
   g.strokeStyle=ink;g.lineWidth=3;g.setLineDash([16,10]);g.beginPath();g.moveTo(0,89);g.lineTo(w,89);g.stroke();g.setLineDash([]);
 }
}
function beginProgress(b,ring,signal){
 const dialog=$('analysisProgress'),tabs=dialog.querySelector('.progressDims');
 const sourceTags=[...dialog.querySelectorAll('.progressSources b')];
 const totals=dims.map(()=>({done:0,valid:new Map(),finished:false}));
 let selectedDim=0,pinned=false,total=null,stage='',phase='running',activeDim=-1;
 tabs.replaceChildren();
 const buttons=dims.map((label,i)=>{
   const button=document.createElement('button');
   button.type='button';button.style.setProperty('--progress-ink',color[i]);
   const title=document.createElement('strong'),state=document.createElement('small');
   title.textContent=label;button.append(title,state);tabs.append(button);
   button.onclick=()=>{selectedDim=i;pinned=true;showDimension();paint()};
   return button;
 });
 function showDimension(){
   dialog.style.setProperty('--progress-ink',color[selectedDim]);
   buttons.forEach((btn,i)=>btn.setAttribute('aria-pressed',String(i===selectedDim)));
   $('progressCaption').textContent=dimensionCaptions[selectedDim];
   drawDimension(dialog.querySelector('canvas'),selectedDim);
   const box=$('progressItems');box.replaceChildren();box.scrollTop=0;
   for(const name of indicatorSchema?.[selectedDim]||[]){
     const row=document.createElement('div'),label=document.createElement('span'),value=document.createElement('small');
     label.textContent=name;row.append(label,value);box.append(row);
   }
 }
 function paint(){
   for(const [i,m] of totals.entries()){
     buttons[i].lastChild.textContent=m.finished?'核对完成':phase==='failed'?'未完成':activeDim===i?'计算中':'待计算';
   }
   const m=totals[selectedDim];
   for(const row of $('progressItems').children){
     const n=m.valid.get(row.firstChild.textContent)||0;
     row.lastChild.textContent=m.finished?(total?(n?n+' / '+total+' 段可算':'全部缺测'):'无街段'):m.done?'已核对 '+m.done+' 段，'+n+' 段可算':'待计算';
   }
   const label=stage+(activeDim>=0&&phase==='running'?' · '+totals[activeDim].done+' / '+total+' 段':'');
   if($('progressStage').textContent!==label)$('progressStage').textContent=label;
   const bar=$('progressBar');
   if(total>0){bar.max=total*3;bar.value=totals.reduce((n,m)=>n+m.done,0)}
   else if(phase==='done'){bar.max=1;bar.value=1}else bar.removeAttribute('value');
 }
 function stopOrClose(){
   if(phase==='running'){cancelSelection();return}
   dialog.close();
   if(phase==='done')showResults();
 }
 $('progressAction').onclick=stopOrClose;
 dialog.oncancel=e=>{e.preventDefault();stopOrClose()};
 signal.addEventListener('abort',()=>{if(phase==='running'&&dialog.open)dialog.close()},{once:true});
 $('progressTitle').textContent='正在识别断裂';$('progressAction').textContent='取消分析';
 $('progressArea').textContent=(ring?metricRegion(ring).areaM/1e6:area(b)).toFixed(3)+' km²';
 dialog.dataset.phase=phase;sourceTags.forEach(el=>el.textContent='查询中');
 stage='正在获取选区数据';showDimension();paint();dialog.showModal();buttons[0].focus({preventScroll:true});
 return {
   source(i,label){if(!signal.aborted)sourceTags[i].textContent=label},
   step(event){
     if(event.total!==undefined)total=event.total;
     if(event.stage){stage=event.stage;return}
     if(activeDim!==event.dim){
       activeDim=event.dim;stage='计算'+dims[activeDim]+'指标';
       if(!pinned){selectedDim=activeDim;showDimension()}
     }
     const m=totals[activeDim];m.done=event.processed;
     for(const item of event.evidence?.items||[])if(item.v!==null)m.valid.set(item.label,(m.valid.get(item.label)||0)+1);
     m.finished=m.done===total;
   },
   paint,
   end(success,detail){
     phase=success?'done':'failed';dialog.dataset.phase=phase;stage=detail;
     if(!success)sourceTags.forEach(el=>{if(el.textContent==='查询中')el.textContent='未完成'});
     $('progressTitle').textContent=success?'断裂识别完成':'本次分析未完成';
     $('progressAction').textContent=success?'查看结果':'返回地图';paint();
   }
 };
}
async function buildWithProgress(data,b,ring,panel,signal){
 const steps=modelSteps(data,b,ring);
 let lastPaint=performance.now();
 try{
   while(true){
     signal.throwIfAborted();
     const step=steps.next();
     if(step.done)return step.value;
     const event=step.value;panel.step(event);
     if(event.stage||event.processed===0||event.processed===event.total||performance.now()-lastPaint>=45){
       panel.paint();
       await new Promise(resolve=>setTimeout(resolve,0));
       lastPaint=performance.now();
     }
   }
 }finally{steps.return()}
}
