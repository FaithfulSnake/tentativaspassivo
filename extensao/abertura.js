// Injetado no mundo MAIN da consulta: o confirm da resposta AJAX do PJe
// pertence à página, não ao mundo isolado em que pje.js roda.
(() => {
  if (globalThis.__passivoAbertura) return;
  let sessao = null;
  let timer = null;
  let confirmOriginal;
  let openOriginal;
  let confirmar;
  let abrir;
  const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

  function avisoDeAcesso(texto) {
    const t = norm(texto);
    return /cnj\b.{0,20}\b121\b/.test(t) && /0000547-84\.2011\.2\.00\.0000/.test(t)
      && /acesso aos autos/.test(t) && /sera registrado/.test(t) && /continuar/.test(t);
  }

  function urlDosAutos(valor) {
    try {
      const u = new URL(String(valor), location.href);
      return u.origin === location.origin && /^https?:$/.test(u.protocol)
        && /\/Processo\/ConsultaProcesso\/Detalhe\/|\/listProcessoCompleto|\/listAutosDigitais/i.test(u.pathname) ? u.href : null;
    } catch {
      return null;
    }
  }

  function finalizar() {
    clearTimeout(timer);
    if (window.confirm === confirmar) window.confirm = confirmOriginal;
    if (window.open === abrir) window.open = openOriginal;
    if (sessao) sessao.ativo = false;
  }

  globalThis.__passivoAbertura = Object.freeze({
    preparar({ tempo = 30000 } = {}) {
      finalizar();
      sessao = { ativo: true, confirmacoes: 0, url: null, erro: null };
      confirmOriginal = window.confirm;
      openOriginal = window.open;
      confirmar = function (texto) {
        // O usuário autorizou este OK. Demais confirmações continuam nativas.
        if (sessao.ativo && avisoDeAcesso(texto)) {
          sessao.confirmacoes++;
          return true;
        }
        return confirmOriginal.apply(this, arguments);
      };
      abrir = function (url) {
        const destino = sessao.ativo && urlDosAutos(url);
        if (destino) {
          // A chave de acesso veio da resposta atual do PJe. O background
          // abre a aba por chrome.tabs, sem depender de gesto no callback AJAX.
          sessao.url = destino;
          return null;
        }
        return openOriginal.apply(this, arguments);
      };
      window.confirm = confirmar;
      window.open = abrir;
      timer = setTimeout(finalizar, Math.min(60000, Math.max(1000, Number(tempo) || 30000)));
      return { ...sessao };
    },
    estado: () => sessao ? { ...sessao } : { ativo: false, confirmacoes: 0, url: null, erro: null },
    finalizar,
  });
})();
