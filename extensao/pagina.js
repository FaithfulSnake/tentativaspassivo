// Copiado sem mudanças da extensão Ferramentas Fanjas 1.5.2 (pagina.js).
// Roda dentro da página que vai ser capturada: é injetado pela extensão e
// também embutido no script sem instalação. Expõe globalThis.__clippingPrints,
// que rola a página e mede o quanto da área visível está coberto por
// cabeçalhos/rodapés fixos (para nenhum trecho de texto ficar escondido).
(() => {
  if (globalThis.__clippingPrints) return;

  // Uma área com rolagem própria (painel interno) só é usada se ocupar pelo
  // menos esta fração da tela.
  const AREA_MINIMA = 0.15;
  // Cabeçalhos/rodapés fixos: só contam se estiverem neste trecho do topo ou
  // da base da área visível e não forem mais altos que metade dela.
  const FAIXA_BORDA = 0.25;
  // Nunca considerar mais que isto da área visível como coberto.
  const COBERTURA_MAXIMA = 0.6;

  let estado = null;
  // Área de rolagem escolhida na página pelo seletor (seletor.js), usada na próxima captura.
  let escolhida = null;

  // Percorre todos os elementos, inclusive dentro de shadow DOM aberto.
  function* elementos(raiz) {
    const pilha = [raiz];
    while (pilha.length) {
      for (const el of pilha.pop().querySelectorAll('*')) {
        yield el;
        if (el.shadowRoot) pilha.push(el.shadowRoot);
      }
    }
  }

  function ehAncestral(a, b) {
    for (let n = b; n; n = n.parentNode || n.host) if (n === a) return true;
    return false;
  }

  function areaVisivel(r, win) {
    const w = Math.min(r.right, win.innerWidth) - Math.max(r.left, 0);
    const h = Math.min(r.bottom, win.innerHeight) - Math.max(r.top, 0);
    return w > 0 && h > 0 ? w * h : 0;
  }

  function rolarJanelaPara(win, y) {
    win.scrollTo({ top: y, left: win.scrollX, behavior: 'instant' });
  }

  function rolagemJanela(win) {
    const doc = win.document;
    const raiz = () => doc.scrollingElement || doc.documentElement;
    return {
      tipo: win === window ? 'janela' : 'quadro',
      win,
      doc,
      el: null,
      topo: () => win.scrollY,
      rolar: (y) => rolarJanelaPara(win, y),
      maximo: () => Math.max(0, raiz().scrollHeight - raiz().clientHeight),
      regiao: () => ({ top: 0, left: 0, bottom: raiz().clientHeight, right: raiz().clientWidth }),
      alvosEstilo: [doc.documentElement, doc.body].filter(Boolean),
    };
  }

  function rolagemElemento(el) {
    const win = el.ownerDocument.defaultView;
    return {
      tipo: 'elemento',
      win,
      doc: el.ownerDocument,
      el,
      topo: () => el.scrollTop,
      rolar: (y) => el.scrollTo({ top: y, left: el.scrollLeft, behavior: 'instant' }),
      maximo: () => Math.max(0, el.scrollHeight - el.clientHeight),
      regiao: () => {
        const r = el.getBoundingClientRect();
        const top = r.top + el.clientTop;
        const left = r.left + el.clientLeft;
        return {
          top: Math.max(0, top),
          left: Math.max(0, left),
          bottom: Math.min(win.innerHeight, top + el.clientHeight),
          right: Math.min(win.innerWidth, left + el.clientWidth),
        };
      },
      alvosEstilo: [el],
    };
  }

  // Quanto a janela consegue rolar (0 se overflow:hidden no html/body impede).
  function alcanceJanela(win) {
    const raiz = win.document.scrollingElement || win.document.documentElement;
    if (!raiz) return 0;
    const alcance = raiz.scrollHeight - raiz.clientHeight;
    if (alcance < 1) return 0;
    const y = win.scrollY;
    if (y > 0) return alcance;
    rolarJanelaPara(win, 1);
    const rolou = win.scrollY > 0;
    rolarJanelaPara(win, y);
    return rolou ? alcance : 0;
  }

  // Deslocamento de uma janela (quadro/iframe) em relação à janela principal.
  function deslocamento(win) {
    let x = 0;
    let y = 0;
    for (let w = win; w && w !== window && w.frameElement; w = w.parent) {
      const quadro = w.frameElement;
      const r = quadro.getBoundingClientRect();
      x += r.left + quadro.clientLeft;
      y += r.top + quadro.clientTop;
    }
    return { x, y };
  }

  // Região de uma área de rolagem em coordenadas da tela (janela principal), cortada pela tela.
  function regiaoNaTela(sc) {
    const r = sc.regiao();
    const d = deslocamento(sc.win);
    return {
      top: Math.max(0, r.top + d.y),
      left: Math.max(0, r.left + d.x),
      bottom: Math.min(innerHeight, r.bottom + d.y),
      right: Math.min(innerWidth, r.right + d.x),
    };
  }

  // Parte da área que rola que entra no print. Com recorte, só o que fica
  // dentro dele: a rolagem passa a andar pela altura do recorte.
  function regiaoUtil(sc) {
    const reg = sc.regiao();
    const corte = estado?.recorte;
    if (!corte) return reg;
    const d = deslocamento(sc.win);
    const util = {
      top: Math.max(reg.top, corte.y - d.y),
      left: Math.max(reg.left, corte.x - d.x),
      bottom: Math.min(reg.bottom, corte.y + corte.h - d.y),
      right: Math.min(reg.right, corte.x + corte.w - d.x),
    };
    // recorte fora da área que rola: a rolagem segue pela área inteira
    return util.bottom - util.top >= 20 && util.right - util.left >= 20 ? util : reg;
  }

  // Recorte final em coordenadas da tela: a área que rola ou a região marcada.
  function definirRecorte(config, sc) {
    let r = null;
    if (config?.modo === 'area') r = regiaoNaTela(sc);
    else if (config?.modo === 'regiao' && config.retangulo) {
      const q = config.retangulo;
      r = { top: q.y, left: q.x, bottom: q.y + q.h, right: q.x + q.w };
    }
    if (!r) return null;
    const x = Math.max(0, Math.round(r.left));
    const y = Math.max(0, Math.round(r.top));
    const w = Math.min(innerWidth, Math.round(r.right)) - x;
    const h = Math.min(innerHeight, Math.round(r.bottom)) - y;
    return w >= 20 && h >= 20 ? { x, y, w, h } : null;
  }

  // Elemento mais interno no ponto (x, y) da tela, entrando em quadros do
  // mesmo site e em shadow DOM aberto. "ignorar" é a camada do seletor.
  function elementoNoPonto(x, y, ignorar) {
    const valido = (e) => !ignorar || !ehAncestral(ignorar, e);
    let doc = document;
    let dx = 0;
    let dy = 0;
    let achado = null;
    for (let nivel = 0; nivel < 5; nivel++) {
      let el = doc.elementsFromPoint(x - dx, y - dy).find(valido);
      while (el?.shadowRoot) {
        const dentro = el.shadowRoot.elementsFromPoint(x - dx, y - dy).find((e) => e !== el && valido(e));
        if (!dentro) break;
        el = dentro;
      }
      if (!el) break;
      achado = el;
      if (el.tagName !== 'IFRAME' && el.tagName !== 'FRAME') break;
      let interno = null;
      try {
        interno = el.contentDocument;
      } catch {
        // quadro de outro domínio: fica no próprio quadro
      }
      if (!interno?.documentElement) break;
      const r = el.getBoundingClientRect();
      dx += r.left + el.clientLeft;
      dy += r.top + el.clientTop;
      doc = interno;
    }
    return achado;
  }

  // Sobe um nível, saindo do shadow DOM pelo elemento hospedeiro.
  function subir(n) {
    if (n.parentElement) return n.parentElement;
    const raiz = n.getRootNode?.();
    return raiz && raiz !== n && raiz.host ? raiz.host : null;
  }

  function elementoRola(n) {
    if (n.scrollHeight - n.clientHeight <= 20) return false;
    const oy = n.ownerDocument.defaultView.getComputedStyle(n).overflowY;
    return oy === 'auto' || oy === 'scroll' || oy === 'overlay';
  }

  // A área que rola a partir de um elemento: o ancestral mais próximo com
  // rolagem própria; senão o documento (do quadro ou da página).
  function rolagemDe(el) {
    for (let n = el; n; n = subir(n)) {
      const doc = n.ownerDocument;
      if (n === doc.documentElement || n === doc.body) break;
      if (elementoRola(n)) return rolagemElemento(n);
    }
    const doc = el.ownerDocument;
    const win = doc.defaultView;
    if (janelaRola(win)) return rolagemJanela(win);
    if (doc.body && elementoRola(doc.body)) return rolagemElemento(doc.body); // html com overflow:hidden
    if (win !== window && win.frameElement) return rolagemDe(win.frameElement);
    return null;
  }

  function caminhoDeQuadros(win) {
    const caminho = [];
    for (let w = win; w && w !== window && w.frameElement; w = w.parent) {
      caminho.unshift([...w.parent.document.querySelectorAll('iframe, frame')].indexOf(w.frameElement));
    }
    return caminho;
  }

  function janelaDoCaminho(caminho) {
    let win = window;
    for (const i of caminho) {
      try {
        const quadro = win.document.querySelectorAll('iframe, frame')[i];
        if (!quadro?.contentDocument) return null;
        win = quadro.contentWindow;
      } catch {
        return null;
      }
    }
    return win;
  }

  // Seletor CSS para achar o mesmo elemento numa próxima visita ao site.
  function seletorCss(el) {
    if (el.getRootNode() !== el.ownerDocument) return null; // dentro de shadow DOM
    const partes = [];
    for (let n = el; n && n !== n.ownerDocument.documentElement; n = n.parentElement) {
      if (n.id && n.ownerDocument.querySelectorAll(`#${CSS.escape(n.id)}`).length === 1) {
        partes.unshift(`#${CSS.escape(n.id)}`);
        return partes.join(' > ');
      }
      const tag = n.tagName.toLowerCase();
      const irmaos = [...(n.parentElement?.children || [])].filter((c) => c.tagName === n.tagName);
      partes.unshift(irmaos.length > 1 ? `${tag}:nth-of-type(${irmaos.indexOf(n) + 1})` : tag);
    }
    return `html > ${partes.join(' > ')}`;
  }

  // Resumo de uma área para o seletor mostrar na tela.
  function descrever(sc) {
    const r = regiaoNaTela(sc);
    const conteudo = Math.round(sc.maximo() + (sc.regiao().bottom - sc.regiao().top));
    return {
      area: sc,
      pagina: sc.tipo === 'janela',
      retangulo: { x: r.left, y: r.top, w: r.right - r.left, h: r.bottom - r.top },
      conteudo,
      rola: sc.maximo() > 0,
    };
  }

  // A janela rola? Sem mexer na rolagem (o seletor chama isto a cada
  // movimento do mouse): olha o tamanho e o overflow que vale para a página.
  function janelaRola(win) {
    const doc = win.document;
    const raiz = doc.scrollingElement || doc.documentElement;
    if (!raiz || raiz.scrollHeight - raiz.clientHeight < 1) return false;
    const overflow = (el) => (el ? win.getComputedStyle(el).overflowY : 'visible');
    const html = overflow(doc.documentElement);
    const daPagina = html !== 'visible' ? html : overflow(doc.body);
    return daPagina !== 'hidden' && daPagina !== 'clip';
  }

  // Decide o que rolar: a página em si ou, em sites que rolam um painel
  // interno (ou um quadro/iframe do mesmo site), o maior desses painéis.
  function acharRolagem() {
    if (alcanceJanela(window) > innerHeight * 0.25) return rolagemJanela(window);

    let melhor = null;
    let melhorArea = 0;
    const considerar = (r, area) => {
      if (area > melhorArea) {
        melhor = r;
        melhorArea = area;
      }
    };
    (function varrer(doc, nivel) {
      const win = doc.defaultView;
      for (const el of elementos(doc)) {
        if (el.tagName === 'IFRAME' || el.tagName === 'FRAME') {
          let interno = null;
          try {
            interno = el.contentDocument;
          } catch {
            // quadro de outro domínio: inacessível
          }
          if (!interno?.documentElement || nivel >= 3) continue;
          const area = areaVisivel(el.getBoundingClientRect(), win);
          if (!area) continue;
          if (alcanceJanela(interno.defaultView) > 20) considerar(rolagemJanela(interno.defaultView), area);
          varrer(interno, nivel + 1);
        } else if (el.scrollHeight - el.clientHeight > 20) {
          const oy = win.getComputedStyle(el).overflowY;
          if (oy === 'auto' || oy === 'scroll' || oy === 'overlay') {
            considerar(rolagemElemento(el), areaVisivel(el.getBoundingClientRect(), win));
          }
        }
      }
    })(document, 0);

    if (melhor && melhorArea >= innerWidth * innerHeight * AREA_MINIMA) return melhor;
    return rolagemJanela(window);
  }

  // Elementos fixos/grudados (position fixed/sticky) em faixa no topo ou na
  // base da área visível. "presa" = está realmente parada na borda (fixed,
  // ou sticky já grudado), ou seja, não é conteúdo no fluxo normal do texto.
  function faixas(sc) {
    const reg = regiaoUtil(sc);
    const h = reg.bottom - reg.top;
    const lista = [];
    if (h <= 0) return { reg, h, lista };
    for (const el of elementos(sc.doc)) {
      const cs = sc.win.getComputedStyle(el);
      if (cs.position !== 'fixed' && cs.position !== 'sticky') continue;
      if (el.id === 'clipping-seletor') continue;
      if (cs.display === 'none' || cs.visibility !== 'visible' || parseFloat(cs.opacity) === 0) continue;
      if (sc.el && ehAncestral(el, sc.el)) continue;
      const r = el.getBoundingClientRect();
      if (r.right <= reg.left || r.left >= reg.right) continue;
      const t = Math.max(r.top, reg.top);
      const b = Math.min(r.bottom, reg.bottom);
      if (b - t < 1 || b - t > h / 2) continue;
      let lado;
      if (t - reg.top <= h * FAIXA_BORDA && t - reg.top <= reg.bottom - b) lado = 'topo';
      else if (reg.bottom - b <= h * FAIXA_BORDA) lado = 'base';
      else continue;
      let presa = cs.position === 'fixed';
      if (!presa) {
        const deslocamento = parseFloat(lado === 'topo' ? cs.top : cs.bottom);
        const distancia = lado === 'topo' ? r.top - (reg.top + deslocamento) : reg.bottom - deslocamento - r.bottom;
        presa = Number.isFinite(deslocamento) && Math.abs(distancia) < 2;
      }
      lista.push({ el, lado, t, b, presa });
    }
    return { reg, h, lista };
  }

  // Aplica um estilo !important guardando o valor original para restaurar.
  function definirEstilo(el, prop, valor) {
    let salvos = estado.estilos.get(el);
    if (!salvos) estado.estilos.set(el, (salvos = new Map()));
    if (!salvos.has(prop)) salvos.set(prop, [el.style.getPropertyValue(prop), el.style.getPropertyPriority(prop)]);
    el.style.setProperty(prop, valor, 'important');
  }

  function restaurarEstilos() {
    const restaurar = (el, prop, [valor, prioridade]) => {
      if (valor) el.style.setProperty(prop, valor, prioridade);
      else el.style.removeProperty(prop);
    };
    // Primeiro tudo menos "transition", para os elementos reaparecerem de uma
    // vez em vez de com animação; depois a transição original.
    for (const [el, salvos] of estado.estilos) {
      for (const [prop, salvo] of salvos) if (prop !== 'transition') restaurar(el, prop, salvo);
      if (salvos.has('transition')) el.ownerDocument.defaultView.getComputedStyle(el).opacity; // aplica antes de religar a transição
    }
    for (const [el, salvos] of estado.estilos) if (salvos.has('transition')) restaurar(el, 'transition', salvos.get('transition'));
  }

  // Espera o navegador pintar a tela (com limite, caso a aba esteja oculta).
  function aguardarPintura() {
    return new Promise((pronto) => {
      const limite = setTimeout(pronto, 300);
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          clearTimeout(limite);
          pronto();
        }),
      );
    });
  }

  function exigirEstado() {
    if (!estado) throw new Error('Captura não iniciada nesta página.');
    return estado;
  }

  const api = {
    // config (opcional): { usarEscolhida, recorte: { modo: 'tela'|'area'|'regiao', retangulo } }
    iniciar(config) {
      if (estado) api.finalizar();
      const sc = (config?.usarEscolhida && escolhida) || acharRolagem();
      escolhida = null;
      estado = { sc, topoOriginal: sc.topo(), estilos: new Map(), recorte: null };
      for (const el of sc.alvosEstilo) {
        definirEstilo(el, 'scroll-behavior', 'auto');
        definirEstilo(el, 'scroll-snap-type', 'none');
      }
      estado.recorte = definirRecorte(config?.recorte, sc);
      const reg = regiaoUtil(sc);
      return {
        tipo: sc.tipo,
        max: sc.maximo(),
        altura: Math.round(reg.bottom - reg.top),
        recorte: estado.recorte,
        janela: { largura: innerWidth, altura: innerHeight },
      };
    },

    // --- usado pelo seletor da página (seletor.js) ---

    // Área que rola sob o ponto (x, y) da tela; onde nada rola, a página.
    areaNoPonto(x, y, ignorar) {
      const el = elementoNoPonto(x, y, ignorar);
      return descrever((el && rolagemDe(el)) || rolagemJanela(window));
    },

    // Área que a extensão escolheria sozinha.
    areaAutomatica() {
      return descrever(acharRolagem());
    },

    // Guarda a área para a captura que vai começar (null volta ao automático).
    escolherArea(descricao) {
      escolhida = descricao?.area || null;
    },

    // Elemento da área escolhida (para o leitor da matéria procurar só dentro dele).
    elementoEscolhido() {
      if (!escolhida) return null;
      return escolhida.el || (escolhida.tipo === 'quadro' ? escolhida.doc.body : null);
    },

    // Forma de reencontrar a área numa próxima captura neste site.
    lembranca(descricao) {
      const sc = descricao.area;
      if (sc.tipo === 'janela') return { tipo: 'janela' };
      const quadros = caminhoDeQuadros(sc.win);
      if (sc.tipo === 'quadro') return { tipo: 'quadro', quadros };
      const seletor = seletorCss(sc.el);
      return seletor ? { tipo: 'elemento', quadros, seletor } : null;
    },

    // Reencontra a área lembrada (se ela ainda existe e rola).
    areaLembrada(lembranca) {
      if (!lembranca) return null;
      if (lembranca.tipo === 'janela') return descrever(rolagemJanela(window));
      const win = janelaDoCaminho(lembranca.quadros || []);
      if (!win) return null;
      if (lembranca.tipo === 'quadro') return janelaRola(win) ? descrever(rolagemJanela(win)) : null;
      let el = null;
      try {
        el = win.document.querySelector(lembranca.seletor);
      } catch {
        return null;
      }
      return el && elementoRola(el) ? descrever(rolagemElemento(el)) : null;
    },

    rolarPara(y) {
      const { sc } = exigirEstado();
      sc.rolar(y);
      return sc.topo();
    },

    maximo() {
      return exigirEstado().sc.maximo();
    },

    // Prepara a tela para um print e devolve as medidas usadas para calcular
    // a próxima rolagem. Com esconder=true, oculta cabeçalhos/rodapés presos
    // na borda (o 1º print sempre sai com eles, então nada se perde).
    async prepararPrint(esconder) {
      const { sc } = exigirEstado();
      if (esconder) {
        for (const f of faixas(sc).lista) {
          if (!f.presa) continue;
          definirEstilo(f.el, 'transition', 'none');
          definirEstilo(f.el, 'opacity', '0');
        }
      }
      const { reg, h, lista } = faixas(sc);
      let topo = 0;
      let base = 0;
      for (const f of lista) {
        if (f.lado === 'topo') topo = Math.max(topo, f.b - reg.top);
        else base = Math.max(base, reg.bottom - f.t);
      }
      if (topo + base > h * COBERTURA_MAXIMA) {
        const k = (h * COBERTURA_MAXIMA) / (topo + base);
        topo *= k;
        base *= k;
      }
      await aguardarPintura();
      const d = deslocamento(sc.win);
      return {
        topo: sc.topo(),
        max: sc.maximo(),
        altura: Math.round(h),
        ocupadoTopo: Math.ceil(topo),
        ocupadoBase: Math.ceil(base),
        janela: { largura: innerWidth, altura: innerHeight },
        // onde ficam, na tela, a parte que entra no print e a área que rola (para o OCR)
        regiaoTopo: Math.round(reg.top + d.y),
        rolagemTopo: Math.round(sc.regiao().top + d.y),
      };
    },

    finalizar() {
      escolhida = null;
      if (!estado) return;
      restaurarEstilos();
      estado.sc.rolar(estado.topoOriginal);
      estado = null;
    },
  };

  globalThis.__clippingPrints = Object.freeze(api);
})();
