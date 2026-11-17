async function loadMapDetails() {
  let notice = document.getElementById('mapDetailStatus');
  if (!notice) {
    notice = document.createElement('div');
    notice.id = 'mapDetailStatus';
    notice.setAttribute('role', 'status');
    notice.style.cssText = 'position:absolute;right:16px;top:70px;z-index:800;background:#202129;color:#eee;padding:8px 12px;border-radius:6px;font-size:12px';
    document.getElementById('map').append(notice);
    L.DomEvent.disableClickPropagation(notice);
  }
  notice.textContent = '正在补载道路与底图细节…';
  try {
    const response = await fetch(document.getElementById('atlasBundle').dataset.map, {priority:'low'});
    if (!response.ok) throw Error('HTTP ' + response.status);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const details = JSON.parse(new TextDecoder().decode(fflate.gunzipSync(bytes)));
    LOCAL_BASEMAP.push(...details.basemap);
    Object.assign(NEARBY_CELLS, details.nearby);
    atlas.eachLayer(layer => { if (layer instanceof L.GridLayer) layer.redraw(); });
    notice.remove();
  } catch (error) {
    notice.textContent = '底图细节载入失败 ';
    const retry = document.createElement('button');
    retry.textContent = '重试';
    retry.onclick = loadMapDetails;
    notice.append(retry);
  }
}
