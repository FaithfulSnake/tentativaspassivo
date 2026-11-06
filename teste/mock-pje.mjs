// Imitação mínima do PJe 1º grau (consulta processos, autos com linha do tempo
// e painel de download) para testar a extensão sem entrar no PJe de verdade.
// Os campos imitam o que aparece na gravação: rótulos sem "for", ids "j_id",
// período já preenchido pelo autocompletar, cronologia decrescente etc.
import http from 'node:http';

const PROCESSOS = {
  '00054172820174013700': { id: 7365233, ca: '526fadde902fb5149b', classe: 'EXECUÇÃO FISCAL', eventos: 40, partes: 'UNIAO FEDERAL (FAZENDA NACIONAL) X T V T PRODUTORA DE AUDIO E VIDEO LTDA - ME' },
  // este abre como no PJe com AJAX: o link não traz o endereço (o pop-up sai depois do clique)
  '00009923120124013700': { id: 7365777, ca: '9a8b7c6d5e4f', classe: 'EXECUÇÃO FISCAL', eventos: 3, partes: 'UNIAO FEDERAL X EMPRESA EXEMPLO LTDA', ajax: true },
};

const fmt = (d) => `${d.slice(0, 7)}-${d.slice(7, 9)}.${d.slice(9, 13)}.${d.slice(13, 14)}.${d.slice(14, 16)}.${d.slice(16)}`;
export const registro = []; // o que chegou no DOWNLOAD

