# Studio 0.2.0-beta.6

Esta beta troca a tela de preparação por um estúdio compacto, no estilo dos
programas de transmissão: prévia com a proporção real do vídeo no alto, e
embaixo três painéis fixos, Cenas, Fontes e Áudio. O gerenciador da live
continua ao lado. A janela mínima (1000×720) mostra tudo sem rolagem.

## Cenas com várias fontes

- Uma cena aceita até 6 fontes: câmera, janela, tela inteira, imagem (PNG, JPG,
  GIF, BMP ou WebP até 25 MB) e texto. A primeira da lista fica na frente.
- Cada fonte pode ocupar a tela inteira (imagem completa), preencher cortando as
  bordas, ou ficar em um dos quatro cantos com tamanho de 15% a 60% da largura.
  Câmera sobre a tela compartilhada, logo em um canto e texto com o @ passam a
  ser possíveis.
- Fontes podem ser ocultadas, reordenadas e removidas. Cenas podem ser criadas
  (copiando a atual), renomeadas e trocadas, inclusive ao vivo. A pausa continua
  cobrindo qualquer cena e silenciando o áudio.
- A captura só começa quando a pessoa clica em Abrir prévia. Depois disso, cada
  alteração é aplicada automaticamente; se um equipamento novo não responder, o
  motor mantém a composição anterior e a interface avisa.
- Cenas, fontes, microfone, áudio do computador e formato ficam salvos por
  computador em `studio-layout.json` no perfil do aplicativo. Imagens só entram
  pelo seletor nativo do Studio; caminhos salvos são verificados ao abrir e uma
  imagem que sumiu é removida, nunca substituída por outro arquivo.

## Motor

O motor nativo compõe uma lista de camadas em vez de uma fonte única. Fontes
que não mudaram são reaproveitadas na troca (a câmera não é reaberta ao mover
ou ocultar outra fonte). O comando `layer` mostra ou oculta uma camada sem
recompor a cena. `prepare` e `reconfigure` aceitam `layers`; a forma antiga com
`sourceType` continua funcionando. O autoteste sintético verifica na GPU o
canto, a ocultação, o reaproveitamento e a rejeição de listas inválidas.

## Distribuição e limites

O instalador mantém a identidade beta e a chave pública de atualização. Nada
foi assinado com certificado de publicador nesta versão. Esta versão ainda não
foi validada com câmera física, imagem e transmissão real em outro aparelho;
os testes automatizados usam apenas fontes sintéticas e janelas próprias.
Posicionamento livre por arraste, filtros, transições e alertas animados de
compra continuam pendentes.
