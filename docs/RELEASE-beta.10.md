# Studio 0.2.0-beta.10

Correção da beta.9, que chegou com a prévia invisível e o painel de ajustes
inutilizável.

- **Prévia.** A beta.9 trocou a conversão de coordenadas da prévia (viewport
  CSS enviada pelo renderer e reescalada pelo motor) sem validação em máquina
  real. Esta versão volta ao posicionamento da beta.8, que funcionava: o
  processo principal converte o retângulo CSS em pixels físicos uma única vez
  (zoom × escala do monitor) e o motor confere o resultado contra a área da
  janela. O motor continua aceitando o formato antigo e o novo.
- **Erro visível.** Se o posicionamento da prévia falhar, a tela mostra a
  mensagem em vez de deixar a área preta sem explicação.
- **Ajustes da fonte.** O painel voltou a ocupar a parte inferior da coluna,
  abaixo da prévia, com espaço para equipamento, nome, posição, canto e tamanho.
  Na beta.9 ele ficava dentro do dock de 240 px e cortava os campos.

O restante da beta.9 permanece: cena vazia com quadro preto, sincronização
serializada da cena, troca transacional de fontes e preparação das interações
antes da live (exige o backend com `commerce-preset`).

Publicado em 2026-09-13 em `downloads/privex-studio/0.2.0-beta.10/` (306673060
bytes, SHA-256 `1489d565b3398073ba02fd9d01478552a334075e38872d61240d1b31b5191814`);
o `latest.json` assinado oferece a beta.10 às betas 8 e 9.
