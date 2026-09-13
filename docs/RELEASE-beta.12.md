# Studio 0.2.0-beta.12

- **Trocar o título durante a live.** O campo de título deixa de ficar bloqueado
  quando a transmissão começa. Ao alterá-lo aparecem "Salvar título" e
  "Cancelar"; salvando, quem está assistindo passa a ver o novo título, assim
  como a lista de lives do site. Corrigir um erro de digitação não exige mais
  encerrar e recomeçar. Valem as mesmas regras do início: de 1 a 100 caracteres,
  espaços repetidos são reduzidos e o pedido só é aceito para a sua própria live
  aberta neste computador.
- **Aviso sonoro de interação.** Quando alguém compra um presente, uma ação, a
  roleta ou manda uma gorjeta, o Studio toca um aviso curto de três notas neste
  computador. Serve para quem está olhando para a câmera, não para o
  gerenciador. O gatilho é o número de interações da sessão, que já chega no
  estado do estúdio: não há consulta nova ao servidor, e o aviso não diz quem
  comprou nem quanto foi. No máximo um aviso a cada dois segundos.
- **Botão "Aviso de interação"** no painel de Áudio liga e desliga esse som, e
  lembra a escolha neste computador. Com o microfone aberto perto da caixa de
  som o público pode ouvir o aviso; por isso ele é desligável.

Publicado em 2026-09-13 em `downloads/privex-studio/0.2.0-beta.12/` (306687003
bytes, SHA-256 `de6680c0469f28ae9305bd5e754d96655e99016c2d40b14b53b541a7cfa8326f`).

Sem assinatura de publicador; identidade do instalador, perfil e chave de
atualização inalterados.

Depende do servidor: a rota `PUT /obs/v1/live/{id}/title` e o campo
`session.interaction_seq` precisam estar publicados antes desta versão.
