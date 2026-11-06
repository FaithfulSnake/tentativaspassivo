// Passivo Fanjas: percorre a lista de processos no PJe 1º grau do TRF1, no
// próprio Edge (onde o login já está feito), e monta uma pasta por processo:
//   Downloads/PASSIVO FEDERAL/06 - 0005417-28.2017.4.01.3700/
//       0005417-28.2017.4.01.3700.pdf   (inteiro teor, cronologia crescente)
//       PRINT 01.png, PRINT 02.png...   (prints da linha do tempo, com rolagem)
// A lista fica guardada na extensão e cada processo pronto ganha "ok".
import { capturarComRolagem, esperar } from './captura.js';
import { CONFIG_PADRAO, normalizarConfig } from './config.js';
import { LISTA_INICIAL, lerLista, nomePasta, soDigitos } from './lista.js';

const norm = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

function hostDe(url) {
  try {
    const u = String(url || '');
    return new URL(u.startsWith('blob:') ? u.slice(5) : u).hostname.toLowerCase();
  } catch {
    return '';
  }
}

// Erro que interrompe a rodada inteira (sem login, Edge pedindo onde salvar...).
function parada(mensagem) {
  const e = new Error(mensagem);
  e.pararTudo = true;
  return e;
}

// ------------------------------------------------------------------ estado

// Uma alteração por vez, para uma não apagar a outra.
let fila = Promise.resolve();
function emFila(tarefa) {
  const vez = fila.then(tarefa, tarefa);
  fila = vez.catch(() => {});
  return vez;
}

function itensIniciais(texto) {
  return lerLista(texto).map((i) => ({
    ...i,
    status: i.ok ? 'ok' : 'pendente',
    manual: i.ok,
    detalhe: i.ok ? 'Marcado "(ok)" na lista original (feito à mão). Use "Rodar" se quiser que a extensão monte a pasta.' : '',
    arquivos: [],
  }));
}

async function lerItens() {
  const { lista } = await chrome.storage.local.get('lista');
  return Array.isArray(lista) ? lista : [];
}

async function lerConfig() {
  const { config } = await chrome.storage.local.get('config');
  return normalizarConfig(config);
}

const atualizarItem = (numero, mudancas) =>
  emFila(async () => {
    const lista = await lerItens();
    const item = lista.find((i) => i.numero === numero);
    if (!item) return null;
    Object.assign(item, mudancas);
    await chrome.storage.local.set({ lista });
    return item;
  });

const atualizarExecucao = (mudancas) =>
  emFila(async () => {
    const { execucao } = await chrome.storage.local.get('execucao');
    await chrome.storage.local.set({ execucao: { ...(execucao || {}), ...mudancas } });
  });

// O que está acontecendo agora (aparece no painel). Sem número, só troca o texto.
function etapa(numero, texto) {
  return atualizarExecucao(numero ? { atual: numero, etapa: texto } : { etapa: texto }).catch(() => {});
}

// Ao iniciar o service worker: cria a lista na primeira vez e solta o que
// ficou "rodando" se o navegador foi fechado (ou a extensão recarregada) no meio.
const pronto = emFila(async () => {
  const { lista, execucao } = await chrome.storage.local.get(['lista', 'execucao']);
  if (!Array.isArray(lista)) {
    await chrome.storage.local.set({ lista: itensIniciais(LISTA_INICIAL) });
  } else if (lista.some((i) => i.status === 'rodando')) {
    for (const i of lista) if (i.status === 'rodando') Object.assign(i, { status: 'erro', detalhe: 'Interrompido no meio (o navegador ou a extensão foi fechado). Rode de novo.' });
    await chrome.storage.local.set({ lista });
  }
  if (execucao?.ativo) await chrome.storage.local.set({ execucao: { ...execucao, ativo: false, atual: null, etapa: 'A rodada anterior foi interrompida.' } });
});

// ------------------------------------------------------------------ abas e páginas

async function injetar(tabId, arquivos, todos = false) {
  await chrome.scripting.executeScript({ target: { tabId, allFrames: todos }, files: arquivos });
}

// Chama um método de pje.js na aba (todos = em todos os quadros; devolve a lista).
async function chamar(tabId, metodo, arg = null, { todos = false } = {}) {
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    const resultados = await chrome.scripting.executeScript({
      target: { tabId, allFrames: todos },
      func: (m, a) => (globalThis.__passivoPje ? globalThis.__passivoPje[m](a) : { semApi: true }),
      args: [metodo, arg],
    });
    const valores = resultados.map((r) => r.result).filter((v) => v != null);
    if (valores.some((v) => v.semApi)) {
      await injetar(tabId, ['pje.js'], todos);
      continue;
    }
    return todos ? valores : valores[0];
  }
  throw new Error('a página do PJe não respondeu (ela recarregou no meio?).');
}

