// A lista de referência do passivo: lê o texto colado (o mesmo formato da
// lista "1. Nº 0000000-00.0000.0.00.0000 (ok) / descrição / Observação: ...")
// e guarda os processos em ordem. A ordem na lista é o número da pasta (01, 02...).

// Número CNJ, com ou sem pontuação: 0005417-28.2017.4.01.3700 ou 00054172820174013700.
const RE_CNJ = /(?<!\d)(\d{7})-?(\d{2})\.?(\d{4})\.?(\d)\.?(\d{2})\.?(\d{4})(?!\d)/g;

export const soDigitos = (s) => String(s ?? '').replace(/\D/g, '');

export function formatarNumero(s) {
  const d = soDigitos(s);
  if (d.length !== 20) return String(s ?? '').trim();
  return `${d.slice(0, 7)}-${d.slice(7, 9)}.${d.slice(9, 13)}.${d.slice(13, 14)}.${d.slice(14, 16)}.${d.slice(16)}`;
}

const limpar = (s) =>
  String(s ?? '')
    .split('\n')
    .map((linha) => linha.replace(/^[\s*•·\-–—:]+/, '').trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

// Devolve [{ ordem, numero, descricao, observacao, ok }] na ordem do texto.
// Um número repetido fica só na primeira vez.
export function lerLista(texto) {
  const limpo = String(texto ?? '')
    .replace(/\r/g, '')
    .replace(/\*\*/g, '');
  const achados = [...limpo.matchAll(RE_CNJ)];
  const vistos = new Set();
  const itens = [];
  achados.forEach((m, i) => {
    const numero = formatarNumero(m[0]);
    const fim = i + 1 < achados.length ? achados[i + 1].index : limpo.length;
    let resto = limpo.slice(m.index + m[0].length, fim);
    // o fim do trecho é o começo do próximo item ("7. Nº ")
    resto = resto.replace(/\n[ \t]*\d+[ \t]*[.)\-–][ \t]*(N[º°o]\.?[ \t]*)?$/i, '');
    const ok = /^\s*\(\s*ok\s*\)/i.test(resto);
    resto = resto.replace(/^\s*\(\s*ok\s*\)/i, '');
    let observacao = '';
    const obs = /Observa[çc][ãa]o\s*:/i.exec(resto);
    if (obs) {
      observacao = limpar(resto.slice(obs.index + obs[0].length));
      resto = resto.slice(0, obs.index);
    }
    if (vistos.has(numero)) return;
    vistos.add(numero);
    itens.push({ numero, descricao: limpar(resto), observacao, ok });
  });
  return itens.map((item, i) => ({ ordem: i + 1, ...item }));
}

const dois = (n) => String(n).padStart(2, '0');

// Nome da pasta do processo: "06 - 0005417-28.2017.4.01.3700" (curto, para
// não estourar o limite de caminho do Windows).
export const nomePasta = (item) => `${dois(item.ordem)} - ${item.numero}`;

