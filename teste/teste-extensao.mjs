// Teste de ponta a ponta: abre o Chromium com a extensão, aponta para o PJe de
// mentira (mock-pje.mjs) e roda a lista. Confere a pasta montada em Downloads,
// os campos enviados no DOWNLOAD e a situação de cada processo.
//   node teste/teste-extensao.mjs            (usa o Chromium do Playwright)
//   CHROME=/caminho/do/chrome node teste/teste-extensao.mjs
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { iniciar, registro } from './mock-pje.mjs';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(aqui, '../extensao');
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome';
const SAIDA = process.env.SAIDA || fs.mkdtempSync(path.join(os.tmpdir(), 'passivo-'));
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

const falhas = [];
function conferir(cond, texto) {
  console.log(`${cond ? 'ok  ' : 'FALHA'} ${texto}`);
  if (!cond) falhas.push(texto);
}

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
      if (m.error) p.f(new Error(m.error.message));
      else p.r(m.result);
    };
  }
  async send(method, params = {}) {
    await this.aberto;
    const id = ++this.n;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((r, f) => this.pendentes.set(id, { r, f }));
  }
  async avaliar(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  }
  fechar() {
    this.ws.close();
  }
}

function arquivos(dir, base = dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? arquivos(p, base) : [path.relative(base, p)];
  });
}

const servidor = await iniciar(0);
const porta = servidor.address().port;
const perfil = path.join(SAIDA, 'perfil');
const downloads = path.join(SAIDA, 'Downloads');
fs.mkdirSync(path.join(perfil, 'Default'), { recursive: true });
fs.mkdirSync(downloads, { recursive: true });
fs.writeFileSync(
  path.join(perfil, 'Default', 'Preferences'),
  JSON.stringify({
    download: { default_directory: downloads, prompt_for_download: false, directory_upgrade: true },
    savefile: { default_directory: downloads },
    // pop-ups liberados para o PJe, como costuma estar no Edge de quem usa o PJe
    profile: { content_settings: { exceptions: { popups: { [`http://127.0.0.1:${porta},*`]: { setting: 1 } } } } },
  }),
);

const navegador = spawn(
  CHROME,
  [
    '--headless=new',
    '--no-sandbox',
    `--user-data-dir=${perfil}`,
    `--load-extension=${EXT}`,
    `--disable-extensions-except=${EXT}`,
    '--remote-debugging-port=0',
    '--window-size=1400,900',
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank',
  ],
  { stdio: ['ignore', 'ignore', 'pipe'] },
);
let logNavegador = '';
navegador.stderr.on('data', (d) => (logNavegador += d));

