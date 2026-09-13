# Studio 0.2.0-beta.15

- **Prévia dentro da caixa.** A prévia nativa aparecia deslocada para cima,
  saindo da moldura: o Electron desenha a barra de menu ("Privex Studio")
  dentro da área cliente da janela, e a prévia era posicionada como se a página
  começasse no topo dessa área. O motor agora localiza onde a página começa
  (pela janela da própria página ou, na falta dela, pelo tamanho do conteúdo
  informado pelo aplicativo) e desloca a prévia por essa altura. Os testes de
  prévia usavam janelas sem menu, por isso nunca acusaram.
- **Editar uma cena sem trocar a que está no ar.** O painel Fontes ganhou uma
  caixa de seleção "Cena em edição": escolha qualquer cena ali para mexer nas
  fontes dela enquanto a live continua mostrando a cena atual. A cena em edição
  aparece marcada na lista de cenas, com um aviso "fora do ar" e um botão
  "Colocar no ar". Uma cena nova abre em edição sem ir ao ar; clicar no nome da
  cena continua trocando a cena ao vivo. O lápis abre os ajustes da cena em
  edição.
- **Janela de jogo não trava a cena.** Uma fonte Janela / Jogo cuja janela
  ainda não desenhou (jogo minimizado, carregando ou atrás de outra) entra na
  cena e fica marcada como "aguardando a janela", em vez de fazer a aplicação
  da cena falhar depois de três segundos. Câmera e tela inteira continuam sendo
  exigidas antes de substituir uma cena que funcionava.
- **"Aguardando o jogo" explicado.** Na fonte antiga de jogo, com "Qualquer
  jogo em tela cheia", o jogo precisa estar em primeiro plano e cobrir o
  monitor inteiro; um jogo em 4:3 numa janela menor que a tela não é detectado,
  mesmo com alt-tab. A dica na fonte e o aviso na lista dizem isso e apontam
  para escolher a janela do jogo. A lista rápida de uma cena vazia deixou de
  oferecer a fonte antiga.

Sem mudança no servidor.
