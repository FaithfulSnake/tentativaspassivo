// Reproduz a consulta em seis campos e a abertura AJAX do PJe entre mundos JS.
// Não instala extensão nem depende de login ou de dados reais de processos.
//   CHROME=/usr/lib/chromium/chromium node teste/teste-abertura.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const CHROME = process.env.CHROME || '/usr/lib/chromium/chromium';
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const perfil = fs.mkdtempSync(path.join(os.tmpdir(), 'passivo-abertura-'));
const AVISO = 'Conforme a Resolução CNJ nº 121 e o PCA 0000547-84.2011.2.00.0000, o acesso aos autos será registrado. Deseja continuar?';
const NUMEROS = ['0000001-01.2024.4.01.0001', '0000002-02.2023.4.01.0002', '0000003-03.2022.4.01.0003'];
const URL_CONSULTA = '/pje/Processo/ConsultaProcesso/listView.seam';
const URL_AUTOS = '/pje/Processo/ConsultaProcesso/Detalhe/listProcessoCompletoAdvogado.seam';
const pedidos = [];
let chave = 0;

function pagina() {
  return `<!doctype html><html><meta charset="utf-8"><title>Consulta processos</title><body>
    <h1>Consulta processos</h1>
    <form id="fPP" onsubmit="return false">
      <label>Número do processo
        <input id="fPP:numeroSequencial" name="numeroSequencial" type="text">
        <input id="fPP:numeroDigitoVerificador" name="numeroDigitoVerificador" type="text">
        <input id="fPP:Ano" name="Ano" type="text">
        <input id="fPP:ramoJustica" name="ramoJustica" type="text">
        <input id="fPP:respectivoTribunal" name="respectivoTribunal" type="text">
        <input id="fPP:NumeroOrgaoJustica" name="NumeroOrgaoJustica" type="text">
      </label>
      <input type="button" value="PESQUISAR" onclick="pesquisar()">
    </form><div id="resultado"></div>
    <script>
      globalThis.consultas = [];
      globalThis.confirmacoesNativas = [];
      globalThis.aberturasNativas = [];
      globalThis.confirmOriginal = window.confirm = function(texto) {
        confirmacoesNativas.push(String(texto)); return false;
      };
      globalThis.openOriginal = window.open = function(...args) {
        aberturasNativas.push(args); return 'abertura-nativa';
      };
      const numeroDigitado = () => [...document.querySelectorAll('#fPP input[type=text]')].map(i => i.value).join('');
      async function pesquisar() {
        const numero = numeroDigitado(); consultas.push(numero);
        const r = await (await fetch('/buscar?numero=' + numero)).json();
        // Mantém o resultado anterior durante o AJAX, como numa consulta já usada.
        setTimeout(() => {
          const a = document.createElement('a');
          a.href='#'; a.textContent=r.numero;
          a.setAttribute('onclick', "A4J.AJAX.Submit('fPP', event, {'actionUrl':'${URL_CONSULTA}?javax.portlet.faces.DirectLink=true'}); return false;");
          document.getElementById('resultado').replaceChildren(a);
        }, 150);
      }
      globalThis.A4J = {AJAX:{Submit: async function() {
        const codigo = await (await fetch('/abrir?numero=' + numeroDigitado())).text();
        const script = document.createElement('script');
        script.textContent=codigo; document.body.append(script); script.remove();
      }}};
    </script></body></html>`;
}

const servidor = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://simulador');
  if (url.pathname === URL_CONSULTA) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(pagina());
  }
  const numero = NUMEROS.find((n) => n.replace(/\D/g, '') === url.searchParams.get('numero'));
  if (url.pathname === '/buscar') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ numero: numero || 'Processo inexistente' }));
  }
  if (url.pathname === '/abrir') {
    if (!numero) { res.writeHead(404); return res.end(''); }
    const autos = `${URL_AUTOS}?id=${NUMEROS.indexOf(numero) + 1}&ca=ficticia-${++chave}`;
    pedidos.push({ numero, autos });
    res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
    return res.end(`setTimeout(() => { if (window.confirm(${JSON.stringify(AVISO)})) { window.open(${JSON.stringify(autos)}, '_blank'); } }, 150);`);
  }
  res.writeHead(404); res.end('não encontrado');
});

