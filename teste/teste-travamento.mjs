// Reproduz executeScript pendente no worker: o prazo da página não resolve
// uma injeção que nunca devolve. Roda sem navegador, usando relógio virtual.
//   node teste/teste-travamento.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import * as lista from '../extensao/lista.js';
import * as config from '../extensao/config.js';
import { capturarComRolagem } from '../extensao/captura.js';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const fonte = fs.readFileSync(path.join(aqui, '../extensao/background.js'), 'utf8').replace(/^import .*;\n/gm, '');
const URL_CONSULTA = 'https://pje.exemplo.invalid/pje/Processo/ConsultaProcesso/listView.seam';
const URL_AUTOS = 'https://pje.exemplo.invalid/pje/Processo/ConsultaProcesso/Detalhe/listProcessoCompletoAdvogado.seam?id=1&ca=ficticia';
const NUMEROS = ['0000001-01.2024.4.01.0001', '0000002-02.2024.4.01.0001'];
const drenar = async () => { for (let i = 0; i < 100; i++) await Promise.resolve(); };

class Relogio {
  agora = 1000000;
  proximo = 0;
  tarefas = new Map();
  agendar = (fn, ms = 0, intervalo = false, ...args) => {
    const id = ++this.proximo;
    this.tarefas.set(id, { fn, args, quando: this.agora + Math.max(0, Number(ms)), intervalo: intervalo ? Math.max(1, Number(ms)) : 0 });
    return id;
  };
  setTimeout = (fn, ms, ...args) => this.agendar(fn, ms, false, ...args);
  setInterval = (fn, ms, ...args) => this.agendar(fn, ms, true, ...args);
  clear = (id) => this.tarefas.delete(id);
  async avancar(ms) {
    const fim = this.agora + ms;
    for (;;) {
      await drenar();
      const proxima = [...this.tarefas].filter(([, t]) => t.quando <= fim).sort((a, b) => a[1].quando - b[1].quando)[0];
      if (!proxima) break;
      const [id, t] = proxima;
      this.agora = t.quando;
      if (t.intervalo) t.quando += t.intervalo; else this.tarefas.delete(id);
      t.fn(...t.args);
    }
    this.agora = fim;
    await drenar();
  }
}