// Chama a API de pagina.js (rolagem dos prints) na aba.
async function chamarPagina(tabId, metodo, arg = null) {
  const [r] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (m, a) => (globalThis.__clippingPrints ? globalThis.__clippingPrints[m](a) : { semApi: true }),
    args: [metodo, arg],
  });
  if (r?.result?.semApi) throw new Error('a página dos autos recarregou durante os prints.');
  return r?.result;
}

async function esperarCarregar(tabId, tempo = 60000) {
  const fim = Date.now() + tempo;
  for (;;) {
    const aba = await chrome.tabs.get(tabId);
    if (aba.status === 'complete' && aba.url) return aba;
    if (Date.now() > fim) throw new Error(`a página demorou mais de ${Math.round(tempo / 1000)} s para carregar.`);
    await esperar(400);
  }
}

const ehAbaAutos = (t, numero) => {
  const url = t.url || t.pendingUrl || '';
  if (/ConsultaProcesso\/Detalhe|listProcessoCompleto|listAutosDigitais|ProcessoCompleto/i.test(url)) return true;
  return soDigitos(t.title).includes(soDigitos(numero)) && !/listView/i.test(url) && /^https?:/i.test(url);
};

async function acharAbaAutos(numero, cfg) {
  const host = hostDe(cfg.urlConsulta);
  const d = soDigitos(numero);
  return (await chrome.tabs.query({})).find(
    (t) => hostDe(t.url) === host && soDigitos(t.title).includes(d) && /ConsultaProcesso\/Detalhe|listProcessoCompleto|listAutosDigitais/i.test(t.url),
  );
}

async function acharAbaConsulta(cfg) {
  const alvo = new URL(cfg.urlConsulta);
  const abas = await chrome.tabs.query({});
  return (
    abas.find((t) => {
      try {
        const u = new URL(t.url);
        return u.host === alvo.host && u.pathname === alvo.pathname;
      } catch {
        return false;
      }
    }) || abas.find((t) => hostDe(t.url) === alvo.hostname && /^consulta (de )?processos?/.test(norm(t.title)))
  );
}

function pareceLogin(url, cfg) {
  return hostDe(url) !== hostDe(cfg.urlConsulta) || /login|logon|\/auth|sso\.|acesso.?negado/i.test(url);
}

// O aviso nativo e o window.open da resposta AJAX rodam no mundo da página.
async function aberturaNaConsulta(tabId, metodo, arg = null) {
  const resultados = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    world: 'MAIN',
    func: (m, a) => globalThis.__passivoAbertura?.[m](a),
    args: [metodo, arg],
  });
  return resultados.map((r) => r.result).filter(Boolean);
}

async function esperarAbaAutos(numero, antes, consulta, tempo, antesMsgs) {
  const fim = Date.now() + tempo;
  let confirmou = false;
  while (Date.now() < fim) {
    const abas = await chrome.tabs.query({});
    const nova = abas.find((t) => !antes.has(t.id) && hostDe(t.url || t.pendingUrl) === hostDe(consulta.url) && ehAbaAutos(t, numero));
    if (nova) return { aba: nova };
    const mesma = abas.find((t) => t.id === consulta.id && ehAbaAutos(t, numero));
    if (mesma) return { aba: mesma };
    // Uma navegação ou a troca de um iframe pode destruir o contexto MAIN.
    const estados = await aberturaNaConsulta(consulta.id, 'estado').catch(() => []);
    confirmou ||= estados.some((s) => s.confirmacoes > 0);
    const destino = estados.find((s) => {
      try {
        const u = new URL(s.url);
        return u.origin === new URL(consulta.url).origin && ehAbaAutos({ url: u.href }, numero);
      } catch {
        return false;
      }
    });
    if (destino) {
      const aba = await chrome.tabs.create({ url: destino.url, openerTabId: consulta.id, index: consulta.index + 1, windowId: consulta.windowId, active: true });
      return { aba };
    }
    const msgs = await chamar(consulta.id, 'mensagens').catch(() => []);
    const erro = msgs.find((m) => !antesMsgs.has(m) && /erro|nao foi possivel|acesso negado|sem permissao|sessao expirad/.test(norm(m)));
    if (erro) return { erro: `o PJe respondeu ao abrir o processo: ${erro.slice(0, 300)}` };
    await esperar(300);
  }
  return { erro: confirmou
    ? 'confirmei o aviso de acesso do CNJ, mas o PJe não forneceu o endereço dos autos em 30 s. Salve o diagnóstico da consulta para verificar a resposta do PJe.'
    : 'o clique no resultado não produziu o endereço dos autos nem uma aba do processo em 30 s. Salve o diagnóstico da consulta para verificar a resposta do PJe.' };
}

// Os autos às vezes abrem numa janelinha (pop-up): deixa do tamanho da janela da consulta.
async function ajustarJanela(aba, consulta) {
  if (aba.windowId === consulta.windowId) return;
  try {
    const [nova, base] = await Promise.all([chrome.windows.get(aba.windowId), chrome.windows.get(consulta.windowId)]);
    if (base.state === 'maximized') await chrome.windows.update(nova.id, { state: 'maximized' });
    else if (base.state === 'normal') await chrome.windows.update(nova.id, { state: 'normal', left: base.left, top: base.top, width: base.width, height: base.height });
  } catch {
    // fica como abriu
  }
}

