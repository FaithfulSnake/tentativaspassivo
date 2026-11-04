// Painel: mostra a lista, a situação de cada processo e o que está rodando.
// Quem muda a lista é o service worker (background.js); aqui só pedimos e mostramos.
import { CONFIG_PADRAO, normalizarConfig } from './config.js';
import { nomePasta } from './lista.js';

const $ = (id) => document.getElementById(id);
let lista = [];
let execucao = {};
let config = { ...CONFIG_PADRAO };

const ROTULOS = { ok: 'OK', pendente: 'Pendente', erro: 'Erro', rodando: 'Rodando' };

async function pedir(tipo, dados = {}) {
  try {
    const r = await chrome.runtime.sendMessage({ alvo: 'fundo', tipo, ...dados });
    if (r?.erro) avisar(r.erro);
    return r;
  } catch (e) {
    avisar(e?.message || String(e));
    return null;
  }
}

let avisoTimer = null;
function avisar(texto, tipo = 'erro') {
  const el = $('aviso');
  el.textContent = texto;
  el.dataset.tipo = tipo;
  el.hidden = !texto;
  clearTimeout(avisoTimer);
  if (texto) avisoTimer = setTimeout(() => (el.hidden = true), 12000);
}

function desenharContagem() {
  const conta = (s) => lista.filter((i) => i.status === s).length;
  const partes = [
    ['ok', `${conta('ok')} de ${lista.length} ok`],
    ['pendente', `${conta('pendente')} pendentes`],
    ['erro', `${conta('erro')} com erro`],
  ];
  $('contagem').replaceChildren(
    ...partes.map(([s, t]) => Object.assign(document.createElement('span'), { className: `chip ${s}`, textContent: t })),
    Object.assign(document.createElement('span'), { className: 'destino', textContent: `Pasta: Downloads/${config.raiz}` }),
  );
}

function desenharExecucao() {
  const ativo = Boolean(execucao.ativo);
  $('rodar').disabled = ativo;
  $('parar').hidden = !ativo;
  const item = lista.find((i) => i.numero === execucao.atual);
  let texto = execucao.etapa || '';
  if (ativo && item) texto = `${nomePasta(item)} — ${texto || 'trabalhando…'}`;
  if (ativo && execucao.fila?.length) texto += ` · faltam mais ${execucao.fila.length}`;
  $('etapa').textContent = texto;
  $('etapa').classList.toggle('ativo', ativo);
}

function desenharLinhas() {
  const modelo = $('modelo-linha').content;
  const ativo = Boolean(execucao.ativo);
  const linhas = lista.map((item) => {
    const tr = modelo.firstElementChild.cloneNode(true);
    tr.dataset.status = item.status;
    tr.querySelector('.num').textContent = String(item.ordem).padStart(2, '0');
    const numero = tr.querySelector('.numero');
    numero.textContent = item.numero;
    numero.addEventListener('click', async () => {
      await navigator.clipboard.writeText(item.numero).catch(() => {});
      avisar(`Número ${item.numero} copiado.`, 'ok');
    });
    tr.querySelector('.descricao').textContent = item.descricao || '';
    const obs = tr.querySelector('.observacao');
    obs.textContent = item.observacao ? `Observação: ${item.observacao}` : '';
    obs.hidden = !item.observacao;
    const selo = tr.querySelector('.selo');
    selo.textContent = ROTULOS[item.status] || item.status;
    selo.className = `selo ${item.status}`;
    tr.querySelector('.detalhe').textContent = item.detalhe || '';

    const rodar = tr.querySelector('.rodar-um');
    rodar.textContent = item.status === 'ok' ? 'Refazer' : 'Rodar';
    rodar.disabled = ativo;
    rodar.title = item.status === 'ok' ? 'Baixar de novo e montar a pasta (substitui os arquivos da extensão)' : 'Rodar só este processo';
    rodar.addEventListener('click', () => {
      if (item.status === 'ok' && !confirm(`Refazer ${item.numero}? Os prints e o PDF da pasta ${nomePasta(item)} serão baixados de novo.`)) return;
      pedir('rodar', { numeros: [item.numero] });
    });

    const marcar = tr.querySelector('.marcar-ok');
    marcar.textContent = item.status === 'ok' ? 'Desmarcar' : 'Marcar ok';
    marcar.disabled = item.status === 'rodando';
    marcar.addEventListener('click', () => pedir('marcar', { numero: item.numero, status: item.status === 'ok' ? 'pendente' : 'ok' }));

    const pasta = tr.querySelector('.pasta');
    pasta.disabled = !item.arquivos?.length;
    pasta.title = item.arquivos?.length ? 'Mostrar a pasta do processo no Explorador de Arquivos' : 'Ainda sem arquivos salvos pela extensão';
    pasta.addEventListener('click', () => pedir('abrirPasta', { numero: item.numero }));
    return tr;
  });
  $('linhas').replaceChildren(...linhas);
}