function preparar(travar) {
  const relogio = new Relogio();
  const dados = {
    config: { urlConsulta: URL_CONSULTA, pausa: 0 },
    lista: NUMEROS.map((numero, i) => ({ numero, ordem: i + 1, status: 'pendente', manual: false, arquivos: [] })),
  };
  const chamadas = [];
  const pendentes = [];
  const abasCriadas = [];
  const efeitosPagina = [];
  const consulta = { id: 1, url: URL_CONSULTA, title: 'Consulta processos', status: 'complete', index: 0, windowId: 1, active: true };
  const abas = new Map([[1, consulta]]);
  const storage = {
    async get(chaves) { return Object.fromEntries((Array.isArray(chaves) ? chaves : [chaves]).map((k) => [k, structuredClone(dados[k])])); },
    async set(valores) { Object.assign(dados, structuredClone(valores)); },
  };
  const chrome = {
    storage: { local: storage },
    runtime: { onMessage: { addListener() {} }, getPlatformInfo() {} },
    action: { onClicked: { addListener() {} } },
    windows: { async get() { return { state: 'normal' }; }, async update() {} },
    tabs: {
      async query() {
        chamadas.push({ metodo: 'tabs.query', quando: relogio.agora });
        if (travar('tabs.query')) return new Promise((resolve) => pendentes.push({ metodo: 'tabs.query', pedido: {}, valorTardio: [{ ...consulta }], resolve }));
        return [...abas.values()].map((a) => ({ ...a }));
      },
      async get(id) {
        chamadas.push({ metodo: 'tabs.get', quando: relogio.agora });
        if (travar('tabs.get')) return new Promise((resolve) => pendentes.push({ metodo: 'tabs.get', pedido: {}, valorTardio: { ...abas.get(id) }, resolve }));
        return { ...abas.get(id) };
      },
      async update(id, mudancas) { Object.assign(abas.get(id), mudancas); return { ...abas.get(id) }; },
      async create(opcoes) {
        const aba = { ...consulta, ...opcoes, id: abas.size + 1, title: NUMEROS[0] };
        abas.set(aba.id, aba); abasCriadas.push(aba); return { ...aba };
      },
      async reload() {},
      async remove(id) { abas.delete(id); },
    },
    scripting: {
      executeScript(pedido) {
        const metodo = pedido.files ? `injetar:${pedido.files.join(',')}` : `${pedido.world === 'MAIN' ? 'MAIN:' : ''}${pedido.args?.[0] || 'funcao'}`;
        chamadas.push({ metodo, args: pedido.args, quando: relogio.agora });
        if (travar(metodo)) return new Promise((resolve) => pendentes.push({ metodo, pedido, resolve }));
        if (pedido.files) {
          if (pedido.files.includes('pagina.js')) throw new Error('Captura não deveria começar após um comando travado.');
          return Promise.resolve([]);
        }
        let result;
        switch (metodo) {
          case 'pesquisar': result = { ok: true, url: null }; break;
          case 'mensagens': result = []; break;
          case 'MAIN:preparar': result = { ativo: true, confirmacoes: 0, url: null, erro: null }; break;
          case 'clicarResultado': result = { ok: true }; break;
          case 'MAIN:estado': result = { ativo: true, confirmacoes: 1, url: URL_AUTOS, erro: null }; break;
          case 'MAIN:finalizar': result = { ativo: false }; break;
          case 'esperarAutos': result = { ok: true, numeroConfere: true }; break;
          default: throw new Error(`Comando inesperado no teste: ${metodo}`);
        }
        return Promise.resolve([{ result }]);
      },
    },
  };
  const contexto = vm.createContext({
    ...lista, ...config, capturarComRolagem, chrome, URL,
    __passivoPje: Object.fromEntries(['pesquisar', 'clicarResultado', 'clicarDownload', 'esperarAutos', 'prepararDownload', 'registrarPeriodoDownload'].map((metodo) => [metodo, () => { efeitosPagina.push(metodo); return { ok: true, url: URL_AUTOS }; }])),
    __passivoAbertura: Object.fromEntries(['preparar', 'estado', 'finalizar'].map((metodo) => [metodo, () => { efeitosPagina.push(metodo); return { ativo: false }; }])),
    Date: class extends Date { constructor(...args) { super(...(args.length ? args : [relogio.agora])); } static now() { return relogio.agora; } },
    setTimeout: relogio.setTimeout, clearTimeout: relogio.clear,
    setInterval: relogio.setInterval, clearInterval: relogio.clear,
    esperar: (ms) => new Promise((resolve) => relogio.setTimeout(resolve, ms)),
  });
  vm.runInContext(`${fonte}\nglobalThis.__teste = { pronto, rodar, chamar, aberturaNaConsulta };`, contexto, { filename: 'background.js' });
  return { api: contexto.__teste, relogio, dados, chamadas, pendentes, abasCriadas, efeitosPagina };
}

let passou = 0;
const falhas = [];
async function cenario(nome, teste) {
  try { await teste(); passou++; console.log(`ok ${nome}`); }
  catch (erro) { falhas.push({ nome, erro }); console.error(`FALHA ${nome}: ${erro.message}`); }
}

