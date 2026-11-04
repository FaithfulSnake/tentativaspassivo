// Configurações da extensão (guardadas em chrome.storage.local, "config").

export const CONFIG_PADRAO = Object.freeze({
  raiz: 'PASSIVO FEDERAL', // pasta dentro de Downloads
  urlConsulta: 'https://pje1g.trf1.jus.br/pje/Processo/ConsultaProcesso/listView.seam',
  recorte: 'tela', // 'tela' (a tela inteira, como a Ferramentas Fanjas) | 'linha' (só a linha do tempo)
  espera: 1000, // ms depois de cada rolagem
  limitePdf: 300, // s esperando o PJe começar a entregar o PDF
  pausa: 2, // s entre um processo e outro
  fecharAbas: true, // fecha a aba dos autos quando o processo termina
});

// Nome de pasta aceito pelo Windows; "/" separa subpastas.
export function limparCaminho(caminho) {
  return String(caminho ?? '')
    .split(/[\\/]+/)
    .map((p) =>
      p
        .replace(/[\u0000-\u001f<>:"|?*~]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/^[. ]+|[. ]+$/g, ''),
    )
    .filter(Boolean)
    .join('/');
}

export function normalizarConfig(c = {}) {
  const p = CONFIG_PADRAO;
  const numero = (v, min, max, padrao) => {
    const n = Math.round(Number(v));
    return v !== '' && v != null && Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : padrao;
  };
  let url = p.urlConsulta;
  try {
    if (c.urlConsulta && /^https?:$/.test(new URL(c.urlConsulta).protocol)) url = new URL(c.urlConsulta).href;
  } catch {
    // fica a padrão
  }
  return {
    raiz: limparCaminho(c.raiz) || p.raiz,
    urlConsulta: url,
    recorte: c.recorte === 'linha' ? 'linha' : 'tela',
    espera: numero(c.espera, 300, 10000, p.espera),
    limitePdf: numero(c.limitePdf, 30, 3600, p.limitePdf),
    pausa: numero(c.pausa, 0, 120, p.pausa),
    fecharAbas: typeof c.fecharAbas === 'boolean' ? c.fecharAbas : p.fecharAbas,
  };
}
