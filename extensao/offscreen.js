// Documento invisível que monta os arquivos para o service worker salvar:
// recebe o print (data:) ou um texto e devolve um endereço blob: para o download.

// Recorta o print na região escolhida (coordenadas da tela em pixels CSS).
async function recortar(blob, corte, janela) {
  const imagem = await createImageBitmap(blob);
  const escala = janela?.largura ? imagem.width / janela.largura : 1;
  const x = Math.round(corte.x * escala);
  const y = Math.round(corte.y * escala);
  const w = Math.min(imagem.width - x, Math.round(corte.w * escala));
  const h = Math.min(imagem.height - y, Math.round(corte.h * escala));
  const tela = new OffscreenCanvas(w, h);
  tela.getContext('2d').drawImage(imagem, x, y, w, h, 0, 0, w, h);
  imagem.close();
  return tela.convertToBlob({ type: 'image/png' });
}

async function montar(msg) {
  let blob;
  if (msg.dataUrl) {
    blob = await (await fetch(msg.dataUrl)).blob();
    if (msg.recorte) blob = await recortar(blob, msg.recorte, msg.janela);
  } else {
    blob = new Blob([msg.texto ?? ''], { type: msg.mime || 'text/plain;charset=utf-8' });
  }
  return { url: URL.createObjectURL(blob), tamanho: blob.size };
}

chrome.runtime.onMessage.addListener((msg, _remetente, responder) => {
  if (msg?.alvo !== 'offscreen') return false;
  if (msg.tipo === 'revogar') {
    URL.revokeObjectURL(msg.url);
    responder({ ok: true });
    return false;
  }
  if (msg.tipo !== 'blob') return false;
  montar(msg).then(responder, (e) => responder({ erro: String(e?.message || e) }));
  return true;
});