for (const [metodo, limite, abasAntes] of [
  ['tabs.query', 10000, 0],
  ['tabs.get', 10000, 0],
  ['injetar:pje.js', 10000, 0],
  ['pesquisar', 50000, 0],
  ['injetar:abertura.js', 10000, 0],
  ['MAIN:estado', 3000, 0],
  ['MAIN:finalizar', 3000, 1],
]) {
  await cenario(`rodada termina e preserva o próximo processo quando ${metodo} não responde`, async () => {
    const t = preparar((m) => m === metodo);
    await t.api.pronto;
    const inicio = t.relogio.agora;
    const rodada = await t.api.rodar();
    assert.equal(rodada.ok, true);
    assert.equal(rodada.total, 2);
    for (let i = 0; i < 20 && !t.pendentes.length && t.dados.execucao.ativo; i++) await drenar();
    assert.equal(t.dados.execucao.ativo, true);
    assert.equal(t.pendentes.length, 1, `o cenário deve alcançar ${metodo}`);
    await t.relogio.avancar(90000);
    assert.equal(t.dados.execucao.ativo, false, 'o prazo do worker deve encerrar uma chamada que nunca resolveu');
    assert.equal(t.dados.lista[0].status, 'erro');
    assert.ok(t.dados.lista[0].detalhe);
    assert.equal(t.dados.lista[1].status, 'pendente', 'não iniciar outro processo enquanto a operação anterior está pendente');
    assert.match(t.dados.execucao.etapa, /interrompida/i);
    assert.ok(t.dados.execucao.fim - inicio <= limite + 3500, 'a rodada deve terminar após o prazo previsto, incluindo a limpeza');
    assert.equal(t.chamadas.filter((c) => c.metodo === 'pesquisar' && c.args?.[1]?.numero === NUMEROS[1]).length, 0);
    assert.equal(t.abasCriadas.length, abasAntes);
    assert.equal(t.relogio.tarefas.size, 0, 'os timers do prazo e de manter vivo devem ser limpos');

    // O Chrome pode entregar o resultado depois do erro: isso não deve retomar a rodada.
    for (const p of t.pendentes) {
      if (p.pedido.func) {
        const resultadoAtrasado = p.pedido.func(...p.pedido.args);
        if (p.metodo !== 'MAIN:finalizar') assert.equal(resultadoAtrasado.expirou, true, 'comando executado tarde não pode agir na página');
      }
      p.resolve(p.valorTardio ?? [{ result: { ok: true, ativo: true, url: URL_AUTOS, confirmacoes: 1 } }]);
    }
    assert.deepEqual(t.efeitosPagina, metodo === 'MAIN:finalizar' ? ['finalizar'] : [], 'somente a limpeza pode executar na página após o prazo');
    await drenar();
    await t.relogio.avancar(90000);
    assert.equal(t.abasCriadas.length, abasAntes, 'resultado atrasado não pode abrir outra aba');
    assert.equal(t.dados.execucao.ativo, false);
    assert.equal(t.dados.lista[1].status, 'pendente');
  });
}

for (const [metodo, arg, limite] of [
  ['esperarAutos', { tempo: 60000 }, 65000],
  ['prepararDownload', null, 20000],
  ['registrarPeriodoDownload', null, 10000],
  ['clicarResultado', { numero: NUMEROS[0] }, 10000],
  ['clicarDownload', null, 10000],
  ['pesquisar', { numero: NUMEROS[0], tempo: 45000 }, 50000],
  ['MAIN:preparar', { tempo: 35000 }, 3000],
]) {
  await cenario(`${metodo} respeita o prazo no worker e interrompe a rodada com erro`, async () => {
    const t = preparar((m) => m === metodo);
    await t.api.pronto;
    let fim;
    const pedido = metodo.startsWith('MAIN:') ? t.api.aberturaNaConsulta(1, metodo.slice(5), arg) : t.api.chamar(1, metodo, arg);
    const operacao = pedido.then(() => { fim = { sucesso: true }; }, (erro) => { fim = { erro }; });
    await drenar();
    assert.equal(t.pendentes.length, 1);
    await t.relogio.avancar(limite - 1);
    assert.equal(fim, undefined, 'não interromper antes do prazo específico da operação');
    await t.relogio.avancar(1);
    assert.ok(fim?.erro, 'um executeScript pendente deve rejeitar no prazo');
    assert.equal(fim.erro.pararTudo, true);
    await operacao;
    assert.equal(t.relogio.tarefas.size, 0);
    await t.relogio.avancar(1);
    const pendente = t.pendentes[0];
    assert.equal(pendente.pedido.func(...pendente.pedido.args).expirou, true);
    assert.deepEqual(t.efeitosPagina, [], 'a função atrasada não pode clicar nem começar outra operação na página');
    pendente.resolve([{ result: { ok: true } }]);
    await drenar();
  });
}

console.log(`\n${passou} cenários passaram; ${falhas.length} falharam.`);
if (falhas.length) process.exitCode = 1;