function paginaConsulta() {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Consulta processos · Justiça Federal da 1ª Região</title>
<style>body{font-family:sans-serif;margin:20px}.propertyView{margin:8px 0}.name{font-weight:bold}</style></head><body>
<h2>Consulta processos</h2>
<form id="fPP" name="fPP" onsubmit="return false">
  <div class="propertyView"><div class="name"><label>Nome da parte</label></div><div class="value"><input id="fPP:j_id150:nomeParte" type="text"></div></div>
  <div class="propertyView"><div class="name"><label for="fPP:numProcesso-inputNumeroProcessoDecoration:numProcesso-inputNumeroProcesso">Número do processo</label></div>
    <div class="value"><input id="fPP:numProcesso-inputNumeroProcessoDecoration:numProcesso-inputNumeroProcesso" type="text" maxlength="25"></div></div>
  <div class="propertyView"><div class="name"><label>OAB</label></div><div class="value"><input id="fPP:j_id170:oab" type="text"></div></div>
  <div class="propertyView"><div class="name"><label>Órgão Julgador</label></div><div class="value"><select id="fPP:j_id200:orgao"><option>Selecione</option></select></div></div>
  <input type="button" id="fPP:searchProcessos" value="PESQUISAR" onclick="pesquisar()">
</form>
<div id="resultado"></div>
<script>
  // máscara do número (como a do PJe): só dígitos, formatados enquanto digita
  const campo = document.getElementById('fPP:numProcesso-inputNumeroProcessoDecoration:numProcesso-inputNumeroProcesso');
  window.A4J = { AJAX: { Submit() {} } };
  campo.addEventListener('input', () => {
    const d = campo.value.replace(/\\D/g, '').slice(0, 20);
    const partes = [[0,7,''],[7,9,'-'],[9,13,'.'],[13,14,'.'],[14,16,'.'],[16,20,'.']];
    campo.value = partes.map(([a,b,s]) => d.length > a ? s + d.slice(a,b) : '').join('');
  });
  function openPopUp(nome, url) { window.open(url, nome, 'width=1000,height=700'); }
  async function abrirViaAjax(id) {
    const r = await (await fetch('/pje/api/chave?id=' + id)).json();
    // O PJe real só fornece/abre os autos depois deste confirm na resposta AJAX.
    if (confirm('Conforme a Resolução CNJ n.º 121 e o PCA 0000547-84.2011.2.00.0000, o acesso aos autos de processo de que o advogado/procurador/defensor público não faz parte será registrado para fins de eventual responsabilização civil, administrativa ou criminal. Continuar?')) {
      openPopUp('detalheProcesso', r.url);
    }
  }
  function pesquisar() {
    document.getElementById('resultado').innerHTML = '<div class="rich-mpnl-body">Aguarde...</div>';
    setTimeout(async () => {
      const r = await (await fetch('/pje/api/buscar?numero=' + encodeURIComponent(campo.value))).json();
      const clique = r.ajax
        ? 'A4J.AJAX.Submit(\\'fPP\\', event, {\\'actionUrl\\':\\'/pje/Processo/ConsultaProcesso/listView.seam?javax.portlet.faces.DirectLink=true\\'}); abrirViaAjax(' + r.id + '); return false;'
        : 'openPopUp(\\'detalheProcesso\\', \\'/pje/Processo/ConsultaProcesso/Detalhe/listProcessoCompletoAdvogado.seam?id=' + r.id + '&ca=' + r.ca + '\\'); return false;';
      document.getElementById('resultado').innerHTML = r.encontrado
        ? '<span>1 resultados encontrados.</span><table id="fPP:processosTable"><tbody id="fPP:processosTable:tb"><tr><td><a href="#" onclick="' + clique + '">' + r.numero + '</a></td><td>' + r.classe + '</td></tr></tbody></table>'
        : '<span>0 resultados encontrados.</span>';
    }, 900);
  }
</script></body></html>`;
}

function paginaAutos(d, p) {
  const numero = fmt(d);
  const meses = ['jan.', 'fev.', 'mar.', 'abr.', 'mai.', 'jun.', 'jul.', 'ago.', 'set.', 'out.', 'nov.', 'dez.'];
  const evento = (i) =>
    `<div class="data">${String(28 - (i % 27)).padStart(2, '0')} ${meses[i % 12]} ${2022 - Math.floor(i / 12)}</div>
     <div class="evento"><div>JUNTADA DE MANIFESTAÇÃO ${i + 1}</div><div>${1117468269 - i * 1013} - Manifestação</div><small>15:40</small></div>`;
  const eventos = Array.from({ length: p.eventos }, (_, i) => evento(i)).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${numero} · Justiça Federal da 1ª Região</title>
<style>
  body{margin:0;overflow:hidden;font-family:sans-serif}
  .navbar{height:56px;background:#1c5e8f;color:#fff;display:flex;align-items:center;justify-content:space-between;padding:0 12px}
  .navbar a{color:#fff;font-size:22px;margin-left:16px;text-decoration:none}
  .layout{display:flex;height:calc(100vh - 56px)}
  #divTimeLine{width:420px;overflow-y:auto;border-right:1px solid #ccc;padding:0 8px}
  .data{margin:14px auto 6px;width:110px;text-align:center;background:#ddd;border-radius:10px;font-size:12px}
  .evento{border:1px solid #ccc;border-radius:4px;padding:10px;margin:6px 0;height:60px}
  .viewer{flex:1;overflow:auto;padding:20px}
  .painel{position:absolute;right:0;top:56px;width:360px;background:#fff;border:1px solid #999;padding:12px;display:none}
  .painel div{margin:6px 0}
</style></head><body>
<form id="navbar" name="navbar" method="post" action="/pje/Processo/ConsultaProcesso/Detalhe/listProcessoCompletoAdvogado.seam?id=${p.id}">
  <input type="hidden" name="numero" value="${numero}">
  <div class="navbar">
    <div>ExFis ${numero}<br><small>${p.partes}</small></div>
    <div>
      <a href="#" title="Página inicial">⌂</a>
      <a href="#" id="navbar:j_id180" title="Download autos do processo" onclick="document.getElementById('navbar:painel').style.display='block';return false;"><i class="fa fa-download"></i>⬇</a>
    </div>
  </div>
  <div id="navbar:painel" class="painel">
    <div><label>Tipo de documento</label><br><select name="tipoDoc"><option value="">Selecione</option><option value="57">Petição</option></select></div>
    <div><span>ID a partir de</span> <input name="idDe" type="text"> <span>Até</span> <input name="idAte" type="text"></div>
    <div><span>Período de</span> <input name="dtIni" type="text" value="10/09/2026"> <span>Até</span> <input name="dtFim" type="text" value="27/05/2026"></div>
    <div><label>Cronologia</label><br><select name="cronologia"><option value="DESC" selected>Decrescente</option><option value="ASC">Crescente</option></select></div>
    <div>Índice do PDF
      <label><input type="checkbox" name="i1" checked> Tipo de documento</label>
      <label><input type="checkbox" name="i2" checked> Descrição</label>
      <label><input type="checkbox" name="i3" checked> ID</label>
      <label><input type="checkbox" name="i4" checked> Data da juntada</label></div>
    <div><label>Incluir expediente</label><br><select name="expediente"><option value="S" selected>Sim</option><option value="N">Não</option></select></div>
    <div><label>Incluir movimentos</label><br><select name="movimentos"><option value="S">Sim</option><option value="N" selected>Não</option></select></div>
    <input type="submit" name="navbar:j_id280" value="DOWNLOAD" class="btn btn-primary">
    <input type="button" value="CANCELAR" onclick="document.getElementById('navbar:painel').style.display='none'">
  </div>
</form>
<div class="layout">
  <div id="divTimeLine">${eventos}<div id="mais"></div></div>
  <div class="viewer">
    <div><a href="#" title="Download do documento">⬇</a></div>
    <h3>2286421631 - Termo</h3><p>PODER JUDICIÁRIO · JUSTIÇA FEDERAL · TERMO DE JUNTADA</p>
    ${'<p>Texto do documento selecionado na linha do tempo.</p>'.repeat(40)}
  </div>
</div>
<script>
  // a linha do tempo carrega mais itens quando chega no fim (como no PJe)
  const linha = document.getElementById('divTimeLine');
  let carregou = ${p.eventos < 10 ? 'true' : 'false'};
  linha.addEventListener('scroll', () => {
    if (carregou || linha.scrollTop + linha.clientHeight < linha.scrollHeight - 5) return;
    carregou = true;
    setTimeout(() => {
      document.getElementById('mais').innerHTML = Array.from({length: 6}, (_, i) => '<div class="data">01 jan. 2017</div><div class="evento"><div>EVENTO ANTIGO ' + (i+1) + '</div><div>' + (900000 + i) + ' - Petição inicial</div></div>').join('');
    }, 300);
  });
</script></body></html>`;
}

