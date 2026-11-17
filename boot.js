function setBootStatus(message) {
  document.getElementById('bootStatus').textContent = message;
}
function showBootError(error) {
  setBootStatus('载入未完成：' + error.message);
  document.getElementById('bootRetry').hidden = false;
}
document.getElementById('bootRetry').onclick = () => location.reload();
(async () => {
  try {
    const asset = document.getElementById('atlasBundle').dataset.src;
    const response = await fetch(asset);
    if (!response.ok) throw Error('页面资源请求失败（' + response.status + '）');
    const total = Number(response.headers.get('content-length'));
    const chunks = [], reader = response.body.getReader();
    let downloaded = 0;
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      chunks.push(value);
      downloaded += value.byteLength;
      const detail = total ? Math.min(100, Math.round(downloaded / total * 100)) + '%' : (downloaded / 1048576).toFixed(1) + ' MB';
      setBootStatus('正在载入地图与分析程序 · ' + detail);
    }
    setBootStatus('正在初始化地图');
    const bytes = new Uint8Array(downloaded);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const script = document.createElement('script');
    script.textContent = new TextDecoder().decode(fflate.gunzipSync(bytes));
    const onError = event => showBootError(event.error || Error(event.message));
    window.addEventListener('error', onError);
    document.head.append(script);
    window.removeEventListener('error', onError);
    script.remove();
  } catch (error) {
    showBootError(error);
  }
})();
