# Studio 0.2.0-beta.13

- **O último quadro do jogo fica no ar.** Uma captura de jogo ou de janela para de
  entregar imagem quando o jogo é minimizado, perde o gancho no alt-tab ou deixa
  de desenhar. Antes a cena ficava preta; agora o último quadro continua
  aparecendo até a imagem voltar. A fonte mostra o aviso "quadro congelado"
  enquanto isso, para quem transmite saber que o jogo parou de enviar. Câmera
  nunca congela: um rosto parado mostraria alguém que não está mais ali.
- **Cenas separadas de verdade, com animação.** Cada cena passou a ser montada em
  uma tela própria e entra por uma transição; a cena no ar nunca é editada para
  virar a outra, que era o que misturava as duas. A troca pode ser **Deslizar**,
  **Esmaecer** ou **Corte**, com tempo Rápida, Média ou Suave, e a escolha fica
  salva neste computador. A pausa e a meta pública passaram a ficar acima da
  cena, em camadas próprias, então continuam no lugar durante a troca.
- **Cena nova começa vazia.** O botão de nova cena cria uma cena sem fontes, e um
  botão novo duplica a cena atual quando é isso que você quer. Antes toda cena
  nova nascia com as fontes da anterior.
- **Menos atraso na transmissão.** O envio deste computador passou a usar
  codificação sem quadros B e sem antecipação, com uma chave por segundo: são
  cerca de 0,6 s a menos entre a câmera e o servidor. O que o público vê é
  reconvertido no servidor, com os mesmos ajustes de imagem de antes.

Depende do servidor apenas no que já estava publicado; nenhuma rota nova.