// Abre os autos do processo: usa uma aba já aberta com ele ou faz a consulta
// (cola o número, pesquisa e abre o resultado, como na gravação).
// Devolve { aba, reaproveitada }.
async function abrirAutos(numero, cfg, { reaproveitar = true } = {}) {
  const ja = reaproveitar ? await acharAbaAutos(numero, cfg) : null;
  if (ja) {
    await chrome.tabs.reload(ja.id); // sessão nova da página (a antiga pode ter expirado)
    await esperar(800);
    return { aba: ja, reaproveitada: true };
  }
  let consulta = await acharAbaConsulta(cfg);
  if (!consulta) consulta = await chrome.tabs.create({ url: cfg.urlConsulta, active: true });
  else await chrome.tabs.update(consulta.id, { active: true });
  consulta = await esperarCarregar(consulta.id);
  if (pareceLogin(consulta.url, cfg)) throw parada('O PJe está pedindo login. Entre no PJe neste Edge e clique em "Rodar" de novo.');

  await injetar(consulta.id, ['pje.js'], true);
  const respostas = await chamar(consulta.id, 'pesquisar', { numero, tempo: 45000 }, { todos: true });
  const r = respostas.find((x) => x.ok) || respostas.find((x) => x.erro);
  if (!r) {
    throw new Error(
      `não achei o campo do número do processo na aba "${consulta.title}". Abra a tela "Consulta processos" do PJe numa aba deste Edge (ou confira o endereço da consulta nas configurações) e rode de novo.`,
    );
  }
  if (!r.ok) throw new Error(r.erro);

  // O link do resultado traz o endereço dos autos: abre numa aba ao lado (o
  // bloqueador de pop-ups do Edge não interfere). Sem endereço, clica no link.
  if (r.url) {
    const aba = await chrome.tabs.create({ url: r.url, openerTabId: consulta.id, index: consulta.index + 1, windowId: consulta.windowId, active: true });
    return { aba, reaproveitada: false };
  }
  const antes = new Set((await chrome.tabs.query({})).map((t) => t.id));
  const antesMsgs = new Set(await chamar(consulta.id, 'mensagens').catch(() => []));
  await chrome.scripting.executeScript({ target: { tabId: consulta.id, allFrames: true }, world: 'MAIN', files: ['abertura.js'] });
  try {
    const preparadas = await aberturaNaConsulta(consulta.id, 'preparar', { tempo: 35000 });
    if (!preparadas.some((s) => s.ativo)) throw new Error('não consegui preparar a confirmação do aviso de acesso na consulta do PJe.');
    const cliques = await chamar(consulta.id, 'clicarResultado', { numero }, { todos: true });
    if (!cliques.some((c) => c.ok)) throw new Error(cliques.find((c) => c.erro)?.erro || 'não achei o link deste processo no resultado da consulta.');
    const resultado = await esperarAbaAutos(numero, antes, consulta, 30000, antesMsgs);
    if (!resultado.aba) throw new Error(resultado.erro);
    await ajustarJanela(resultado.aba, consulta);
    return { aba: resultado.aba, reaproveitada: false };
  } finally {
    await aberturaNaConsulta(consulta.id, 'finalizar').catch(() => {});
  }
}

// Abre os autos e espera a página montar. Uma aba antiga que não carrega
// (sessão expirada) é fechada e o processo é aberto de novo pela consulta.
async function abrirEsperarAutos(numero, cfg) {
  for (const reaproveitar of [true, false]) {
    let { aba, reaproveitada } = await abrirAutos(numero, cfg, { reaproveitar });
    await etapa(numero, 'esperando os autos carregarem');
    await trazerParaFrente(aba);
    aba = await esperarCarregar(aba.id);
    if (pareceLogin(aba.url, cfg)) throw parada('O PJe está pedindo login. Entre no PJe neste Edge e clique em "Rodar" de novo.');
    await injetar(aba.id, ['pje.js']);
    const autos = await chamar(aba.id, 'esperarAutos', { numero, tempo: reaproveitada ? 20000 : 60000 });
    if (autos?.ok || (autos?.numeroConfere && !reaproveitada)) return aba;
    if (!reaproveitada) throw new Error(`a aba que abriu não mostra o número ${numero} (título: "${autos?.titulo || aba.title}").`);
    await chrome.tabs.remove(aba.id).catch(() => {});
  }
  throw new Error('não consegui abrir os autos.');
}

// Deixa a aba dos autos na frente (o print só pega a aba visível).
async function trazerParaFrente(aba) {
  await chrome.tabs.update(aba.id, { active: true });
  const janela = await chrome.windows.get(aba.windowId);
  await chrome.windows.update(aba.windowId, janela.state === 'minimized' ? { state: 'normal', focused: true } : { focused: true });
}