function desenharConfig() {
  const f = $('config');
  f.raiz.value = config.raiz;
  f.urlConsulta.value = config.urlConsulta;
  f.recorte.value = config.recorte;
  f.espera.value = config.espera;
  f.limitePdf.value = config.limitePdf;
  f.pausa.value = config.pausa;
  f.fecharAbas.checked = config.fecharAbas;
}

function desenhar() {
  desenharContagem();
  desenharExecucao();
  desenharLinhas();
}

async function carregar() {
  const dados = await chrome.storage.local.get(['lista', 'execucao', 'config']);
  lista = Array.isArray(dados.lista) ? dados.lista : [];
  execucao = dados.execucao || {};
  config = normalizarConfig(dados.config);
  desenhar();
  desenharConfig();
}

chrome.storage.onChanged.addListener((mudou, area) => {
  if (area !== 'local') return;
  if (mudou.lista) lista = mudou.lista.newValue || [];
  if (mudou.execucao) execucao = mudou.execucao.newValue || {};
  if (mudou.config) {
    config = normalizarConfig(mudou.config.newValue);
    desenharConfig();
  }
  desenhar();
});

$('rodar').addEventListener('click', async () => {
  const pendentes = lista.filter((i) => i.status !== 'ok').length;
  if (!pendentes) {
    avisar('Todos os processos já estão ok. Use "Refazer" num processo para baixar de novo.', 'ok');
    return;
  }
  const r = await pedir('rodar');
  if (r?.ok) avisar(`Rodando ${r.total} ${r.total === 1 ? 'processo' : 'processos'}. Deixe a janela do Edge com o PJe visível na tela.`, 'ok');
});
$('parar').addEventListener('click', () => pedir('parar'));

$('config').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const f = ev.target;
  const r = await pedir('salvarConfig', {
    config: {
      raiz: f.raiz.value,
      urlConsulta: f.urlConsulta.value,
      recorte: f.recorte.value,
      espera: f.espera.value,
      limitePdf: f.limitePdf.value,
      pausa: f.pausa.value,
      fecharAbas: f.fecharAbas.checked,
    },
  });
  if (r?.ok) avisar('Configurações salvas.', 'ok');
});
$('padrao').addEventListener('click', async () => {
  if ((await pedir('restaurarConfig'))?.ok) avisar('Configurações de volta ao padrão.', 'ok');
});

$('importar').addEventListener('click', async () => {
  const texto = $('texto-lista').value;
  if (!texto.trim()) return;
  if (!confirm('Trocar a lista de processos por esta?')) return;
  const r = await pedir('importar', { texto });
  if (r?.ok) {
    $('texto-lista').value = '';
    avisar(`Lista trocada: ${r.total} processos.`, 'ok');
  }
});

$('diagnostico').addEventListener('click', async () => {
  const r = await pedir('diagnostico');
  if (r?.ok) avisar(`Diagnóstico salvo: ${r.nome}`, 'ok');
});

carregar();