function pdfMinimo(texto) {
  const corpo = `BT /F1 18 Tf 50 750 Td (${texto}) Tj ET`;
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${corpo.length} >>\nstream\n${corpo}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const pos = [];
  objs.forEach((o, i) => {
    pos.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${pos.map((p) => `${String(p).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

export function iniciar(porta = 0) {
  const servidor = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const html = (s) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(s);
    };
    if (url.pathname === '/pje/Processo/ConsultaProcesso/listView.seam') return html(paginaConsulta());
    if (url.pathname === '/pje/api/buscar') {
      const d = (url.searchParams.get('numero') || '').replace(/\D/g, '');
      const p = PROCESSOS[d];
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(p ? { encontrado: true, numero: fmt(d), ...p } : { encontrado: false }));
    }
    if (url.pathname === '/pje/api/chave') {
      const p = Object.values(PROCESSOS).find((v) => v.id === Number(url.searchParams.get('id')));
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ url: `/pje/Processo/ConsultaProcesso/Detalhe/listProcessoCompletoAdvogado.seam?id=${p.id}&ca=${p.ca}` }));
    }
    if (url.pathname.endsWith('/listProcessoCompletoAdvogado.seam')) {
      const id = Number(url.searchParams.get('id'));
      const [d, p] = Object.entries(PROCESSOS).find(([, v]) => v.id === id) || [];
      if (!p) return html('<title>Erro</title>Processo não encontrado');
      if (req.method === 'POST') {
        let corpo = '';
        req.on('data', (c) => (corpo += c));
        req.on('end', () => {
          const campos = Object.fromEntries(new URLSearchParams(corpo));
          registro.push({ numero: fmt(d), campos });
          setTimeout(() => {
            res.writeHead(200, { 'content-type': 'application/pdf', 'content-disposition': `attachment; filename="${fmt(d)}.pdf"` });
            res.end(pdfMinimo(`Autos ${fmt(d)} - inteiro teor`));
          }, 1500);
        });
        return;
      }
      // aba antiga com a sessão vencida: o título ainda tem o número, mas a página não monta
      if (url.searchParams.get('ca') !== p.ca) return html(`<title>${fmt(d)} · Justiça Federal da 1ª Região</title>Sessão expirada. Abra o processo de novo.`);
      return html(paginaAutos(d, p));
    }
    if (url.pathname === '/__registro') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(registro));
    }
    res.writeHead(404);
    res.end('nada');
  });
  return new Promise((pronto) => servidor.listen(porta, '127.0.0.1', () => pronto(servidor)));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const s = await iniciar(Number(process.argv[2]) || 8765);
  console.log(`PJe de mentira em http://127.0.0.1:${s.address().port}/pje/Processo/ConsultaProcesso/listView.seam`);
}