async function garantirVisivel(aba) {
  for (let tentativa = 0; tentativa < 240; tentativa++) {
    const t = await chrome.tabs.get(aba.id);
    const janela = await chrome.windows.get(t.windowId);
    let visivel = t.active && janela.state !== 'minimized';
    if (visivel) {
      const [r] = await chrome.scripting.executeScript({ target: { tabId: aba.id }, func: () => document.visibilityState });
      visivel = r?.result === 'visible';
    }
    if (visivel) return;
    if (tentativa % 10 === 0) await trazerParaFrente(t).catch(() => {});
    if (tentativa === 4) etapa(null, 'Esperando a janela do Edge com o PJe ficar visível na tela…');
    await esperar(500);
  }
  throw new Error('a janela do PJe ficou escondida (minimizada ou coberta) e os prints não puderam ser tirados.');
}

// ------------------------------------------------------------------ arquivos

let criandoOffscreen = null;
async function garantirOffscreen() {
  const existe = chrome.offscreen.hasDocument
    ? await chrome.offscreen.hasDocument()
    : (await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })).length > 0;
  if (existe) return;
  criandoOffscreen ??= chrome.offscreen
    .createDocument({ url: 'offscreen.html', reasons: ['BLOBS'], justification: 'Montar os arquivos (prints e lista) antes de salvar na pasta do passivo.' })
    .catch((e) => {
      if (!/single offscreen|already/i.test(String(e?.message))) throw e;
    })
    .finally(() => {
      criandoOffscreen = null;
    });
  await criandoOffscreen;
}

// Endereço blob: de um arquivo montado no documento offscreen (o service
// worker não cria blob: e endereços data: grandes falham no download).
async function criarArquivo(dados) {
  await garantirOffscreen();
  const r = await chrome.runtime.sendMessage({ alvo: 'offscreen', tipo: 'blob', ...dados });
  if (!r?.url) throw new Error(`não consegui montar o arquivo (${r?.erro || 'sem resposta'}).`);
  return r.url;
}

const revogar = (url) => chrome.runtime.sendMessage({ alvo: 'offscreen', tipo: 'revogar', url }).catch(() => {});

// Downloads que a extensão está salvando (url -> caminho) e o PDF que o PJe vai mandar.
const nomesNossos = new Map();
let esperaPdf = null;
let ouvindo = false;

// O nome de cada download é decidido aqui: os da extensão e o PDF do PJe vão
// para a pasta do processo; o resto fica como o navegador quiser.
function decidirNome(item, sugerir) {
  const nosso = nomesNossos.get(item.url) || nomesNossos.get(item.finalUrl);
  if (nosso) {
    sugerir({ filename: nosso, conflictAction: 'overwrite' });
    return;
  }
  if (esperaPdf && esperaPdf.id == null && pareceOPdf(item)) {
    const ext = /\.zip$/i.test(item.filename) || /zip/i.test(item.mime || '') ? 'zip' : 'pdf';
    esperaPdf.id = item.id;
    esperaPdf.caminho = `${esperaPdf.base}/${esperaPdf.numero}.${ext}`;
    esperaPdf.original = item.filename;
    sugerir({ filename: esperaPdf.caminho, conflictAction: 'overwrite' });
    return;
  }
  sugerir();
}

// Só fica ouvindo enquanto precisa, para não mexer nos downloads de outras extensões.
function atualizarOuvinte() {
  const precisa = nomesNossos.size > 0 || Boolean(esperaPdf);
  if (precisa && !ouvindo) chrome.downloads.onDeterminingFilename.addListener(decidirNome);
  else if (!precisa && ouvindo) chrome.downloads.onDeterminingFilename.removeListener(decidirNome);
  ouvindo = precisa;
}

function pareceOPdf(item) {
  const hosts = [item.url, item.finalUrl, item.referrer].map(hostDe).filter(Boolean);
  const doPje = hosts.some((h) => h === esperaPdf.host || /(^|\.)jus\.br$/.test(h));
  const ehArquivo = /pdf|zip|octet-stream/i.test(item.mime || '') || /\.(pdf|zip)$/i.test(item.filename || '');
  const inicio = Date.parse(item.startTime);
  return doPje && ehArquivo && !(inicio < esperaPdf.desde - 5000);
}

const MENSAGEM_PERGUNTA =
  'O Edge está abrindo a janela "Salvar como" para cada arquivo. Desligue "Perguntar onde salvar cada arquivo" em edge://settings/downloads e clique em "Rodar" de novo.';

// Espera o download terminar. Se o Edge abrir "Salvar como", para a rodada.
function esperarDownload(id, tempo) {
  return new Promise((pronto, falha) => {
    let feito = false;
    const terminar = (fn, valor) => {
      if (feito) return;
      feito = true;
      chrome.downloads.onChanged.removeListener(ouvir);
      clearTimeout(limite);
      clearTimeout(vigia);
      fn(valor);
    };
    const ouvir = (d) => {
      if (d.id === id && d.state && d.state.current !== 'in_progress') terminar(pronto, { estado: d.state.current, erro: d.error?.current });
    };
    chrome.downloads.onChanged.addListener(ouvir);
    const limite = setTimeout(() => terminar(falha, new Error('o download demorou demais.')), tempo);
    const vigia = setTimeout(async () => {
      const [d] = await chrome.downloads.search({ id });
      if (d?.state === 'in_progress' && !d.filename) terminar(falha, parada(MENSAGEM_PERGUNTA));
    }, 4000);
    chrome.downloads.search({ id }).then(([d]) => {
      if (d && d.state !== 'in_progress') terminar(pronto, { estado: d.state, erro: d.error });
    });
  });
}

