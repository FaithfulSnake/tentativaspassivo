# Passivo Fanjas: o passivo do PJe direto no Edge

Extensão para o Microsoft Edge (também roda no Chrome). Ela percorre a lista do passivo federal no PJe 1º grau do TRF1 e,
para cada processo, faz o que hoje é feito à mão:

1. abre a tela **Consulta processos** do PJe, cola o número e pesquisa;
2. abre os autos;
3. tira os **prints da linha do tempo**, rolando do topo até o fim, igual à Ferramentas Fanjas;
4. abre o painel de **download** e baixa o **inteiro teor**: período e ID em branco, cronologia crescente, sem expediente
   e sem movimentos;
5. salva tudo na pasta do processo e marca **ok** na lista.

```
Downloads/
  PASSIVO FEDERAL/
    LISTA DO PASSIVO.txt               lista com a situação de cada processo
    01 - 1082104-48.2025.4.01.3700/
      1082104-48.2025.4.01.3700.pdf
      PRINT 01.png
      PRINT 02.png
      ...
    02 - 0005653-39.2001.4.01.3700/
    ...
    27 - 0000992-31.2012.4.01.3700/
```

## Por que extensão e não Colab

O Colab roda num servidor do Google. Ele não tem o login do PJe que já está no seu Edge e não enxerga a Ferramentas
Fanjas. A extensão roda dentro do próprio Edge, com o mesmo login, e salva direto na pasta Downloads do computador.
Com isso os autos não passam pelo Google Drive. Ela também não usa o Gemini nem o Astrea: a lista de referência fica
guardada na extensão, já com os números no formato do PJe.

## Como instalar (uma vez)

1. Baixe esta pasta do GitHub (**Code › Download ZIP**) e descompacte. A extensão é a pasta `extensao`.
2. No Edge, abra `edge://extensions`.
3. Ligue o **Modo de desenvolvedor** (canto inferior esquerdo).
4. Clique em **Carregar sem pacote** e escolha a pasta `extensao`.
5. Fixe o ícone (pasta amarela com o visto verde) na barra do Edge.

Quando houver uma versão nova, troque os arquivos da pasta e clique em **Recarregar** na extensão, em
`edge://extensions`. A lista e a situação de cada processo continuam guardadas.

## Antes de rodar

- Esteja logado no **PJe 1º grau do TRF1** neste Edge.
- Em `edge://settings/downloads`, deixe **desligado** “Perguntar onde salvar cada arquivo”. Se estiver ligado, a extensão
  para e avisa.
- Deixe a janela do Edge com o PJe **visível**: o print só pega o que está na tela. Pode usar o Chrome na outra metade
  da tela, mas não minimize nem cubra o Edge.
- Não baixe outros arquivos no Edge durante a rodada, para não misturar com o PDF.

## Como usar

Clique no ícone da extensão para abrir o painel com os 27 processos.

- **Rodar pendentes**: roda, em ordem, todos os processos que não estão ok.
- **Rodar** (numa linha): roda só aquele processo. Antes da primeira rodada completa, teste um processo assim, por
  exemplo o 07.
- **Refazer**: baixa de novo e substitui os arquivos daquele processo, sem criar cópias com “(1)”.
- **Marcar ok** e **Desmarcar**: marca à mão um processo que você fez por fora.
- **Pasta**: abre a pasta do processo no Explorador de Arquivos.
- **Parar depois deste**: termina o processo atual e para.

Os 6 primeiros vêm como **ok**, porque estavam marcados “(ok)” na lista. Se quiser que a extensão monte as pastas 01 a 06
também, clique em **Refazer** em cada um.

Para mandar o resultado: botão direito na pasta `PASSIVO FEDERAL` › **Compactar para arquivo ZIP**.

Em **Trocar a lista de processos** dá para colar outra lista no mesmo formato (“1. Nº … (ok)”, descrição e
“Observação:”). Em **Configurações** dá para mudar o nome da pasta principal, o endereço da consulta, os tempos de espera
e se os prints pegam a tela inteira ou só a linha do tempo.

## O que mudou em relação ao processo manual

- **Período do download em branco.** Na gravação, o filtro estava de 10/09/2026 até 27/05/2026, com o início depois
  do fim. A extensão limpa esses campos e baixa o processo inteiro.
- **Sem ZIP de nome aleatório.** Na gravação, o ZIP dos prints saiu como `914fcd6f-….zip`. Aqui, cada print vai solto,
  com o nome certo, para a pasta do processo. Se alguma outra extensão trocar o nome de um download, a extensão percebe
  e para com um aviso.
- **Arquivos baixados de novo substituem os antigos**, sem “(1)”.

## Se der erro

Cada processo mostra o motivo no painel e a rodada segue para o próximo. Os mais comuns:

| Aviso | O que fazer |
| --- | --- |
| PJe pedindo login | Entre no PJe neste Edge e clique em **Rodar** de novo. |
| Não achou o campo do número na consulta | Abra a tela **Consulta processos** do PJe numa aba. A extensão usa a aba aberta. |
| Os autos não abriram | Permita pop-ups do PJe (ícone na barra de endereço) ou abra os autos à mão e clique em **Rodar** na linha. |
| PDF mandado para a “Área de download” | Processo grande: baixe por lá e coloque na pasta do processo. Depois clique em **Marcar ok**. |
| Consulta não encontrou o processo | Ele pode estar em outro grau ou sistema, ou ter sigilo. |

A extensão foi testada contra uma **imitação** do PJe (pasta `teste`), não contra o PJe de verdade, porque o PJe exige
o seu login. Se ela não achar um campo ou botão no PJe real, abra a tela onde ela parou e use **Se algo der errado ›
Salvar diagnóstico**. Sai um `.txt` em `Downloads/PASSIVO FEDERAL/_diagnostico` com o código das abas do PJe; com ele dá
para ajustar a extensão. O arquivo tem dados dos processos, então mande só para quem for fazer o ajuste.

## Permissões

- **Ler e alterar dados em todos os sites**: o Edge só deixa uma extensão tirar print de uma aba com essa permissão.
  A extensão só mexe nas abas do PJe.
- **Downloads**: para salvar os prints e o PDF na pasta do processo.

## Para quem for mexer no código

```
extensao/
  manifest.json
  background.js   a rodada: abre os autos, prints, PDF, nomes dos arquivos, situação na lista
  pje.js          o que é feito dentro das telas do PJe (campo do número, linha do tempo, painel de download)
  pagina.js       rolagem e medidas para os prints (copiado sem mudanças da Ferramentas Fanjas 1.5.2)
  captura.js      laço de rolagem dos prints (da Ferramentas Fanjas)
  lista.js        lista inicial e leitura de uma lista colada
  config.js       configurações
  painel.*        a tela com a lista
  offscreen.*     monta os arquivos (blob) para o download
teste/
  mock-pje.mjs          PJe de mentira (consulta, autos com linha do tempo, painel de download)
  teste-extensao.mjs    abre o Chromium com a extensão e confere a pasta montada
```

Para rodar o teste, com Node 22 e um Chromium ou Chrome for Testing:

```bash
CHROME=/caminho/do/chrome node teste/teste-extensao.mjs
```
