// Exercita a abertura real do background com APIs de navegador simuladas.
// Não requer extensão instalada, servidor nem sessão do PJe.
//   node teste/teste-abertura-background.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';

const fundo = fs.readFileSync(new URL('../extensao/background.js', import.meta.url), 'utf8');
const abertura = fs.readFileSync(new URL('../extensao/abertura.js', import.meta.url), 'utf8');
const CONSULTA = 'https://pje.exemplo.test/pje/Processo/ConsultaProcesso/listView.seam';
const NUMEROS = ['0005417-28.2017.4.01.3700', '0000992-31.2012.4.01.3700'];
const AVISO = 'Conforme a Resolução CNJ n.º 121 e o PCA 0000547-84.2011.2.00.0000, o acesso aos autos de processo de que o advogado/procurador/defensor público não faz parte será registrado para fins de eventual responsabilização civil, administrativa ou criminal. Continuar?';
const autos = (id, chave = 'atual') => `https://pje.exemplo.test/pje/Processo/ConsultaProcesso/Detalhe/listProcessoCompletoAdvogado.seam?id=${id}&ca=${chave}`;

async function navegador(opcoes = {}) {
  let agora = 0;
  let proximoTimer = 0;
  let proximaAba = 2;
  let numeroAtual;
  let clicou = false;
  const timers = new Map();
  const abas = new Map([[1, { id: 1, windowId: 1, index: 0, url: CONSULTA, title: 'Consulta processos', status: 'complete' }]]);
  const criadas = [];
  const recarregadas = [];
  const chamadas = [];
  const Relogio = class extends Date { static now() { return agora; } };
  const originais = { confirm: () => false, open: () => ({}) };
  const main = vm.createContext({ URL, Date: Relogio, location: new URL(CONSULTA), confirm: originais.confirm, open: originais.open });
  main.window = main;
  const agendar = (fn, ms) => {
    const id = ++proximoTimer;
    timers.set(id, { fn, quando: agora + ms });
    return id;
  };
  main.setTimeout = agendar;
  main.clearTimeout = (id) => timers.delete(id);
  const esperar = async (ms) => {
    agora += ms;
    for (const [id, timer] of [...timers]) {
      if (timer.quando > agora) continue;
      timers.delete(id);
      timer.fn();
    }
  };
  const responderAutos = (url, atraso = 300) => agendar(() => {
    main.__urlResposta = url;
    vm.runInContext(`if (confirm(${JSON.stringify(AVISO)})) window.open(__urlResposta, '_blank')`, main);
  }, atraso);
  const navegarNaMesmaAba = (url, atraso = 300) => agendar(() => {
    Object.assign(abas.get(1), { url, title: numeroAtual });
    main.location = new URL(url);
    delete main.__passivoAbertura; // O documento anterior deixou de existir.
    main.confirm = originais.confirm;
    main.open = originais.open;
  }, atraso);
  const api = {
    pesquisar({ numero }) {
      numeroAtual = numero;
      clicou = false;
      return opcoes.pesquisa?.(numero) ?? { ok: true, url: null };
    },
    mensagens() {
      return [...(opcoes.avisosAntigos ?? []), ...(clicou ? opcoes.avisosNovos ?? [] : [])];
    },
    clicarResultado({ numero }) {
      clicou = true;
      return opcoes.clique?.({ numero, responderAutos, navegarNaMesmaAba }) ?? { ok: true };
    },
  };
  const apiPrincipal = opcoes.formularioEmQuadro ? { ...api, pesquisar: () => ({ ok: false, semCampo: true }) } : api;
  const isolados = new Map([
    [0, vm.createContext({ Date: Relogio, __passivoPje: apiPrincipal })],
    [9, vm.createContext({ Date: Relogio, __passivoPje: api })],
  ]);
  const chrome = {
    storage: { local: { get: async () => ({ lista: [] }), set: async () => {} } },
    runtime: { onMessage: { addListener() {} } },
    action: { onClicked: { addListener() {} } },
    windows: { get: async () => ({ id: 1, state: 'normal' }), update: async () => {} },
    tabs: {
      query: async () => [...abas.values()].map((aba) => ({ ...aba })),
      get: async (id) => ({ ...abas.get(id) }),
      update: async (id, mudancas) => Object.assign(abas.get(id), mudancas),
      reload: async (id) => recarregadas.push(id),
      create: async (pedido) => {
        const aba = { id: proximaAba++, windowId: 1, index: 1, title: numeroAtual, status: 'complete', ...pedido };
        abas.set(aba.id, aba);
        criadas.push({ ...pedido });
        return { ...aba };
      },
    },
    scripting: {
      async executeScript(pedido) {
        const metodo = pedido.args?.[0];
        chamadas.push({
          mundo: pedido.world ?? 'ISOLATED', arquivos: pedido.files, metodo,
          todos: pedido.target.allFrames === true,
          quadros: Array.from(pedido.target.frameIds ?? [0]),
        });
        if (pedido.files) {
          if (pedido.files.includes('abertura.js')) vm.runInContext(abertura, main);
          return [];
        }
        if (pedido.world === 'MAIN' && metodo === 'estado' && opcoes.falharLeituraMain) {
          opcoes.falharLeituraMain = false;
          throw new Error('Frame was removed');
        }
        const quadros = pedido.target.allFrames ? [0, 9] : pedido.target.frameIds ?? [0];
        const resultados = [];
        for (const frameId of quadros) {
          const contexto = pedido.world === 'MAIN' ? main : isolados.get(frameId);
          contexto.__argumentos = pedido.args ?? [];
          const result = await vm.runInContext(`(${pedido.func.toString()})(...__argumentos)`, contexto);
          resultados.push({ frameId, result });
        }
        return resultados;
      },
    },
  };
  const contexto = vm.createContext({
    chrome, URL, console, esperar, Date: Relogio,
    setTimeout: agendar, clearTimeout: (id) => timers.delete(id),
    soDigitos: (s) => String(s ?? '').replace(/\D/g, ''),
  });
  // Mantém as funções de produção inteiras. Só remove as importações em
  // memória para fornecer o relógio e as APIs externas no contexto de teste.
  vm.runInContext(fundo.replace(/^import .*;\s*$/gm, '') + '\nglobalThis.testar = { abrirAutos, pronto };', contexto);
  await contexto.testar.pronto;
  return {
    abrir: (numero = NUMEROS[0]) => contexto.testar.abrirAutos(numero, { urlConsulta: CONSULTA }),
    abas, criadas, recarregadas, chamadas,
    restaurou() {
      assert.equal(main.confirm, originais.confirm, 'confirm original restaurado');
      assert.equal(main.open, originais.open, 'window.open original restaurado');
      assert.equal(main.__passivoAbertura?.estado().ativo, false, 'sessão de abertura finalizada');
    },
  };
}