class Cdp {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.n = 0;
    this.pendentes = new Map();
    this.aberto = new Promise((r, f) => { this.ws.onopen = r; this.ws.onerror = f; });
    this.ws.onmessage = ({ data }) => {
      const m = JSON.parse(data);
      const p = this.pendentes.get(m.id);
      if (!p) return;
      this.pendentes.delete(m.id); clearTimeout(p.timer);
      if (m.error) p.f(new Error(m.error.message)); else p.r(m.result);
    };
  }
  async send(method, params = {}) {
    await this.aberto;
    const id = ++this.n;
    return new Promise((r, f) => {
      const timer = setTimeout(() => { this.pendentes.delete(id); f(new Error(`DevTools não respondeu: ${method}`)); }, 20000);
      this.pendentes.set(id, { r, f, timer });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async avaliar(expression, contextId) {
    const r = await this.send('Runtime.evaluate', { expression, contextId, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  }
  fechar() {
    for (const { timer } of this.pendentes.values()) clearTimeout(timer);
    this.ws.close();
  }
}

let navegador;
let cdp;
let log = '';
let erroNavegador;
let passou = 0;
const conferir = (texto) => { passou++; console.log(`ok ${texto}`); };
try {
  await new Promise((r, f) => { servidor.once('error', f); servidor.listen(0, '127.0.0.1', r); });
  navegador = spawn(CHROME, [
    '--headless=new', '--no-sandbox', `--user-data-dir=${perfil}`,
    '--remote-debugging-port=0', '--window-size=1400,900',
    '--no-first-run', '--no-default-browser-check', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  navegador.on('error', (e) => { erroNavegador = e; });
  navegador.stderr.on('data', (d) => { log += d; });
  let portaCdp;
  for (let i = 0; i < 100; i++) {
    if (erroNavegador) throw erroNavegador;
    try { portaCdp = fs.readFileSync(path.join(perfil, 'DevToolsActivePort'), 'utf8').split('\n')[0]; break; }
    catch { await esperar(100); }
  }
  if (!portaCdp) throw new Error(`O Chromium não abriu: ${log}`);
  const alvo = await (await fetch(`http://127.0.0.1:${portaCdp}/json/new?about:blank`, { method: 'PUT' })).json();
  cdp = new Cdp(alvo.webSocketDebuggerUrl);
  const origem = `http://127.0.0.1:${servidor.address().port}`;
  await cdp.send('Page.navigate', { url: origem + URL_CONSULTA });
  for (let i = 0; i < 100; i++) {
    if (await cdp.avaliar('document.readyState === "complete" && typeof openOriginal === "function"')) break;
    if (i === 99) throw new Error('A consulta simulada não carregou.');
    await esperar(100);
  }
  const { frameTree } = await cdp.send('Page.getFrameTree');
  const { executionContextId } = await cdp.send('Page.createIsolatedWorld', { frameId: frameTree.frame.id, worldName: 'passivo-teste' });
  const isolado = (expr) => cdp.avaliar(expr, executionContextId);
  const main = (expr) => cdp.avaliar(expr);
  const abertura = (metodo, arg) => main(`__passivoAbertura.${metodo}(${JSON.stringify(arg ?? {})})`);
  const pje = (metodo, arg) => isolado(`__passivoPje.${metodo}(${JSON.stringify(arg ?? {})})`);
  await isolado(fs.readFileSync(path.join(aqui, '../extensao/pje.js'), 'utf8'));
  await isolado('globalThis.confirmacoesIsoladas=0; window.confirm=() => { confirmacoesIsoladas++; return true; };');
  await main(fs.readFileSync(path.join(aqui, '../extensao/abertura.js'), 'utf8'));
  assert.equal(await main('typeof globalThis.__passivoPje'), 'undefined');
  assert.equal(await isolado('typeof globalThis.__passivoAbertura'), 'undefined');
  assert.equal(await main(`window.confirm(${JSON.stringify(AVISO)})`), false);
  assert.equal(await isolado('confirmacoesIsoladas'), 0);
  assert.equal(await main('confirmacoesNativas.length'), 1);
  conferir('mundos MAIN e isolado são distintos; sem preparar, confirmação continua original');

  for (const numero of NUMEROS) {
    const busca = await pje('pesquisar', { numero, tempo: 5000 });
    assert.equal(busca.ok, true, busca.erro);
    assert.equal(busca.url, null, 'URL de consulta AJAX não pode ser usada como URL dos autos');
    assert.equal(await main('document.querySelector("#resultado a").textContent'), numero);
    assert.equal(await main('consultas.at(-1)'), numero.replace(/\D/g, ''));
    await abertura('preparar', { tempo: 5000 });
    assert.equal((await abertura('estado')).ativo, true);
    assert.equal((await pje('clicarResultado', { numero })).ok, true);
    let estado;
    for (let i = 0; i < 100; i++) {
      estado = await abertura('estado');
      if (estado.url || estado.erro) break;
      await esperar(50);
    }
    assert.equal(estado.erro, null);
    assert.equal(estado.url, origem + pedidos.at(-1).autos);
    assert.equal(estado.confirmacoes, 1);
    assert.equal(await main('aberturasNativas.length'), 0);
    assert.equal(await main('confirmacoesNativas.length'), 1);
    assert.equal(await isolado('confirmacoesIsoladas'), 0);
    await abertura('finalizar');
    assert.equal(await main('window.confirm === confirmOriginal && window.open === openOriginal'), true);
  }
  assert.equal(pedidos.length, NUMEROS.length);
  assert.equal(new Set(pedidos.map((p) => p.autos)).size, NUMEROS.length);
  conferir('três consultas seguidas em seis campos aguardam resultado e capturam URL AJAX com chave nova');

  await abertura('preparar', { tempo: 5000 });
  const avisosIgnorados = [
    'Deseja excluir o processo?',
    AVISO.replace('0000547-84.2011.2.00.0000', '0000547-84.2017.2.00.0000'),
    AVISO.replace('o acesso aos autos será registrado.', 'o documento será apagado.'),
  ];
  for (const aviso of avisosIgnorados) assert.equal(await main(`window.confirm(${JSON.stringify(aviso)})`), false);
  assert.equal((await abertura('estado')).confirmacoes, 0);
  assert.equal(await main('confirmacoesNativas.length'), 1 + avisosIgnorados.length);
  assert.equal(await main(`window.confirm(${JSON.stringify(AVISO)})`), true);
  assert.equal((await abertura('estado')).confirmacoes, 1);
  conferir('somente o aviso CNJ 121/PCA informado é confirmado automaticamente');

  assert.equal(await main(`window.open('/relatorio.pdf','outra')`), 'abertura-nativa');
  assert.equal(await main(`window.open('https://example.invalid${URL_AUTOS}?id=1&ca=ficticia','_blank')`), 'abertura-nativa');
  assert.equal((await abertura('estado')).url, null);
  assert.equal(await main('aberturasNativas.length'), 2);
  assert.equal(await main(`window.open('${URL_AUTOS}?id=99&ca=ficticia-final','_blank')`), null);
  assert.equal((await abertura('estado')).url, origem + URL_AUTOS + '?id=99&ca=ficticia-final');
  assert.equal(await main('aberturasNativas.length'), 2);
  await abertura('finalizar');
  conferir('captura somente autos da mesma origem e delega outras janelas ao open original');

  await abertura('preparar', { tempo: 1000 });
  assert.equal((await abertura('estado')).url, null);
  assert.equal((await abertura('estado')).confirmacoes, 0);
  for (let i = 0; i < 100 && (await abertura('estado')).ativo; i++) await esperar(50);
  assert.equal((await abertura('estado')).ativo, false);
  assert.equal(await main('window.confirm === confirmOriginal && window.open === openOriginal'), true);
  assert.equal(await main(`window.confirm(${JSON.stringify(AVISO)})`), false);
  conferir('timeout restaura funções e uma rodada nova não herda URL nem confirmações');
  console.log(`\n${passou} cenários passaram.`);
} finally {
  cdp?.fechar();
  if (navegador && navegador.exitCode === null && !erroNavegador) {
    const terminou = once(navegador, 'exit'); navegador.kill(); await terminou;
  }
  if (servidor.listening) await new Promise((r) => servidor.close(r));
  fs.rmSync(perfil, { recursive: true, force: true });
}
