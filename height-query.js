// Query the packed city raster by UTM cell centres. Heights in the archive use half metres.
const utm51=proj4('EPSG:4326','+proj=utm +zone=51 +datum=WGS84 +units=m +no_defs');
function terrainHeightCells(bbox){
 const corners=[[bbox[0],bbox[1]],[bbox[0],bbox[3]],[bbox[2],bbox[1]],[bbox[2],bbox[3]]].map(p=>utm51.forward(p));
 const xs=corners.map(p=>p[0]),ys=corners.map(p=>p[1]),minX=Math.min(...xs)-240,maxX=Math.max(...xs)+240,minY=Math.min(...ys)-240,maxY=Math.max(...ys)+240;
 const rows=[],seen=new Set();
 for(const [x,y,encoded] of HEIGHT_ATLAS){
   if(x>maxX||x+2560<minX||y<minY||y-2560>maxY)continue;
   const raw=fflate.gunzipSync(bytes64(encoded)),values=new DataView(raw.buffer,raw.byteOffset,raw.byteLength);
   for(let j=Math.max(0,Math.ceil((y-maxY-10)/20));j<=Math.min(127,Math.floor((y-minY-10)/20));j++)
     for(let i=Math.max(0,Math.ceil((minX-x-10)/20));i<=Math.min(127,Math.floor((maxX-x-10)/20));i++){
       const height=values.getUint16(2*(j*128+i),true)/2;if(!height)continue;
       const e=x+10+20*i,n=y-10-20*j,key=Math.round(e/20)+','+Math.round(n/20);if(seen.has(key))continue;seen.add(key);
       rows.push([...xy(...utm51.inverse([e,n])),height]);
     }
 }
 return rows;
}