test('abre dois processos consecutivos com a chave AJAX de cada resposta', async () => {
  const urls = [autos(101, 'chave-primeira'), autos(202, 'chave-segunda')];
  const b = await navegador({ clique: ({ numero, responderAutos }) => {
    responderAutos(urls[NUMEROS.indexOf(numero)]);
    return { ok: true };
  } });
  const primeira = await b.abrir(NUMEROS[0]);
  assert.equal(primeira.aba.url, urls[0]);
  b.restaurou();
  const segunda = await b.abrir(NUMEROS[1]);
  assert.equal(segunda.aba.url, urls[1]);
  assert.deepEqual(b.criadas.map((a) => a.url), urls);
  assert.equal(b.criadas.length, 2, 'nenhuma aba duplicada');
  b.restaurou();
});

test('reaproveita os autos já abertos sem instalar os interceptadores', async () => {
  const b = await navegador();
  b.abas.set(7, { id: 7, title: NUMEROS[0], url: autos(7), windowId: 1, status: 'complete' });
  const resultado = await b.abrir();
  assert.equal(resultado.aba.id, 7);
  assert.equal(resultado.reaproveitada, true);
  assert.deepEqual(b.recarregadas, [7]);
  assert.equal(b.criadas.length, 0);
  assert.equal(b.chamadas.length, 0, 'caso já funcional não passa pelo caminho AJAX');
});