const caminhoConfere = (completo, caminho) =>
  String(completo || '')
    .replace(/\\/g, '/')
    .toLowerCase()
    .endsWith(`/${caminho.toLowerCase()}`);

// Salva url em Downloads/<caminho>, substituindo o que já estiver lá.
async function salvarArquivo(url, caminho, { historico = true } = {}) {
  nomesNossos.set(url, caminho);
  atualizarOuvinte();
  try {
    const id = await chrome.downloads.download({ url, filename: caminho, conflictAction: 'overwrite', saveAs: false });
    const fim = await esperarDownload(id, 10 * 60000);
    if (fim.estado !== 'complete') throw new Error(`o Edge não salvou "${caminho}" (${fim.erro || 'falhou'}).`);
    const [d] = await chrome.downloads.search({ id });
    if (!caminhoConfere(d?.filename, caminho)) {
      throw parada(`O Edge salvou "${d?.filename}" em vez de "…/${caminho}". Outra extensão pode estar trocando o nome dos downloads.`);
    }
    if (!historico) await chrome.downloads.erase({ id });
    return { id, completo: d.filename };
  } finally {
    nomesNossos.delete(url);
    atualizarOuvinte();
  }
}

// Apaga os arquivos de uma rodada anterior do mesmo processo (rodar de novo
// substitui tudo, sem sobrar "PRINT 09" de uma captura mais longa).
async function apagarAnteriores(item) {
  for (const id of item.arquivos || []) {
    try {
      const [d] = await chrome.downloads.search({ id });
      if (d?.exists && d.state === 'complete') await chrome.downloads.removeFile(id);
      await chrome.downloads.erase({ id });
    } catch {
      // já foi apagado
    }
  }
}

// ------------------------------------------------------------------ prints

let ultimaCaptura = 0;
async function capturarTela(windowId) {
  for (let tentativa = 0; ; tentativa++) {
    const falta = ultimaCaptura + 550 - Date.now(); // o Edge aceita 2 capturas por segundo
    if (falta > 0) await esperar(falta);
    ultimaCaptura = Date.now();
    try {
      return await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
    } catch (e) {
      if (tentativa < 5 && /MAX_CAPTURE|quota|invisible|not visible|failed to capture/i.test(String(e?.message))) {
        await esperar(1000);
        continue;
      }
      throw e;
    }
  }
}

async function tirarPrints(aba, base, cfg, numero, arquivos) {
  await trazerParaFrente(aba);
  await injetar(aba.id, ['pagina.js']);
  const marca = await chamar(aba.id, 'marcarLinhaDoTempo');
  await chamar(aba.id, 'iniciarPeriodoDownload');
  const configPagina = { usarEscolhida: false, recorte: { modo: cfg.recorte === 'linha' ? 'area' : 'tela', retangulo: null } };
  let limite = 400;
  let aviso = '';
  if (marca?.achou && marca.rola) {
    const [r] = await chrome.scripting.executeScript({
      target: { tabId: aba.id },
      func: (lembranca) => {
        const api = globalThis.__clippingPrints;
        const area = api?.areaLembrada(lembranca);
        if (area) api.escolherArea(area);
        return Boolean(area);
      },
      args: [marca.lembranca],
    });
    configPagina.usarEscolhida = Boolean(r?.result);
    if (!configPagina.usarEscolhida) aviso = 'linha do tempo não rolou: usada a rolagem automática';
  } else if (marca?.achou) {
    limite = 1; // linha do tempo curta: cabe num print
    if (cfg.recorte === 'linha' && marca.retangulo?.w >= 20 && marca.retangulo?.h >= 20) configPagina.recorte = { modo: 'regiao', retangulo: marca.retangulo };
  } else {
    aviso = 'linha do tempo não identificada: usada a rolagem automática';
  }

  const resultado = await capturarComRolagem({
    opcoes: { limite, espera: cfg.espera, sobreposicao: 10, esconderFixos: true },
    pagina: (metodo, arg) => chamarPagina(aba.id, metodo, arg),
    configPagina,
    antesDoPrint: async () => {
      await garantirVisivel(aba);
      await chamar(aba.id, 'registrarPeriodoDownload');
    },
    tirarPrint: async (medidas, inicio) => ({
      dataUrl: await capturarTela(aba.windowId),
      recorte: inicio?.recorte || null,
      janela: medidas.janela || inicio?.janela,
    }),
    aoCapturar: async (print, n) => {
      const url = await criarArquivo(print);
      try {
        const { id } = await salvarArquivo(url, `${base}/PRINT ${String(n).padStart(2, '0')}.png`);
        arquivos.push(id);
      } finally {
        revogar(url);
      }
      etapa(numero, `print ${n} salvo`);
    },
    deveParar: () => false, // o "Parar" espera o processo atual terminar
  });
  if (resultado.motivo === 'erro') {
    if (resultado.erro?.pararTudo) throw resultado.erro;
    throw new Error(`os prints pararam no meio: ${resultado.erro?.message || resultado.erro}`);
  }
  if (!resultado.total) throw new Error('nenhum print foi tirado.');
  if (resultado.motivo === 'limite' && limite > 1) aviso = `parou no limite de ${limite} prints`;
  return { total: resultado.total, aviso };
}

