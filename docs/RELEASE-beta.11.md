# Studio 0.2.0-beta.11

Correção da fonte **Jogo**, que recusava a cena em vez de esperar o jogo.

- **O jogo agora entra na cena.** Ao escolher um jogo, o Studio mostrava
  "New video source is not ready; previous sources preserved" e a cena não era
  aplicada. O motor exigia que toda fonte nova entregasse imagem em 3 segundos
  antes de substituir a composição. Isso faz sentido para câmera, janela e tela,
  que abrem na hora, mas não para um jogo: o hook precisa ser injetado e o jogo
  precisa desenhar um quadro, o que costuma demorar mais. Agora a fonte de jogo
  entra na cena imediatamente e a imagem aparece assim que o jogo renderiza.
  Câmera, janela e tela continuam sendo conferidas antes de trocar uma cena que
  já estava no ar.
- **Jogo identificado pelo executável.** A correspondência passou a ser pelo
  programa (cs2.exe), como no OBS, e não pelo título da janela, que muda entre
  menu, carregamento e partida.
- **Enquanto o jogo não desenha**, a fonte aparece marcada como
  "aguardando o jogo" na lista, em vez de "sem sinal".
- **Sem alarme falso ao procurar equipamentos.** A busca automática que caía no
  meio de uma troca de cena mostrava "Não foi possível atualizar os equipamentos:
  Aguarde a operação atual". Essa disputa momentânea passa despercebida; a busca
  seguinte acontece sozinha.

Se o jogo continuar preto depois disso: jogos com anticheat podem recusar o
hook, e nesse caso a fonte Tela inteira funciona. Jogos em Vulkan exigem a
camada do OBS registrada no Windows, que este instalador não registra.

Sem assinatura de publicador; identidade do instalador, perfil e chave de
atualização inalterados. A captura de jogo não foi validada com um jogo real
nesta máquina, que não tem GPU de jogo.