// A lista enviada no pedido (os 6 primeiros vieram marcados "(ok)").
export const LISTA_INICIAL = `1. **Nº 1082104-48.2025.4.01.3700 (ok)**
Execução fiscal movida pelo IBAMA para cobrança de Taxa de Fiscalização Ambiental (TCFA). O processo foi suspenso devido a acordo de parcelamento.

2. **Nº 0005653-39.2001.4.01.3700 (ok)**
Execução fiscal cobrando débitos previdenciários de 1996 a 1997. O pedido de redirecionamento contra o sócio foi indeferido por prescrição.

3. **Nº 1026562-50.2022.4.01.3700 (ok)**
Cobrança de diversos tributos federais (IRRF, IRPJ, CSLL e contribuições) consolidados em 24 CDAs.
* **Observação:** URGENTE. Risco de penhora de ativos financeiros. Necessidade de verificar status das CDAs e sugestão de parcelamento devido ao risco.

4. **Nº 0008047-19.2001.4.01.3700 (ok)**
Execução fiscal para cobrança de CSLL. A execução foi julgada extinta após pedido de extinção imediata pela PGFN/CNJ e trânsito em julgado.

5. **Nº 0001829-38.2002.4.01.3700 (ok)**
Cobrança de IRPJ com tentativa de redirecionamento para empresas do mesmo grupo económico. A execução foi extinta por prescrição intercorrente e arquivada.

6. **Nº 0005417-28.2017.4.01.3700 (ok)**
Execução de débitos do Simples Nacional. Foi apresentada exceção de pré-executividade, a qual foi rejeitada pelo juízo, mantendo o processo no arquivo provisório.

7. **Nº 0006368-13.2003.4.01.3700**
Cobrança de COFINS. O processo teve sentença de extinção transitada em julgado e arquivamento definitivo promovido pela PGFN.

8. **Nº 0000352-04.2007.4.01.3700**
Execução fiscal cobrando impostos como IRPJ, COFINS, CSLL e PIS. As CDAs foram extintas por prescrição intercorrente e o feito aguarda extinção judicial.
* **Observação:** Pedir a extinção da execução, pois as CDAs já foram extintas.

9. **Nº 0060014-49.2014.4.01.3700**
Cobrança de débitos fiscais declarados e não pagos. O juízo rejeitou a alegação de prescrição e determinou a suspensão do processo por decisão judicial.

10. **Nº 1033098-14.2021.4.01.3700**
Cobrança tributária de IRRF, IRPJ e CSLL.
* **Observação:** Suspensão da execução com fundamento no artigo 922 do CPC, em razão de parcelamento da dívida, por prazo indeterminado até nova manifestação da Fazenda Nacional.

11. **Nº 0011320-20.2012.4.01.3700**
Execução por débitos previdenciários. Teve a execução extinta com trânsito em julgado devido ao cancelamento dos créditos por prescrição.

12. **Nº 1084719-11.2025.4.01.3700**
Cobrança de PIS e COFINS.
* **Observação:** Houve citação inicial com aviso de parcelamento e petição da Fazenda Nacional notificando suspensão por negociação, pois a executada buscou composição administrativa antes da citação.

13. **Nº 0020559-14.2013.4.01.3700**
Execução fiscal de débitos do Simples Nacional referentes ao ano de 2008. O processo foi suspenso até 2035 para cumprimento do parcelamento acordado.

14. **Nº 1053666-51.2021.4.01.3700**
Cobrança de quatro CDAs previdenciárias com histórico de parcelamentos SISPAR e rescisão definitiva. Encontra-se suspenso por decisão judicial.

15. **Nº 0004269-41.2001.4.01.3700**
Execução fiscal de contribuições previdenciárias patronais dos anos de 1998 e 1999. Possui medida de indisponibilidade de bens decretada (artigo 185-A do CTN) sem penhora efetivada.

16. **Nº 0000086-32.1998.4.01.3700**
Execução de débitos previdenciários dos anos de 1992 a 1996.
* **Observação:** O débito encontra-se negociado no SISPAR.

17. **Nº 0004342-13.2001.4.01.3700**
Execução fiscal antiga por débitos do INSS com alegação de grupo económico. Está suspensa em razão do parcelamento do débito.

18. **Nº 0106802-87.2015.4.01.3700**
Cobrança de Imposto de Renda Pessoa Jurídica (IRPJ). O processo está suspenso e foi arquivado provisoriamente devido ao parcelamento da dívida.

19. **Nº 0011311-58.2012.4.01.3700**
Execução por contribuições previdenciárias.
* **Observação:** O processo está sobrestado/suspenso em virtude do parcelamento dos débitos.

20. **Nº 0001353-34.2001.4.01.3700**
Execução fiscal referente a débitos de Contribuições Sociais (COFINS). Processo em trâmite na 11ª Vara Federal com diversos executados.

21. **Nº 0106926-70.2015.4.01.3700**
Cobrança de contribuições previdenciárias de 2002 a 2006. O processo encontra-se suspenso em virtude de novo parcelamento administrativo (SISPAR).

22. **Nº 0006308-16.1998.4.01.3700**
Execução fiscal de débitos previdenciários do período de 1996 a 1997.
* **Observação:** O débito encontra-se negociado no SISPAR.

23. **Nº 0002466-76.2008.4.01.3700**
Execução fiscal do INSS envolvendo duas CDAs.
* **Observação:** A CDA nº 35.989.571-9 foi extinta por crédito liquidado por parcelamento, restando a CDA nº 35.989.572-7 em aberto.

24. **Nº 0010615-75.2019.4.01.3700**
Cobrança de débitos relativos ao FGTS. Encontra-se arquivado provisoriamente e sem movimentações relevantes.
* **Observação:** O processo possui indicativo de possível prescrição.

25. **Nº 0001354-19.2001.4.01.3700**
Execução fiscal de contribuições previdenciárias com inclusão de sócios e empresas ligadas no polo passivo. Os autos foram remetidos ao Tribunal em grau de recurso.

26. **Nº 0000996-25.1999.4.01.3700**
Cobrança de contribuições previdenciárias sobre folha de pagamento. Encontra-se no arquivo provisório, com parcelamento rescindido e abates parciais obtidos por penhora.

27. **Nº 0000992-31.2012.4.01.3700**
Execução fiscal movida pela União para cobrança de certidões relativas a débitos previdenciários e FGTS. Processo arquivado provisoriamente em 1º grau.
`;