// ------------------------------------------------------------------ PDF

async function baixarPdf(aba, base, numero, cfg, arquivos) {
  await chrome.tabs.update(aba.id, { active: true });
  const prep = await chamar(aba.id, 'prepararDownload');
  if (!prep?.ok) throw new Error(prep?.erro || 'não consegui abrir o painel de download dos autos.');

  const antesMsgs = new Set(await chamar(aba.id, 'mensagens').catch(() => []));
  const antesAbas = new Set((await chrome.tabs.query({})).map((t) => t.id));
  esperaPdf = { numero, base, host: hostDe((await chrome.tabs.get(aba.id)).url), desde: Date.now(), id: null };
  atualizarOuvinte();
  try {
    const clique = await chamar(aba.id, 'clicarDownload');
    if (!clique?.ok) throw new Error(clique?.erro || 'não consegui clicar em DOWNLOAD.');

    const fim = Date.now() + cfg.limitePdf * 1000;
    let olhada = 0;
    while (esperaPdf.id == null) {
      if (Date.now() > fim) {
        throw new Error(`o PJe não entregou o PDF em ${cfg.limitePdf} s (processo grande? aumente o tempo nas configurações ou baixe à mão).`);
      }
      // PDF aberto numa aba em vez de baixado: salva o endereço dela
      const abaPdf = (await chrome.tabs.query({})).find(
        (t) => !antesAbas.has(t.id) && /^https?:/i.test(t.url || '') && (/\.pdf(\?|#|$)/i.test(t.url) || /\.pdf$/i.test(t.title || '')),
      );
      if (abaPdf) {
        const caminho = `${base}/${numero}.pdf`;
        const { id } = await salvarArquivo(abaPdf.url, caminho);
        arquivos.push(id);
        await chrome.tabs.remove(abaPdf.id).catch(() => {});
        return { nome: `${numero}.pdf`, id };
      }
      if (Date.now() - olhada > 3000) {
        olhada = Date.now();
        const novas = (await chamar(aba.id, 'mensagens').catch(() => [])).filter((m) => !antesMsgs.has(m));
        const texto = novas.join(' | ');
        if (/area de download|disponibilizad|sera enviad|notificad/.test(norm(texto))) {
          throw new Error(`o PJe mandou o PDF para a "Área de download" em vez de baixar na hora ("${texto.slice(0, 200)}"). Baixe por lá e salve na pasta ${base}.`);
        }
        if (/erro|nao foi possivel|falha/.test(norm(texto))) throw new Error(`o PJe mostrou: "${texto.slice(0, 250)}"`);
        if (texto) etapa(numero, `PJe: ${texto.slice(0, 120)}`);
      }
      await esperar(500);
    }
    etapa(numero, 'PDF chegando…');
    const res = await esperarDownload(esperaPdf.id, 30 * 60000);
    if (res.estado !== 'complete') throw new Error(`o download do PDF falhou (${res.erro || 'interrompido'}).`);
    const [d] = await chrome.downloads.search({ id: esperaPdf.id });
    arquivos.push(esperaPdf.id);
    if (!caminhoConfere(d?.filename, esperaPdf.caminho)) {
      throw parada(`O PDF foi salvo em "${d?.filename}" e não em "…/${esperaPdf.caminho}". Outra extensão pode estar trocando o nome dos downloads.`);
    }
    return { nome: esperaPdf.caminho.split('/').pop(), id: esperaPdf.id };
  } finally {
    esperaPdf = null;
    atualizarOuvinte();
  }
}

// ------------------------------------------------------------------ lista em texto

const ROTULOS = { ok: 'OK', pendente: 'PENDENTE', erro: 'ERRO', rodando: 'RODANDO' };
const dataHora = (ms) => (ms ? new Date(ms).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '');

function textoDaLista(lista, cfg) {
  const conta = (s) => lista.filter((i) => i.status === s).length;
  const linhas = [
    `${cfg.raiz} - lista de processos`,
    `Atualizada em: ${dataHora(Date.now())}`,
    `Situação: ${conta('ok')} de ${lista.length} prontos, ${conta('pendente')} pendentes, ${conta('erro')} com erro`,
    '',
  ];
  for (const i of lista) {
    const extra = i.status === 'ok' ? (i.manual ? 'marcado à mão' : `${i.detalhe}${i.quando ? `, ${dataHora(i.quando)}` : ''}`) : i.detalhe;
    linhas.push(`${nomePasta(i)}  [${ROTULOS[i.status] || i.status}]${extra ? ` - ${extra}` : ''}`);
    if (i.descricao) linhas.push(`    ${i.descricao}`);
    if (i.observacao) linhas.push(`    Observação: ${i.observacao}`);
    linhas.push('');
  }
  linhas.push('Gerado pela extensão Passivo Fanjas.');
  return `﻿${linhas.join('\r\n')}\r\n`;
}

// "LISTA DO PASSIVO.txt" na pasta principal, atualizada a cada processo.
async function escreverLista() {
  const cfg = await lerConfig();
  const url = await criarArquivo({ texto: textoDaLista(await lerItens(), cfg), mime: 'text/plain;charset=utf-8' });
  try {
    await salvarArquivo(url, `${cfg.raiz}/LISTA DO PASSIVO.txt`, { historico: false });
  } finally {
    revogar(url);
  }
}

// ------------------------------------------------------------------ rodada

let rodada = null; // { parar }
let vivo = null;

// O service worker é encerrado depois de 30 s parado; chamar a API o mantém vivo
// enquanto a rodada espera o PJe.
function manterVivo(sim) {
  if (sim && !vivo) vivo = setInterval(() => chrome.runtime.getPlatformInfo(), 20000);
  if (!sim && vivo) {
    clearInterval(vivo);
    vivo = null;
  }
}

async function processar(numero) {
  const cfg = await lerConfig();
  const item = (await lerItens()).find((i) => i.numero === numero);
  if (!item) return null;
  const base = `${cfg.raiz}/${nomePasta(item)}`;
  const arquivos = [];
  let interrompeu = false;
  await atualizarItem(numero, { status: 'rodando', detalhe: '', inicio: Date.now() });
  try {
    await etapa(numero, 'abrindo os autos no PJe');
    const aba = await abrirEsperarAutos(numero, cfg);

    await apagarAnteriores(item);
    await atualizarItem(numero, { arquivos: [] });
    await etapa(numero, 'tirando os prints da linha do tempo');
    const prints = await tirarPrints(aba, base, cfg, numero, arquivos);
    await atualizarItem(numero, { arquivos: [...arquivos] });

    await etapa(numero, 'baixando o PDF (inteiro teor)');
    const pdf = await baixarPdf(aba, base, numero, cfg, arquivos);
    const detalhe = `${prints.total} ${prints.total === 1 ? 'print' : 'prints'} + PDF${prints.aviso ? ` (${prints.aviso})` : ''}`;
    await atualizarItem(numero, { status: 'ok', manual: false, detalhe, quando: Date.now(), prints: prints.total, pdf: pdf.nome, pasta: base, arquivos: [...arquivos] });
    if (cfg.fecharAbas) await chrome.tabs.remove(aba.id).catch(() => {});
    return null;
  } catch (e) {
    const msg = e?.message || String(e);
    await atualizarItem(numero, { status: 'erro', detalhe: msg.charAt(0).toUpperCase() + msg.slice(1), quando: Date.now(), arquivos: [...arquivos] });
    interrompeu = Boolean(e?.pararTudo);
    return interrompeu ? { pararTudo: true, mensagem: msg } : null;
  } finally {
    // (com o Edge perguntando onde salvar, a lista abriria mais uma janela)
    if (!interrompeu) await escreverLista().catch(() => {});
  }
}

async function rodar({ numeros } = {}) {
  await pronto;
  if (rodada) return { erro: 'Já tem uma rodada em andamento.' };
  const lista = await lerItens();
  const fila = (numeros?.length ? numeros : lista.filter((i) => i.status !== 'ok').map((i) => i.numero)).filter((n) => lista.some((i) => i.numero === n));
  if (!fila.length) return { erro: 'Nenhum processo pendente para rodar.' };
  rodada = { parar: false };
  manterVivo(true);
  await atualizarExecucao({ ativo: true, inicio: Date.now(), fila, atual: null, etapa: 'Começando…' });
  (async () => {
    let fimTexto = `Terminou: ${fila.length} ${fila.length === 1 ? 'processo' : 'processos'} na rodada.`;
    try {
      for (const [i, numero] of fila.entries()) {
        if (rodada.parar) {
          fimTexto = 'Parado a pedido.';
          break;
        }
        await atualizarExecucao({ atual: numero, fila: fila.slice(i + 1), etapa: '' });
        const r = await processar(numero);
        if (r?.pararTudo) {
          fimTexto = `Rodada interrompida: ${r.mensagem}`;
          break;
        }
        if (i + 1 < fila.length && !rodada.parar) await esperar((await lerConfig()).pausa * 1000);
      }
    } catch (e) {
      fimTexto = `Erro inesperado: ${e?.message || e}`;
    } finally {
      rodada = null;
      manterVivo(false);
      await atualizarExecucao({ ativo: false, atual: null, fila: [], etapa: fimTexto, fim: Date.now() });
    }
  })();
  return { ok: true, total: fila.length };
}

// ------------------------------------------------------------------ painel

async function importar({ texto }) {
  if (rodada) return { erro: 'Espere a rodada terminar (ou pare) antes de trocar a lista.' };
  const novos = itensIniciais(texto);
  if (!novos.length) return { erro: 'Não achei nenhum número de processo no texto colado.' };
  return emFila(async () => {
    const antigos = new Map((await lerItens()).map((i) => [i.numero, i]));
    const lista = novos.map((n) => {
      const a = antigos.get(n.numero);
      if (!a) return n;
      // já estava na lista: mantém a situação e os arquivos; um "(ok)" na lista nova vale
      const marcadoOk = n.ok && a.status !== 'ok' ? { status: 'ok', manual: true, detalhe: n.detalhe } : {};
      return { ...a, ordem: n.ordem, descricao: n.descricao, observacao: n.observacao, ...marcadoOk };
    });
    await chrome.storage.local.set({ lista });
    return { ok: true, total: lista.length };
  });
}

async function marcar({ numero, status }) {
  if (rodada && (await lerItens()).find((i) => i.numero === numero)?.status === 'rodando') return { erro: 'Este processo está rodando agora.' };
  const mudancas = status === 'ok' ? { status: 'ok', manual: true, detalhe: 'Marcado ok à mão.', quando: Date.now() } : { status: 'pendente', manual: false, detalhe: '' };
  await atualizarItem(numero, mudancas);
  escreverLista().catch(() => {});
  return { ok: true };
}

async function abrirPasta({ numero }) {
  const item = (await lerItens()).find((i) => i.numero === numero);
  for (const id of [...(item?.arquivos || [])].reverse()) {
    const [d] = await chrome.downloads.search({ id });
    if (d?.exists) {
      chrome.downloads.show(id);
      return { ok: true };
    }
  }
  return { erro: 'Este processo ainda não tem arquivos salvos pela extensão.' };
}

// Salva o HTML das abas do PJe abertas (para ajustar a extensão se o PJe mudar a tela).
async function diagnostico() {
  const cfg = await lerConfig();
  const host = hostDe(cfg.urlConsulta);
  const abas = (await chrome.tabs.query({})).filter((t) => hostDe(t.url) === host);
  if (!abas.length) return { erro: 'Nenhuma aba do PJe aberta. Abra a tela que deu problema e tente de novo.' };
  const partes = [`Diagnóstico Passivo Fanjas - ${new Date().toLocaleString('pt-BR')}`, `Edge: ${navigator.userAgent}`, ''];
  for (const aba of abas) {
    partes.push('='.repeat(100), `ABA: ${aba.title}`, `ENDEREÇO: ${aba.url}`);
    try {
      const quadros = await chrome.scripting.executeScript({
        target: { tabId: aba.id, allFrames: true },
        func: () => ({ url: location.href, html: document.documentElement.outerHTML }),
      });
      for (const q of quadros) partes.push('-'.repeat(100), `QUADRO: ${q.result?.url}`, q.result?.html || '');
    } catch (e) {
      partes.push(`(não deu para ler: ${e.message})`);
    }
  }
  const nome = `diagnostico-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.txt`;
  const url = await criarArquivo({ texto: partes.join('\n'), mime: 'text/plain;charset=utf-8' });
  try {
    const { id } = await salvarArquivo(url, `${cfg.raiz}/_diagnostico/${nome}`);
    chrome.downloads.show(id);
    return { ok: true, nome };
  } finally {
    revogar(url);
  }
}

const ACOES = {
  rodar,
  parar: async () => {
    if (!rodada) return { erro: 'Nada rodando.' };
    rodada.parar = true;
    await atualizarExecucao({ etapa: 'Vai parar quando o processo atual terminar…' });
    return { ok: true };
  },
  marcar,
  importar,
  abrirPasta,
  diagnostico,
  salvarConfig: async ({ config }) => {
    await chrome.storage.local.set({ config: normalizarConfig(config) });
    return { ok: true };
  },
  restaurarConfig: async () => {
    await chrome.storage.local.set({ config: { ...CONFIG_PADRAO } });
    return { ok: true };
  },
};

chrome.runtime.onMessage.addListener((msg, _remetente, responder) => {
  const acao = msg?.alvo === 'fundo' && ACOES[msg.tipo];
  if (!acao) return false;
  pronto
    .then(() => acao(msg))
    .then(responder, (e) => responder({ erro: e?.message || String(e) }));
  return true;
});

// Clique no ícone: abre (ou mostra) o painel.
chrome.action.onClicked.addListener(async () => {
  const url = chrome.runtime.getURL('painel.html');
  const aba = (await chrome.tabs.query({})).find((t) => t.url?.startsWith(url));
  if (aba) {
    await chrome.tabs.update(aba.id, { active: true });
    await chrome.windows.update(aba.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url });
  }
});
