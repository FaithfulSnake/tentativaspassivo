// O laço de captura com rolagem, copiado da extensão Ferramentas Fanjas 1.5.2
// (comum.js, capturarComRolagem): rola do topo ao fim e tira um print por trecho.
//   pagina(metodo, arg)   chama a API de pagina.js na aba
//   configPagina          o que pagina.js usa ao iniciar (área escolhida, recorte)
//   tirarPrint(m, inicio) devolve o print (ou null = parar)
//   antesDoPrint()        espera a aba estar visível, etc.
//   aoCapturar(print, n, porcento, medidas)
//   deveParar()           true quando o usuário pede para parar
// Devolve { total, motivo: 'fim'|'parado'|'limite'|'erro', erro }.

export const esperar = (ms) => new Promise((pronto) => setTimeout(pronto, ms));

export async function capturarComRolagem({ opcoes, pagina, configPagina, tirarPrint, antesDoPrint, aoCapturar, deveParar }) {
  let total = 0;
  let motivo = 'fim';
  let erro = null;
  let alvo = 0;
  let anterior = -1;
  try {
    const inicio = await pagina('iniciar', configPagina ?? null);
    for (;;) {
      if (deveParar()) {
        motivo = 'parado';
        break;
      }
      if (total >= opcoes.limite) {
        motivo = 'limite';
        break;
      }
      await pagina('rolarPara', alvo);
      await esperar(total === 0 ? opcoes.espera + 300 : opcoes.espera);
      if (antesDoPrint) await antesDoPrint();
      if (deveParar()) {
        motivo = 'parado';
        break;
      }
      const m = await pagina('prepararPrint', opcoes.esconderFixos && total > 0);
      if (total > 0 && m.topo <= anterior) break; // a área não rola mais
      const print = await tirarPrint(m, inicio);
      if (!print) {
        motivo = 'parado';
        break;
      }
      total++;
      const porcento = m.max > 0 ? Math.min(100, Math.round((m.topo / m.max) * 100)) : 100;
      await aoCapturar(print, total, porcento, m);
      anterior = m.topo;

      if (m.topo >= m.max - 1) {
        // Chegou ao fim; dá tempo para itens carregados sob demanda aumentarem a lista.
        await esperar(opcoes.espera);
        if ((await pagina('maximo')) <= m.topo + 1) break;
      }
      // Próxima posição: avança a área visível menos o que fica coberto por
      // cabeçalho/rodapé fixo e menos a sobreposição escolhida.
      const repetido = Math.round((m.altura * opcoes.sobreposicao) / 100);
      const passo = m.altura - m.ocupadoTopo - m.ocupadoBase - repetido;
      alvo = m.topo + Math.max(Math.round(m.altura * 0.2), passo);
    }
  } catch (e) {
    motivo = 'erro';
    erro = e;
  } finally {
    try {
      await pagina('finalizar');
    } catch {
      // a página pode ter sido fechada ou recarregada
    }
  }
  return { total, motivo, erro };
}
