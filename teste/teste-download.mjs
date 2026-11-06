// Testa o preenchimento do download em um navegador real, sem instalar a extensão.
//   CHROME=/usr/lib/chromium/chromium node teste/teste-download.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { iniciar } from './mock-pje.mjs';
import { capturarComRolagem } from '../extensao/captura.js';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const CHROME = process.env.CHROME || '/usr/lib/chromium/chromium';
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const perfil = fs.mkdtempSync(path.join(os.tmpdir(), 'passivo-download-'));
const codigoPje = fs.readFileSync(path.join(aqui, '../extensao/pje.js'), 'utf8');

class Cdp {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.n = 0;
    this.pendentes = new Map();
    this.aberto = new Promise((r, f) => {
      this.ws.onopen = r;
      this.ws.onerror = f;
    });
    this.ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      const p = this.pendentes.get(m.id);
      if (!p) return;
      this.pendentes.delete(m.id);
      clearTimeout(p.timer);
      if (m.error) p.f(new Error(m.error.message));
      else p.r(m.result);
    };
  }
  async send(method, params = {}) {
    await this.aberto;
    const id = ++this.n;
    return new Promise((r, f) => {
      const timer = setTimeout(() => {
        this.pendentes.delete(id);
        f(new Error(`DevTools não respondeu: ${method}`));
      }, 20000);
      this.pendentes.set(id, { r, f, timer });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async avaliar(expression) {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  }
  fechar() {
    for (const { timer } of this.pendentes.values()) clearTimeout(timer);
    this.ws.close();
  }
}

let servidor;
let navegador;
let cdp;
let log = '';
let erroNavegador;
let passou = 0;
const conferir = (texto) => { passou++; console.log(`ok ${texto}`); };
try {
  servidor = await iniciar(0);
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
    try {
      portaCdp = fs.readFileSync(path.join(perfil, 'DevToolsActivePort'), 'utf8').split('\n')[0];
      break;
    } catch {
      await esperar(100);
    }
  }
  if (!portaCdp) throw new Error(`O Chromium não abriu: ${log}`);
  const http = `http://127.0.0.1:${portaCdp}`;
  const alvo = await (await fetch(`${http}/json/new?about:blank`, { method: 'PUT' })).json();
  cdp = new Cdp(alvo.webSocketDebuggerUrl);
  const porta = servidor.address().port;
  const url = `http://127.0.0.1:${porta}/pje/Processo/ConsultaProcesso/Detalhe/listProcessoCompletoAdvogado.seam?id=7365233&ca=526fadde902fb5149b`;
  await cdp.send('Page.navigate', { url });
  for (let i = 0; i < 100; i++) {
    if (await cdp.avaliar('document.readyState === "complete" && !!document.getElementById("divTimeLine")')) break;
    if (i === 99) throw new Error('A página simulada não carregou.');
    await esperar(100);
  }
  await cdp.avaliar(codigoPje);

  const linha = async (html) => cdp.avaliar(`document.getElementById('divTimeLine').innerHTML = ${JSON.stringify(html)}`);
  const api = (metodo) => cdp.avaliar(`__passivoPje.${metodo}()`);
  const valores = () => cdp.avaliar(`Object.fromEntries([...document.getElementById('navbar:painel').querySelectorAll('input[name],select[name]')].map(e => [e.name, e.type === 'checkbox' ? e.checked : e.value]))`);

  // Usa a rolagem original, inclusive os eventos antigos carregados só no fim.
  await cdp.avaliar(fs.readFileSync(path.join(aqui, '../extensao/pagina.js'), 'utf8'));
  const marca = await api('marcarLinhaDoTempo');
  assert.equal(marca.rola, true);
  await api('iniciarPeriodoDownload');
  await cdp.avaliar(`__clippingPrints.escolherArea(__clippingPrints.areaLembrada(${JSON.stringify(marca.lembranca)}))`);
  const captura = await capturarComRolagem({
    opcoes: { limite: 100, espera: 350, sobreposicao: 10, esconderFixos: true },
    pagina: (metodo, arg) => cdp.avaliar(`__clippingPrints[${JSON.stringify(metodo)}](${JSON.stringify(arg ?? null)})`),
    configPagina: { usarEscolhida: true, recorte: { modo: 'tela' } },
    antesDoPrint: () => api('registrarPeriodoDownload'),
    tirarPrint: async () => ({}),
    aoCapturar: async () => {},
    deveParar: () => false,
  });
  assert.equal(captura.motivo, 'fim', captura.erro?.message);
  assert.ok(captura.total > 1);
  assert.equal((await api('prepararDownload')).ok, true);
  assert.equal((await valores()).dtIni, '01/01/2017');
  assert.equal((await valores()).dtFim, '17/12/2022');
  conferir('rolagem original inclui a data mais antiga carregada sob demanda no fim');

  await cdp.avaliar(`document.querySelector('.viewer').insertAdjacentHTML('beforeend', '<div class="data">01 jan. 1900</div>');
    document.querySelector('[name=idDe]').value='123456';
    document.querySelector('[name=idAte]').value='654321';
    document.querySelector('[name=expediente]').value='N';
    document.querySelector('[name=movimentos]').value='N';`);
  await linha('<div class="data">09 set. 2026</div><div class="evento">DECORRIDO PRAZO EM 01 jan. 1901<br><div>Prazo encerrado em <span>01/01/1901</span></div>2286106703 - Certidão</div>');
  assert.equal((await api('marcarLinhaDoTempo')).achou, true);
  await api('iniciarPeriodoDownload');
  // O topo pode sair do DOM durante a rolagem; o período precisa guardar a última data.
  await linha('<div class="data">30 jun. 2023</div><div class="evento">1691531961 - Petição Inicial</div>');
  await api('registrarPeriodoDownload');
  assert.equal((await api('prepararDownload')).ok, true);
  let campos = await valores();
  assert.equal(campos.dtIni, '30/06/2023');
  assert.equal(campos.dtFim, '09/09/2026');
  assert.equal(campos.idDe, '');
  assert.equal(campos.idAte, '');
  assert.equal(campos.cronologia, 'ASC');
  assert.equal(campos.expediente, 'S');
  assert.equal(campos.movimentos, 'S');
  assert.equal(campos.tipoDoc, '');
  assert.equal(campos.i1 && campos.i2 && campos.i3 && campos.i4, true);
  conferir('período do primeiro ao último evento, Sim nos dois seletores, IDs separados e demais opções preservadas');
  assert.equal((await api('prepararDownload')).ok, true);
  assert.deepEqual(await valores(), campos);
  conferir('repetir a preparação mantém os valores');

  const downloads = path.join(perfil, 'downloads');
  fs.mkdirSync(downloads);
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads });
  assert.equal((await api('clicarDownload')).ok, true);
  let pdf;
  for (let i = 0; i < 100; i++) {
    const nome = fs.readdirSync(downloads).find((n) => n.endsWith('.pdf'));
    if (nome) { pdf = path.join(downloads, nome); break; }
    await esperar(100);
  }
  assert.ok(pdf, 'o botão DOWNLOAD deve baixar um PDF');
  assert.match(fs.readFileSync(pdf, 'latin1'), /^%PDF/);
  const enviados = await (await fetch(`http://127.0.0.1:${porta}/__registro`)).json();
  assert.equal(enviados.length, 1);
  assert.equal(enviados[0].campos.dtIni, '30/06/2023');
  assert.equal(enviados[0].campos.dtFim, '09/09/2026');
  assert.equal(enviados[0].campos.expediente, 'S');
  assert.equal(enviados[0].campos.movimentos, 'S');
  assert.equal(enviados[0].campos.idDe, '');
  assert.equal(enviados[0].campos.idAte, '');
  conferir('DOWNLOAD envia o período e Sim/Sim ao servidor e recebe um PDF');

  // O layout do PJe pode agrupar rótulos numa linha e os campos na seguinte.
  await cdp.avaliar(`
    const ini=document.querySelector('[name=dtIni]');
    ini.parentElement.innerHTML='<div style="display:flex;gap:20px"><label>Período de</label><label>Até</label></div><div style="display:flex;gap:20px"><input name="dtIni" type="text"><input name="dtFim" type="text"></div>';
  `);
  await linha('<div class="data">09/09/2026</div><div class="evento">2286106703 - Certidão</div><div class="data">30/06/2023</div><div class="evento">1691531961 - Petição Inicial</div>');
  await api('iniciarPeriodoDownload');
  assert.equal((await api('prepararDownload')).ok, true);
  campos = await valores();
  assert.equal(campos.dtIni, '30/06/2023');
  assert.equal(campos.dtFim, '09/09/2026');
  conferir('datas numéricas e período em colunas com dois rótulos antes dos campos');

  await linha('<div class="data">29 fev. 2024</div><div class="evento">1691531961 - Documento único</div>');
  await api('iniciarPeriodoDownload');
  assert.equal((await api('prepararDownload')).ok, true);
  campos = await valores();
  assert.equal(campos.dtIni, '29/02/2024');
  assert.equal(campos.dtFim, '29/02/2024');
  conferir('um único dia serve como início e fim, sem reaproveitar o período anterior');

  await cdp.avaliar(`document.querySelector('[name=dtIni]').type='date'; document.querySelector('[name=dtFim]').type='date'`);
  assert.equal((await api('prepararDownload')).ok, true);
  campos = await valores();
  assert.equal(campos.dtIni, '2024-02-29');
  assert.equal(campos.dtFim, '2024-02-29');
  conferir('campos HTML type=date recebem datas ISO');
  await cdp.avaliar(`document.querySelector('[name=dtIni]').type='text'; document.querySelector('[name=dtFim]').type='text';
    document.querySelector('[name=expediente]').value='N';
    document.querySelector('[name=movimentos]').value='N';
    document.querySelector('[name=expediente]').addEventListener('change', () => {
      const antigo=document.getElementById('navbar:painel');
      const novo=antigo.cloneNode(true);
      novo.querySelector('[name=dtIni]').value='';
      novo.querySelector('[name=dtFim]').value='';
      antigo.replaceWith(novo);
      globalThis.painelRedesenhado=true;
    }, {once:true});`);
  assert.equal((await api('prepararDownload')).ok, true);
  assert.equal(await cdp.avaliar('globalThis.painelRedesenhado'), true);
  campos = await valores();
  assert.equal(campos.dtIni, '29/02/2024');
  assert.equal(campos.dtFim, '29/02/2024');
  assert.equal(campos.expediente, 'S');
  assert.equal(campos.movimentos, 'S');
  conferir('segunda passada recupera datas e seletores após redesenhar o painel');

  await linha('<div class="data">31 fev. 2023</div><div class="evento">1691531961 - Documento sem data válida</div>');
  await api('iniciarPeriodoDownload');
  assert.equal((await api('prepararDownload')).ok, false);
  conferir('data inválida não gera um período de download');

  await linha('<div class="data">30 jun. 2023</div><div class="evento">1691531961 - Petição Inicial</div>');
  await api('iniciarPeriodoDownload');
  await cdp.avaliar(`document.querySelector('[name=dtFim]').remove()`);
  assert.equal((await api('prepararDownload')).ok, false);
  conferir('campo de período ausente impede download com intervalo incompleto');
  console.log(`\n${passou} cenários passaram.`);
} finally {
  cdp?.fechar();
  if (navegador && navegador.exitCode === null && !erroNavegador) {
    const terminou = once(navegador, 'exit');
    navegador.kill();
    await terminou;
  }
  if (servidor) await new Promise((r) => servidor.close(r));
  fs.rmSync(perfil, { recursive: true, force: true });
}