let codigo = 1;
try {
  // porta do DevTools
  let portaCdp = null;
  for (let i = 0; i < 100 && !portaCdp; i++) {
    await esperar(200);
    try {
      portaCdp = fs.readFileSync(path.join(perfil, 'DevToolsActivePort'), 'utf8').split('\n')[0];
    } catch {
      // ainda não abriu
    }
  }
  if (!portaCdp) throw new Error(`o Chromium não abriu:\n${logNavegador}`);
  const http = `http://127.0.0.1:${portaCdp}`;

  // id de extensão sem compactação: sha256 do caminho da pasta, com 0-f virando a-p
  const idExt = [...createHash('sha256').update(EXT).digest('hex').slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
  let carregou = false;
  for (let i = 0; i < 50 && !carregou; i++) {
    const alvos = await (await fetch(`${http}/json/list`)).json();
    carregou = alvos.some((a) => a.url === `chrome-extension://${idExt}/background.js`);
    if (!carregou) await esperar(200);
  }
  if (!carregou) throw new Error('a extensão não carregou (service worker não apareceu).');
  console.log(`extensão carregada: ${idExt}`);

  const painel = await (await fetch(`${http}/json/new?chrome-extension://${idExt}/painel.html`, { method: 'PUT' })).json();
  const cdp = new Cdp(painel.webSocketDebuggerUrl);
  for (let i = 0; i < 50; i++) {
    await esperar(300);
    const pronto = await cdp.avaliar(`location.href + ' ' + typeof chrome?.storage + ' ' + document.readyState`).catch(() => '');
    if (/painel\.html object complete/.test(pronto)) break;
    if (i === 49) throw new Error(`o painel não abriu: ${pronto}`);
  }

  // 1. lista inicial
  const inicial = await cdp.avaliar(`chrome.storage.local.get('lista').then(d => d.lista)`);
  conferir(inicial.length === 27, `lista inicial com 27 processos (veio ${inicial.length})`);
  conferir(inicial.filter((i) => i.status === 'ok').length === 6, 'os 6 primeiros vêm como ok');
  conferir(inicial[5].numero === '0005417-28.2017.4.01.3700' && inicial[26].numero === '0000992-31.2012.4.01.3700', 'ordem da lista confere');
  const linhasPainel = await cdp.avaliar(`document.querySelectorAll('#linhas tr').length`);
  conferir(linhasPainel === 27, `painel mostra 27 linhas (mostra ${linhasPainel})`);

  // 2. configura para o PJe de mentira e troca a lista
  const urlConsulta = `http://127.0.0.1:${porta}/pje/Processo/ConsultaProcesso/listView.seam`;
  const enviar = (tipo, dados) => cdp.avaliar(`chrome.runtime.sendMessage(${JSON.stringify({ alvo: 'fundo', tipo, ...dados })})`);
  await enviar('salvarConfig', { config: { raiz: 'PASSIVO TESTE', urlConsulta, espera: 500, pausa: 0, limitePdf: 60, recorte: 'tela', fecharAbas: true } });
  const lista = `1. **Nº 0005417-28.2017.4.01.3700**
Execução de débitos do Simples Nacional.
* **Observação:** linha do tempo longa.

2. **Nº 0000992-31.2012.4.01.3700**
Execução fiscal com poucos eventos.

3. **Nº 1111111-11.1111.1.11.1111**
Processo que a consulta não encontra.

4. **Nº 0000086-32.1998.4.01.3700 (ok)**
Já feito à mão.`;
  const imp = await enviar('importar', { texto: lista });
  conferir(imp?.ok && imp.total === 4, 'lista de teste importada (4 processos)');
  // o 0005417 já era ok na lista original (a situação é mantida): desmarca para rodar
  const depoisImp = await cdp.avaliar(`chrome.storage.local.get('lista').then(d => d.lista)`);
  conferir(depoisImp[0].status === 'ok' && depoisImp[3].status === 'ok', 'importar manteve o ok do 0005417 e aplicou o "(ok)" do 0000086');
  await enviar('marcar', { numero: '0005417-28.2017.4.01.3700', status: 'pendente' });

  // 3. roda os pendentes
  const inicio = Date.now();
  const r = await enviar('rodar', {});
  conferir(r?.ok && r.total === 3, `rodada começou com 3 pendentes (${JSON.stringify(r)})`);
  let ultima = '';
  for (;;) {
    await esperar(700);
    const ex = await cdp.avaliar(`chrome.storage.local.get('execucao').then(d => d.execucao)`);
    const texto = `${ex.atual || ''} ${ex.etapa || ''}`;
    if (texto !== ultima) console.log(`     … ${texto}`);
    ultima = texto;
    if (!ex.ativo) break;
    if (Date.now() - inicio > 240000) throw new Error('a rodada passou de 4 minutos.');
  }
  console.log(`     rodada em ${Math.round((Date.now() - inicio) / 1000)} s`);

  const fim = await cdp.avaliar(`chrome.storage.local.get('lista').then(d => d.lista)`);
  for (const i of fim) console.log(`     ${String(i.ordem).padStart(2, '0')} ${i.numero} [${i.status}] ${i.detalhe}`);
  conferir(fim[0].status === 'ok', 'processo 1 (linha do tempo longa) ok');
  conferir(fim[1].status === 'ok', 'processo 2 (linha do tempo curta) ok');
  conferir(fim[2].status === 'erro' && /não encontrou/.test(fim[2].detalhe), 'processo 3 (inexistente) com erro de consulta');
  conferir(fim[3].status === 'ok' && fim[3].manual, 'processo 4 (marcado ok) não foi mexido');

  const raiz = path.join(downloads, 'PASSIVO TESTE');
  const lidos = arquivos(raiz).sort();
  console.log(lidos.map((a) => `     ${a}`).join('\n'));
  const p1 = lidos.filter((a) => a.startsWith('01 - 0005417-28.2017.4.01.3700/'));
  const prints1 = p1.filter((a) => /PRINT \d+\.png$/.test(a));
  conferir(p1.includes('01 - 0005417-28.2017.4.01.3700/0005417-28.2017.4.01.3700.pdf'), 'PDF do processo 1 na pasta 01');
  conferir(prints1.length >= 4, `processo 1 com vários prints (${prints1.length})`);
  conferir(prints1.length === fim[0].prints, 'quantidade de prints confere com a lista');
  const p2 = lidos.filter((a) => a.startsWith('02 - 0000992-31.2012.4.01.3700/'));
  conferir(p2.includes('02 - 0000992-31.2012.4.01.3700/0000992-31.2012.4.01.3700.pdf'), 'PDF do processo 2 na pasta 02');
  conferir(p2.filter((a) => /PRINT/.test(a)).length === 1, 'processo 2 com 1 print (linha do tempo curta)');
  conferir(!lidos.some((a) => a.startsWith('03 - ')), 'nenhuma pasta para o processo 3');
  conferir(lidos.includes('LISTA DO PASSIVO.txt'), 'LISTA DO PASSIVO.txt na pasta principal');
  conferir(!lidos.some((a) => / \(\d+\)\./.test(a)), 'nenhum arquivo com "(1)" no nome');
  const pdf = fs.readFileSync(path.join(raiz, '01 - 0005417-28.2017.4.01.3700', '0005417-28.2017.4.01.3700.pdf'), 'latin1');
  conferir(pdf.startsWith('%PDF') && pdf.includes('inteiro teor'), 'o PDF salvo é o que o PJe mandou');
  const txt = fs.readFileSync(path.join(raiz, 'LISTA DO PASSIVO.txt'), 'utf8');
  conferir(/01 - 0005417-28\.2017\.4\.01\.3700 {2}\[OK\]/.test(txt) && /03 - 1111111-11\.1111\.1\.11\.1111 {2}\[ERRO\]/.test(txt), 'LISTA DO PASSIVO.txt com a situação de cada um');

  const enviados = await (await fetch(`http://127.0.0.1:${porta}/__registro`)).json();
  conferir(enviados.length === 2, `2 DOWNLOADs pedidos ao PJe (${enviados.length})`);
  for (const e of enviados) {
    const c = e.campos;
    conferir(
      c.dtIni === '' && c.dtFim === '' && c.idDe === '' && c.cronologia === 'ASC' && c.expediente === 'N' && c.movimentos === 'N' && c.tipoDoc === '',
      `${e.numero}: inteiro teor, crescente, sem expediente e sem movimentos (${JSON.stringify(c)})`,
    );
  }
  const abas = await (await fetch(`${http}/json/list`)).json();
  conferir(!abas.some((a) => /listProcessoCompletoAdvogado/.test(a.url)), 'abas dos autos fechadas no fim');

  // 4. refazer o processo 1: substitui os arquivos, sem duplicar
  const r2 = await enviar('rodar', { numeros: ['0005417-28.2017.4.01.3700'] });
  conferir(r2?.ok, 'refazer o processo 1 começou');
  for (let i = 0; i < 200; i++) {
    await esperar(700);
    if (!(await cdp.avaliar(`chrome.storage.local.get('execucao').then(d => d.execucao.ativo)`))) break;
  }
  const depois = arquivos(raiz).sort();
  const p1b = depois.filter((a) => a.startsWith('01 - '));
  conferir(p1b.length === p1.length, `refazer manteve ${p1.length} arquivos na pasta 01 (tem ${p1b.length})`);
  conferir(!depois.some((a) => / \(\d+\)\./.test(a)), 'refazer não criou "(1)"');

  // 5. prints só da linha do tempo + aba antiga com a sessão vencida (é fechada e o processo reaberto pela consulta)
  await enviar('salvarConfig', { config: { raiz: 'PASSIVO TESTE', urlConsulta, espera: 500, pausa: 0, limitePdf: 60, recorte: 'linha', fecharAbas: true } });
  const velha = await (await fetch(`${http}/json/new?http://127.0.0.1:${porta}/pje/Processo/ConsultaProcesso/Detalhe/listProcessoCompletoAdvogado.seam?id=7365777%26ca=vencida`, { method: 'PUT' })).json();
  await esperar(1500);
  const r3 = await enviar('rodar', { numeros: ['0005417-28.2017.4.01.3700', '0000992-31.2012.4.01.3700'] });
  conferir(r3?.ok, 'refazer os processos 1 e 2 com prints só da linha do tempo');
  for (let i = 0; i < 200; i++) {
    await esperar(700);
    if (!(await cdp.avaliar(`chrome.storage.local.get('execucao').then(d => d.execucao.ativo)`))) break;
  }
  const fim3 = await cdp.avaliar(`chrome.storage.local.get('lista').then(d => d.lista)`);
  conferir(fim3[1].status === 'ok', `processo 2 ok depois da aba vencida (${fim3[1].detalhe})`);
  const abas3 = await (await fetch(`${http}/json/list`)).json();
  conferir(!abas3.some((a) => a.id === velha.id), 'a aba vencida foi fechada');
  conferir(fim3[0].status === 'ok' && fim3[0].prints > 1, `processo 1 ok com a linha do tempo recortada (${fim3[0].detalhe})`);
  for (const [pasta, nome] of [['01 - 0005417-28.2017.4.01.3700', 'PRINT 03.png'], ['02 - 0000992-31.2012.4.01.3700', 'PRINT 01.png']]) {
    const png = fs.readFileSync(path.join(raiz, pasta, nome));
    const largura = png.readUInt32BE(16);
    conferir(largura > 300 && largura <= 440, `${pasta}/${nome} recortado na linha do tempo (largura ${largura}px)`);
    fs.copyFileSync(path.join(raiz, pasta, nome), path.join(SAIDA, `exemplo-linha-${pasta.slice(0, 2)}.png`));
  }

  // cópia de um print para olhar
  const exemplo = path.join(raiz, prints1[0]);
  fs.copyFileSync(exemplo, path.join(SAIDA, 'exemplo-print-01.png'));
  fs.copyFileSync(path.join(raiz, prints1[prints1.length - 1]), path.join(SAIDA, 'exemplo-print-ultimo.png'));
  await cdp.send('Page.captureScreenshot', {}).then((s) => fs.writeFileSync(path.join(SAIDA, 'painel.png'), Buffer.from(s.data, 'base64'))).catch(() => {});
  cdp.fechar();
  codigo = falhas.length ? 1 : 0;
} catch (e) {
  console.error('ERRO NO TESTE:', e);
} finally {
  navegador.kill();
  servidor.close();
  console.log(`\n${codigo ? `NÃO PASSOU (${falhas.length} falha(s))` : 'tudo certo'} · arquivos do teste em ${SAIDA}`);
  process.exit(codigo);
}
