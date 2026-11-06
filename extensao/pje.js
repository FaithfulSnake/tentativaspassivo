// Roda dentro das abas do PJe (injetado pela extensão, em todos os quadros).
// Expõe globalThis.__passivoPje com o que a extensão faz na tela, do mesmo
// jeito que a pessoa faria: colar o número na consulta, pesquisar, abrir os
// autos, achar a linha do tempo e preencher o painel de download.
//
// O PJe não tem identificadores estáveis nos campos (muitos são "j_id123"),
// então tudo é achado pelo texto que aparece na tela (rótulos, títulos e botões).
(() => {
  if (globalThis.__passivoPje) return;

  const esperar = (ms) => new Promise((pronto) => setTimeout(pronto, ms));
  const soDigitos = (s) => String(s ?? '').replace(/\D/g, '');
  // minúsculas, sem acento e com espaços simples (para comparar textos)
  const norm = (s) =>
    String(s ?? '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();

  function visivel(el) {
    if (!el?.isConnected) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) !== 0;
  }

  async function esperarAte(achar, tempo, intervalo = 250) {
    const fim = Date.now() + tempo;
    for (;;) {
      const r = achar();
      if (r) return r;
      if (Date.now() > fim) return null;
      await esperar(intervalo);
    }
  }

  // Muda o valor de um campo como se fosse digitado (o PJe usa máscaras e
  // eventos de teclado/alteração para ler o campo).
  function definirValor(el, valor) {
    const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, valor);
    for (const tipo of ['input', 'keyup', 'change']) el.dispatchEvent(new Event(tipo, { bubbles: true }));
  }

  function textoDoBotao(b) {
    if (b instanceof HTMLInputElement) return b.value || b.title || '';
    return b.innerText || b.getAttribute('title') || b.getAttribute('aria-label') || '';
  }

  // Só o que está escrito no botão (sem o título que aparece ao passar o mouse).
  const textoVisivel = (b) => (b instanceof HTMLInputElement ? b.value : b.innerText) || '';

  // Texto que identifica um campo: o <label> dele ou o texto que vem logo antes na tela.
  function rotulo(el, raiz = el.ownerDocument.body) {
    if (el.id) {
      const lab = el.ownerDocument.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (lab?.innerText.trim()) return lab.innerText.trim();
    }
    const dentro = el.closest('label');
    if (dentro?.innerText.trim()) return dentro.innerText.trim();
    const aria = el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('placeholder');
    // último texto antes do campo, dentro da raiz
    const andar = el.ownerDocument.createTreeWalker(raiz, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) =>
        n.textContent.trim() && !n.parentElement?.closest('select, option, script, style, button, textarea')
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT,
    });
    let ultimo = '';
    for (let n = andar.nextNode(); n; n = andar.nextNode()) {
      if (!(n.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)) break;
      ultimo = n.textContent.trim();
    }
    return ultimo || aria || '';
  }

  // ------------------------------------------------------------ consulta processos

  const ehTexto = (i) => /^(text|search|tel|number|)$/i.test(i.type) && !i.disabled && !i.readOnly;

  // O campo do número do processo: um campo só (com máscara) ou, em versões
  // antigas do PJe, seis campos separados (sequencial, dígito, ano...).
  function acharCampoNumero() {
    const campos = [...document.querySelectorAll('input')].filter((i) => ehTexto(i) && visivel(i));
    const porId = (re) => campos.find((i) => re.test(`${i.id} ${i.name}`));
    const seq = porId(/numeroSequencial/i);
    if (seq) {
      const partes = [seq, porId(/DigitoVerificador|numeroDigito/i), porId(/(:|\b)ano\b|NumeroAno/i), porId(/ramoJustica/i), porId(/respectivoTribunal/i), porId(/NumeroOrgaoJustica|orgaoJustica/i)];
      if (partes.every(Boolean)) return { tipo: 'partes', partes };
    }
    let melhor = null;
    let nota = 0;
    for (const i of campos) {
      const ident = `${i.id} ${i.name}`;
      const desc = norm(`${i.placeholder} ${i.title} ${i.getAttribute('aria-label') || ''} ${rotulo(i)}`);
      let p = 0;
      if (/num(ero)?_?processo|numProcesso|NumeroProcesso/i.test(ident)) p += 6;
      if (/processo/.test(desc)) p += 2;
      if (/numero|n[ºo°]/.test(desc)) p += 1;
      if (/_{7}-_{2}\.|\d{7}-\d{2}\./.test(i.placeholder || '')) p += 4;
      if (i.maxLength >= 20 && i.maxLength <= 30) p += 1;
      if (/cpf|cnpj|oab|nome|parte|advogad|data|classe|assunto|valor|documento|referencia/.test(desc) && !/processo/.test(desc)) p -= 6;
      if (p > nota) {
        melhor = i;
        nota = p;
      }
    }
    return nota >= 3 ? { tipo: 'unico', campo: melhor } : null;
  }

  function preencherNumero(achado, numero) {
    const d = soDigitos(numero);
    if (achado.tipo === 'partes') {
      const pedacos = [d.slice(0, 7), d.slice(7, 9), d.slice(9, 13), d.slice(13, 14), d.slice(14, 16), d.slice(16)];
      achado.partes.forEach((campo, i) => definirValor(campo, pedacos[i]));
      return achado.partes.every((campo, i) => soDigitos(campo.value) === pedacos[i]);
    }
    const campo = achado.campo;
    campo.focus();
    campo.select?.();
    // como colar com Ctrl+V: a máscara do campo recebe o texto normalmente
    try {
      document.execCommand('insertText', false, numero);
    } catch {
      // segue para o jeito direto
    }
    if (soDigitos(campo.value) !== d) definirValor(campo, numero);
    if (soDigitos(campo.value) !== d) definirValor(campo, d);
    campo.dispatchEvent(new Event('blur', { bubbles: true }));
    return soDigitos(campo.value) === d;
  }

  function acharBotao(re, raiz = document) {
    const candidatos = [...raiz.querySelectorAll('button, input[type=submit], input[type=button], a, [role=button]')].filter(visivel);
    return candidatos.find((b) => re.test(norm(textoDoBotao(b))));
  }

  function acharLinkDoProcesso(numero, ignorar) {
    const d = soDigitos(numero);
    return [...document.querySelectorAll('a')].find((a) => visivel(a) && !a.contains(ignorar) && soDigitos(a.textContent).includes(d));
  }

  // Endereço dos autos, quando ele está escrito no próprio link (no href ou
  // no "openPopUp(...)" do onclick). Só vale endereço de autos: o onclick do
  // PJe também pode ter o endereço da própria consulta (chamada AJAX).
  const RE_AUTOS = /ConsultaProcesso\/Detalhe|listProcessoCompleto|listAutosDigitais|[?&]ca=/i;
  function enderecoDoLink(a) {
    const href = (a.getAttribute('href') || '').trim();
    const candidatos = [];
    if (href && !/^(#|javascript:)/i.test(href)) candidatos.push(href);
    const codigo = `${a.getAttribute('onclick') || ''} ${href}`;
    for (const m of codigo.matchAll(/['"]([^'"\s]+\?[^'"\s]*)['"]/g)) candidatos.push(m[1]);
    const achado = candidatos.find((c) => RE_AUTOS.test(c));
    try {
      return achado ? new URL(achado, location.href).href : null;
    } catch {
      return null;
    }
  }

  const semResultado = () =>
    /nenhum (registro|resultado|processo)[^.]{0,40}encontrad|(^|\D)0 resultados? encontrad|nao foram encontrad|nao foi encontrad/.test(norm(document.body?.innerText));

  // ------------------------------------------------------------ autos do processo

  // A linha do tempo dos autos: a área com rolagem própria cheia de datas
  // ("15 jul. 2022") e documentos ("1117468269 - Manifestação").
  const RE_DATA = /\b\d{1,2}\s+(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)[a-z]*\.?\s+(de\s+)?\d{4}\b/gi;
  const RE_DOC = /\b\d{6,12}\s+-\s+\S/g;

  function candidatosLinha(doc, quadros, lista, nivel = 0) {
    const win = doc.defaultView;
    for (const el of doc.querySelectorAll('div, ul, ol, section, aside, nav, table, tbody')) {
      const oy = win.getComputedStyle(el).overflowY;
      if (oy !== 'auto' && oy !== 'scroll' && oy !== 'overlay') continue;
      if (el.clientHeight < 120 || !visivel(el)) continue;
      const texto = el.innerText || '';
      const nota =
        (texto.match(RE_DOC) || []).length +
        2 * (texto.match(RE_DATA) || []).length +
        (/timeline|linha.?(do.?)?tempo|eventos/i.test(`${el.id} ${el.className}`) ? 15 : 0);
      if (nota >= 3) lista.push({ el, nota, quadros });
    }
    if (nivel >= 3) return lista;
    [...doc.querySelectorAll('iframe, frame')].forEach((q, i) => {
      let interno = null;
      try {
        interno = q.contentDocument;
      } catch {
        // quadro de outro site
      }
      if (interno?.body && visivel(q)) candidatosLinha(interno, [...quadros, i], lista, nivel + 1);
    });
    return lista;
  }

  function acharLinhaDoTempo() {
    const lista = candidatosLinha(document, [], []);
    if (!lista.length) return null;
    lista.sort((a, b) => b.nota - a.nota);
    let melhor = lista[0];
    // se a melhor área contém outra quase tão boa, a de dentro é a lista em si
    for (;;) {
      const dentro = lista.find((c) => c !== melhor && melhor.el.contains(c.el) && c.nota >= melhor.nota * 0.7);
      if (!dentro) break;
      melhor = dentro;
    }
    return melhor;
  }

  // Reaproveita a rolagem dos prints: guarda também datas de trechos que o
  // PJe possa retirar do DOM ao carregar outros eventos.
  let linhaDownload = null;
  let periodoDownload = null;
  const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

  function dataDoCabecalho(texto) {
    const t = norm(texto);
    const escrita = t.match(/^(\d{1,2})\s+(?:de\s+)?(jan[a-z]*|fev[a-z]*|mar[a-z]*|abr[a-z]*|mai[a-z]*|jun[a-z]*|jul[a-z]*|ago[a-z]*|set[a-z]*|out[a-z]*|nov[a-z]*|dez[a-z]*)\.?\s+(?:de\s+)?(\d{4})$/);
    const numerica = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    const m = escrita || numerica;
    if (!m) return null;
    const dia = Number(m[1]);
    const mes = escrita ? MESES.indexOf(m[2].slice(0, 3)) + 1 : Number(m[2]);
    const ano = Number(m[3]);
    const data = new Date(ano, mes - 1, dia);
    if (data.getFullYear() !== ano || data.getMonth() !== mes - 1 || data.getDate() !== dia) return null;
    return `${m[3]}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
  }

  const dataBr = (iso) => iso.split('-').reverse().join('/');

  function registrarPeriodoDownload() {
    if (!linhaDownload?.isConnected) linhaDownload = acharLinhaDoTempo()?.el;
    if (linhaDownload) {
      for (const el of linhaDownload.querySelectorAll('*')) {
        // Só cabeçalhos inteiros, nunca datas mencionadas dentro de uma
        // movimentação ("transitado em ...", prazos, texto de petições etc.).
        if (!visivel(el)) continue;
        const data = dataDoCabecalho(el.innerText || '');
        if (!data) continue;
        const pai = el.parentElement;
        if (pai && pai !== linhaDownload && !(pai.innerText || '').split(/\r?\n/).some((trecho) => dataDoCabecalho(trecho) === data)) continue;
        if (!periodoDownload) periodoDownload = { inicio: data, fim: data };
        else {
          if (data < periodoDownload.inicio) periodoDownload.inicio = data;
          if (data > periodoDownload.fim) periodoDownload.fim = data;
        }
      }
    }
    return periodoDownload ? { inicio: dataBr(periodoDownload.inicio), fim: dataBr(periodoDownload.fim) } : null;
  }

  // Um elemento clicável com "download" no título/ícone (o do topo, que baixa os autos).
  function acharIconeDownload() {
    const vistos = new Set();
    let melhor = null;
    let nota = -Infinity;
    for (const el of document.querySelectorAll('a, button, [role=button], i, span, img')) {
      const alvo = el.closest('a, button, [role=button]') || el;
      if (vistos.has(alvo) || !visivel(alvo)) continue;
      const descricao = `${alvo.getAttribute('title') || ''} ${alvo.getAttribute('aria-label') || ''} ${el.getAttribute('alt') || ''} ${el.getAttribute('title') || ''} ${alvo.className || ''} ${el.className || ''} ${alvo.innerText || ''}`;
      if (!/download|baixar/i.test(descricao)) continue;
      if (norm(textoVisivel(alvo)) === 'download') continue; // é o botão final do painel
      vistos.add(alvo);
      const r = alvo.getBoundingClientRect();
      let p = 0;
      if (/autos|processo|completo|integra/i.test(descricao)) p += 3;
      if (/documento/i.test(descricao) && !/processo|autos/i.test(descricao)) p -= 3;
      if (/fa-download|download/i.test(`${alvo.className} ${el.className}`)) p += 1;
      p -= r.top / 100; // o do topo da página primeiro
      if (p > nota) {
        melhor = alvo;
        nota = p;
      }
    }
    return melhor;
  }

  // O quadro do painel de download: o bloco em volta do botão que também tem os campos.
  function painelDe(botao) {
    for (let n = botao.parentElement; n && n !== document.body; n = n.parentElement) {
      const selects = [...n.querySelectorAll('select')].length;
      const campos = [...n.querySelectorAll('input')].filter((i) => ehTexto(i)).length;
      if (selects >= 2 || (selects >= 1 && campos >= 1)) return n;
    }
    return null;
  }

  // O botão DOWNLOAD do painel (visível e com campos em volta).
  function botaoDownloadFinal() {
    const botoes = [...document.querySelectorAll('button, input[type=submit], input[type=button], a, [role=button]')];
    return botoes.find((b) => visivel(b) && norm(textoVisivel(b)) === 'download' && painelDe(b));
  }

  function opcao(select, re) {
    return [...select.options].find((o) => re.test(norm(o.text)));
  }

  // O "Até" do período é diferente do "Até" da faixa de ID. Localiza o
  // par a partir de "Período de", inclusive quando os dois rótulos vêm
  // antes dos dois inputs no HTML (painel em colunas).
  function camposPeriodo(painel) {
    const campos = [...painel.querySelectorAll('input')].filter((i) =>
      /^(text|search|tel|date|)$/i.test(i.type) && !i.disabled && !i.readOnly && visivel(i));
    const textos = document.createTreeWalker(painel, NodeFilter.SHOW_TEXT);
    for (let n = textos.nextNode(); n; n = textos.nextNode()) {
      if (!/^periodo(?: de)?$/.test(norm(n.textContent)) || !visivel(n.parentElement)) continue;
      const label = n.parentElement.closest('label');
      const associado = label?.htmlFor ? document.getElementById(label.htmlFor) : null;
      const inicio = campos.includes(associado) ? associado : campos.find((i) => n.compareDocumentPosition(i) & Node.DOCUMENT_POSITION_FOLLOWING);
      const fim = campos[campos.indexOf(inicio) + 1];
      if (inicio && fim) return { inicio, fim };
    }
    throw new Error('não achei os campos "Período de" e "Até" do período no painel de download.');
  }

  function valorData(campo, iso) {
    return campo.type === 'date' ? iso : dataBr(iso);
  }

  // Inteiro teor no intervalo completo da linha do tempo, sem faixa de ID
  // nem tipo de documento, crescente e incluindo expediente e movimentos.
  function ajustarCampos(painel) {
    const feito = [];
    const periodo = camposPeriodo(painel);
    for (const campo of painel.querySelectorAll('input')) {
      if (campo === periodo.inicio || campo === periodo.fim) continue;
      if (!/^(text|search|tel|number|date|)$/i.test(campo.type) || campo.disabled) continue;
      // vazio ou só a máscara ("__/__/____"): nada a limpar
      if (!visivel(campo) || !/\d/.test(campo.value)) continue;
      const nome = rotulo(campo, painel);
      definirValor(campo, '');
      campo.dispatchEvent(new Event('blur', { bubbles: true }));
      feito.push(`campo "${nome}" esvaziado`);
    }
    for (const sel of painel.querySelectorAll('select')) {
      if (sel.disabled || !visivel(sel.parentElement || sel)) continue;
      const nome = norm(rotulo(sel, painel));
      let alvo = null;
      if (/cronologia|ordem/.test(nome)) alvo = opcao(sel, /^crescente$/);
      else if (/expediente|movimento/.test(nome)) alvo = opcao(sel, /^sim$/);
      else if (/tipo/.test(nome) && sel.options[0] && /selecione|todos|^$/.test(norm(sel.options[0].text))) alvo = sel.options[0];
      if (alvo && sel.value !== alvo.value) {
        definirValor(sel, alvo.value);
        feito.push(`"${rotulo(sel, painel)}" = ${alvo.text.trim()}`);
      }
    }
    for (const parte of ['inicio', 'fim']) {
      const campo = periodo[parte];
      const valor = valorData(campo, periodoDownload[parte]);
      if (campo.value === valor) continue;
      definirValor(campo, valor);
      campo.dispatchEvent(new Event('blur', { bubbles: true }));
      feito.push(`período ${parte} = ${valor}`);
    }
    return feito;
  }

  function conferirCamposDownload(painel) {
    const periodo = camposPeriodo(painel);
    for (const parte of ['inicio', 'fim']) {
      if (periodo[parte].value !== valorData(periodo[parte], periodoDownload[parte])) {
        throw new Error('o PJe não manteve as datas nos campos do período de download.');
      }
    }
    for (const nome of ['expediente', 'movimentos']) {
      const sel = [...painel.querySelectorAll('select')].find((s) => !s.disabled && visivel(s.parentElement || s) && norm(rotulo(s, painel)).includes(nome));
      if (!sel || !/^sim$/.test(norm(sel.selectedOptions[0]?.text))) {
        throw new Error(`não consegui selecionar "Sim" em "Incluir ${nome}".`);
      }
    }
  }

  function lerCampos(painel) {
    const valores = {};
    for (const el of painel.querySelectorAll('input, select')) {
      if (el.type === 'hidden' || !visivel(el.parentElement || el)) continue;
      const nome = rotulo(el, painel);
      if (el.type === 'checkbox') valores[nome] = el.checked;
      else if (el instanceof HTMLSelectElement) valores[nome] = el.selectedOptions[0]?.text.trim() ?? '';
      else valores[nome] = el.value;
    }
    return valores;
  }

  // ------------------------------------------------------------ API

  const api = {
    iniciarPeriodoDownload() {
      periodoDownload = null;
      linhaDownload = acharLinhaDoTempo()?.el;
      return registrarPeriodoDownload();
    },

    registrarPeriodoDownload,

    // Na tela "Consulta processos": cola o número, pesquisa e espera o resultado.
    // Devolve { ok, url } (url = endereço dos autos, se estiver no link) ou { erro }.
    async pesquisar({ numero, tempo = 45000 }) {
      const achado = acharCampoNumero();
      if (!achado) return { ok: false, semCampo: true };
      const campo = achado.tipo === 'unico' ? achado.campo : achado.partes[0];
      // resultado de uma pesquisa anterior com este mesmo número já na tela
      const ja = acharLinkDoProcesso(numero, campo);
      if (!preencherNumero(achado, numero)) return { ok: false, erro: `não consegui escrever o número no campo da consulta (ficou "${campo.value}").` };
      if (!ja) {
        const botao = acharBotao(/^pesquisar$/, campo.form || document) || acharBotao(/^pesquisar$/) || acharBotao(/pesquisar|buscar|consultar/);
        if (botao) botao.click();
        else if (campo.form?.requestSubmit) campo.form.requestSubmit();
        else return { ok: false, erro: 'não achei o botão PESQUISAR na tela de consulta.' };
      }
      const inicio = Date.now();
      const link = await esperarAte(() => acharLinkDoProcesso(numero, campo) || (Date.now() - inicio > 6000 && semResultado() ? 'nada' : null), tempo, 400);
      if (!link) return { ok: false, erro: `a consulta não mostrou o processo em ${Math.round(tempo / 1000)} s.` };
      if (link === 'nada') return { ok: false, erro: 'a consulta do PJe não encontrou este processo (pode estar em outro grau ou sistema, ou com sigilo).' };
      return { ok: true, url: enderecoDoLink(link) };
    },

    // Clica no número do processo no resultado da consulta (abre os autos).
    clicarResultado({ numero }) {
      const link = acharLinkDoProcesso(numero);
      if (!link) return { ok: false, erro: 'o link do processo sumiu da tela de consulta.' };
      link.click();
      return { ok: true };
    },

    // Nos autos: espera a página montar. Devolve se o número confere e se achou a linha do tempo.
    async esperarAutos({ numero, tempo = 60000 }) {
      const d = soDigitos(numero);
      const pronto = await esperarAte(
        () => document.readyState === 'complete' && (acharLinhaDoTempo() || acharIconeDownload()) && soDigitos(`${document.title} ${document.body?.innerText.slice(0, 5000)}`).includes(d),
        tempo,
        500,
      );
      return {
        ok: Boolean(pronto),
        numeroConfere: soDigitos(`${document.title} ${document.body?.innerText.slice(0, 5000)}`).includes(d),
        titulo: document.title,
      };
    },

    // Marca a linha do tempo para a captura (pagina.js reencontra pelo seletor).
    marcarLinhaDoTempo() {
      for (const el of document.querySelectorAll('[data-passivo-linha]')) el.removeAttribute('data-passivo-linha');
      const achada = acharLinhaDoTempo();
      if (!achada) return { achou: false };
      achada.el.setAttribute('data-passivo-linha', '1');
      // onde ela está na tela (para recortar o print quando ela não rola)
      const r = achada.el.getBoundingClientRect();
      let x = r.left;
      let y = r.top;
      for (let w = achada.el.ownerDocument.defaultView; w !== window && w.frameElement; w = w.parent) {
        const q = w.frameElement.getBoundingClientRect();
        x += q.left + w.frameElement.clientLeft;
        y += q.top + w.frameElement.clientTop;
      }
      const esq = Math.max(0, Math.round(x));
      const topo = Math.max(0, Math.round(y));
      return {
        achou: true,
        rola: achada.el.scrollHeight - achada.el.clientHeight > 20,
        retangulo: { x: esq, y: topo, w: Math.min(innerWidth, Math.round(x + r.width)) - esq, h: Math.min(innerHeight, Math.round(y + r.height)) - topo },
        lembranca: { tipo: 'elemento', quadros: achada.quadros, seletor: '[data-passivo-linha="1"]' },
      };
    },

    // Abre o painel de download (ícone no topo dos autos) e ajusta os campos.
    async prepararDownload() {
      if (!registrarPeriodoDownload()) return { ok: false, erro: 'não consegui identificar as datas da linha do tempo para preencher o período do download.' };
      let botao = botaoDownloadFinal();
      if (!botao) {
        const icone = acharIconeDownload();
        if (!icone) return { ok: false, erro: 'não achei o ícone de download dos autos no topo da página.' };
        icone.click();
        botao = await esperarAte(botaoDownloadFinal, 10000);
        if (!botao) return { ok: false, erro: 'cliquei no ícone de download, mas o painel com o botão DOWNLOAD não apareceu.' };
      }
      // trocar uma opção pode fazer o PJe redesenhar o painel: ajusta, espera e confere de novo
      try {
        const feito = ajustarCampos(painelDe(botao));
        await esperar(feito.length ? 1500 : 300);
        botao = await esperarAte(botaoDownloadFinal, 5000);
        if (!botao) return { ok: false, erro: 'o painel de download sumiu depois de ajustar os campos.' };
        const refeitos = ajustarCampos(painelDe(botao));
        feito.push(...refeitos);
        if (refeitos.length) {
          await esperar(1500);
          botao = await esperarAte(botaoDownloadFinal, 5000);
          if (!botao) return { ok: false, erro: 'o painel de download sumiu depois de ajustar os campos.' };
        }
        conferirCamposDownload(painelDe(botao));
        return { ok: true, feito, periodo: registrarPeriodoDownload(), campos: lerCampos(painelDe(botao)) };
      } catch (e) {
        return { ok: false, erro: e.message };
      }
    },

    clicarDownload() {
      const botao = botaoDownloadFinal();
      if (!botao) return { ok: false, erro: 'o botão DOWNLOAD não está mais na tela.' };
      botao.click();
      return { ok: true };
    },

    // Mensagens que o PJe mostra (avisos, erros, "aguarde"...).
    mensagens() {
      const seletores = '.rich-messages, .rich-message, .ui-messages, [role=alert], .alert, .msg, .mensagem, .modal.in, .modal.show, .rich-mpnl-body, .toast, .growl';
      return [...document.querySelectorAll(seletores)]
        .filter(visivel)
        .map((el) => el.innerText.replace(/\s+/g, ' ').trim().slice(0, 400))
        .filter(Boolean);
    },

    estado() {
      return { url: location.href, titulo: document.title, visivel: document.visibilityState };
    },
  };

  globalThis.__passivoPje = Object.freeze(api);
})();
