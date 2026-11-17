// Load the same archived cells used by the analysis, including its context buffer.
const archiveRequests = new Map(), loadedHeights = new Map();
function loadArchiveCell(name, key) {
  const file = DATA_CELLS[name][key];
  if (!file) return Promise.resolve();
  if (!archiveRequests.has(file)) {
    const request = (async () => {
      const response = await fetch('data/' + file);
      if (!response.ok) throw Error('选区存档加载失败，请重试（' + response.status + '）');
      const bytes = new Uint8Array(await response.arrayBuffer());
      const value = JSON.parse(new TextDecoder().decode(fflate.gunzipSync(bytes)));
      const tables = {DP_TILES, QGIS_BUILDINGS, QGIS_POIS, OUTER_SAMPLES, OUTER_ROADS};
      if (name === 'HEIGHT_ATLAS') loadedHeights.set(key, value);
      else Object.assign(tables[name], value);
    })().catch(error => {
      archiveRequests.delete(file);
      throw error;
    });
    archiveRequests.set(file, request);
  }
  return archiveRequests.get(file);
}
async function ensureLocalData(box, signal) {
  const tasks = [];
  function cells(name, bounds, size) {
    for (let x = Math.floor(bounds[0] / size); x <= Math.floor(bounds[2] / size); x++) {
      for (let y = Math.floor(bounds[1] / size); y <= Math.floor(bounds[3] / size); y++) {
        const key = x + ',' + y;
        if (DATA_CELLS[name][key]) tasks.push(() => loadArchiveCell(name, key));
      }
    }
  }
  const context = analysisContextBounds(box);
  for (const name of ['DP_TILES', 'QGIS_POIS', 'OUTER_SAMPLES', 'OUTER_ROADS']) {
    cells(name, context.map(v => v * 100), 2);
  }
  const corners = [[box[0], box[1]], [box[0], box[3]], [box[2], box[1]], [box[2], box[3]]].map(p => utm51.forward(p));
  const xs = corners.map(p => p[0]), ys = corners.map(p => p[1]);
  const projected = [Math.min(...xs) - 240, Math.min(...ys) - 240, Math.max(...xs) + 240, Math.max(...ys) + 240];
  cells('QGIS_BUILDINGS', projected, 2000);
  for (const key of HEIGHT_ORDER) {
    const [x, y] = key.split(',').map(Number);
    if (x <= projected[2] && x + 2560 >= projected[0] && y >= projected[1] && y - 2560 <= projected[3]) {
      tasks.push(() => loadArchiveCell('HEIGHT_ATLAS', key));
    }
  }
  let cursor = 0;
  await Promise.all(Array.from({length: Math.min(8, tasks.length)}, async () => {
    while (cursor < tasks.length) {
      signal?.throwIfAborted();
      await tasks[cursor++]();
    }
  }));
  signal?.throwIfAborted();
  HEIGHT_ATLAS.splice(0, HEIGHT_ATLAS.length, ...HEIGHT_ORDER.filter(key => loadedHeights.has(key)).map(key => loadedHeights.get(key)));
}
