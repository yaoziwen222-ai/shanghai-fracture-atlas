function dianpingShops(pad) {
  const [west,south]=lonlat(pad[0],pad[1]), [east,north]=lonlat(pad[2],pad[3]);
  const points=[], decoder=new TextDecoder();
  for(let i=Math.floor(west*100);i<=Math.floor(east*100);i++){
    for(let j=Math.floor(south*100);j<=Math.floor(north*100);j++){
      const packed=DP_TILES[i+','+j];
      if(!packed)continue;
      const rows=JSON.parse(decoder.decode(fflate.gunzipSync(bytes64(packed))));
      for(const [x,y,category,name,id,price] of rows){
        const p=xy((i*10000+x)/1e6,(j*10000+y)/1e6);
        if(inside(p,pad))points.push([...p,DP_CATEGORIES[category],name,id,price||null,'dp']);
      }
    }
  }
  return points;
}

function shopNames(text) {
  const clean=s=>s.replace(/[\s\p{P}\p{S}]/gu,'');
  const name=text.normalize('NFKC').trim().toLowerCase();
  const base=name.replace(/\s*\([^()]*店\)\s*$/u,'');
  return {full:clean(name),base:clean(base)};
}

function mergeShopSources(osm,shops) {
  const byName=new Map(), exact=[], partial=[];
  for(const shop of shops){
    const keys=shopNames(shop[3]);
    if(!keys.base)continue;
    if(!byName.has(keys.base))byName.set(keys.base,[]);
    byName.get(keys.base).push({shop,full:keys.full});
  }
  for(const point of osm){
    const options=new Map();
    for(const alias of [point[3],...(point[7]||[])]){
      const keys=shopNames(alias);
      for(const {shop,full} of byName.get(keys.base)||[]){
        const d=distance(point,shop);
        if(d>25)continue;
        const same=keys.full===full;
        // Two explicit, different branch names must remain separate.
        if(!same&&(keys.full!==keys.base&&full!==keys.base))continue;
        if(!same&&point[2]!==shop[2])continue;
        if(!options.has(shop)||same)options.set(shop,{point,shop,d,same});
      }
    }
    const unique=[...options.values()];
    for(const match of unique.filter(m=>m.same))exact.push(match);
    if(unique.length===1&&!unique[0].same)partial.push(unique[0]);
  }
  const used=new Set(),taken=new Set();
  const byDistance=(a,b)=>a.d-b.d||String(a.shop[4]).localeCompare(String(b.shop[4]));
  for(const {point,shop} of [...exact.sort(byDistance),...partial.sort(byDistance)]){
    if(used.has(point)||taken.has(shop))continue;
    used.add(point);taken.add(shop);shop[6]='both';
  }
  return osm.filter(p=>!used.has(p)).concat(shops);
}