test('preserva links diretos sem instalar interceptadores nem clicar resultado', async () => {
  const url = autos(303, 'direta');
  const b = await navegador({ pesquisa: () => ({ ok: true, url }) });
  assert.equal((await b.abrir()).aba.url, url);
  assert.deepEqual(b.criadas.map((a) => a.url), [url]);
  assert.equal(b.chamadas.some((c) => c.mundo === 'MAIN' || c.metodo === 'clicarResultado'), false);
});

test('aceita navegação na mesma aba apesar de contexto MAIN removido', async () => {
  const url = autos(404);
  const b = await navegador({
    falharLeituraMain: true,
    clique: ({ navegarNaMesmaAba }) => { navegarNaMesmaAba(url); return { ok: true }; },
  });
  const resultado = await b.abrir();
  assert.equal(resultado.aba.id, 1);
  assert.equal(resultado.aba.url, url);
  assert.equal(b.criadas.length, 0, 'não duplica navegação feita pelo PJe');
  assert.ok(b.chamadas.some((c) => c.metodo === 'finalizar'), 'tenta finalizar mesmo após trocar o documento');
});

test('ignora aviso de erro anterior e aguarda a resposta do processo atual', async () => {
  const url = autos(505);
  const b = await navegador({
    avisosAntigos: ['Erro antigo de uma operação anterior.'],
    clique: ({ responderAutos }) => { responderAutos(url, 900); return { ok: true }; },
  });
  assert.equal((await b.abrir()).aba.url, url);
  b.restaurou();
});

test('relata novo erro do PJe e restaura os interceptadores', async () => {
  const b = await navegador({ avisosNovos: ['Acesso negado ao processo.'] });
  await assert.rejects(b.abrir(), /o PJe respondeu ao abrir o processo: Acesso negado/);
  assert.equal(b.criadas.length, 0);
  b.restaurou();
});

test('restaura interceptadores quando o resultado some antes do clique', async () => {
  const b = await navegador({ clique: () => ({ ok: false, erro: 'O resultado sumiu.' }) });
  await assert.rejects(b.abrir(), /O resultado sumiu/);
  assert.equal(b.criadas.length, 0);
  b.restaurou();
});

test('timeout encerra a sessão sem alegar bloqueio de pop-up', async () => {
  const b = await navegador();
  await assert.rejects(b.abrir(), (erro) => /em 30 s/.test(erro.message) && !/pop-up/.test(erro.message));
  assert.equal(b.criadas.length, 0);
  b.restaurou();
});

test('consulta no quadro principal não depende dos quadros auxiliares', async () => {
  const url = autos(606);
  const b = await navegador({ clique: ({ responderAutos }) => { responderAutos(url); return { ok: true }; } });
  assert.equal((await b.abrir()).aba.url, url);
  assert.ok(b.chamadas.length > 0);
  assert.ok(b.chamadas.every((c) => !c.todos), 'não consulta allFrames se encontrou o formulário no principal');
  assert.ok(b.chamadas.every((c) => c.quadros.length === 1 && c.quadros[0] === 0));
  b.restaurou();
});

test('quando o formulário está em iframe, abre e acompanha a resposta nesse quadro', async () => {
  const url = autos(707);
  const b = await navegador({
    formularioEmQuadro: true,
    clique: ({ responderAutos }) => { responderAutos(url); return { ok: true }; },
  });
  assert.equal((await b.abrir()).aba.url, url);
  const pesquisas = b.chamadas.filter((c) => c.metodo === 'pesquisar');
  assert.equal(pesquisas.length, 2, 'tenta principal antes do fallback');
  assert.deepEqual(pesquisas[0].quadros, [0]);
  assert.equal(pesquisas[0].todos, false);
  assert.equal(pesquisas[1].todos, true);
  const aberturaNoQuadro = b.chamadas.filter((c) => c.mundo === 'MAIN' || c.metodo === 'clicarResultado' || c.metodo === 'mensagens');
  assert.ok(aberturaNoQuadro.length > 0);
  assert.ok(aberturaNoQuadro.every((c) => !c.todos && c.quadros.length === 1 && c.quadros[0] === 9), 'não perde o frameId encontrado na pesquisa');
  assert.deepEqual(b.criadas.map((a) => a.url), [url]);
  b.restaurou();
});
