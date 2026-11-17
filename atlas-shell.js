const compactLayout=matchMedia('(max-width:980px)');
function setSidebar(side,visible){
 const left=side==='left',rail=$(left?'rail':'reportRail'),toggle=$(left?'railToggle':'reportToggle');
 const label=left?'地图图层':'分析结果';
 document.body.classList.toggle(left?'railHidden':'reportHidden',!visible);
 rail.inert=!visible;
 toggle.setAttribute('aria-expanded',String(visible));
 toggle.title=(visible?'收起':'展开')+label;
 toggle.setAttribute('aria-label',toggle.title);
 toggle.textContent=visible?(left?'‹':'›'):(compactLayout.matches?label:(left?'›':'‹'));
}
function openSidebar(side){
 if(compactLayout.matches)setSidebar(side==='left'?'right':'left',false);
 setSidebar(side,true);
 atlas.invalidateSize();
}
function showResults(detail=false){
 openSidebar('right');
 const panel=$('reportRail');
 if(detail)panel.querySelector('.details').scrollIntoView({block:'nearest'});else panel.scrollTop=0;
}
function initAtlasShell(){
 function syncSize(){
   setSidebar('left',!compactLayout.matches);setSidebar('right',!compactLayout.matches);
   atlas.invalidateSize();
 }
 syncSize();compactLayout.addEventListener('change',syncSize);
 for(const [button,side] of [['railToggle','left'],['reportToggle','right']]){
   $(button).onclick=()=>{if($(button).getAttribute('aria-expanded')==='true'){setSidebar(side,false);atlas.invalidateSize()}else openSidebar(side)};
 }
 $('scopeLink').onclick=()=>{fit();showResults()};
 $('layers').addEventListener('change',e=>{if(!e.target.closest('[data-layer]'))return;if(atlas.getZoom()<12)fit();});
}
