# Studio 0.2.0-beta.8

Captura de jogos e câmera mais fácil de achar.

- **Fonte Jogo.** Nova fonte que captura o jogo por dentro (DirectX, OpenGL e
  Vulkan), em janela ou tela cheia exclusiva, com o mesmo hook do OBS. A opção
  "Qualquer jogo em tela cheia" aguarda o próximo jogo em tela cheia; também é
  possível escolher a janela do jogo. O instalador passa a incluir
  `graphics-hook32/64.dll`, `inject-helper32/64.exe` e
  `get-graphics-offsets32/64.exe` do OBS upstream em `data/obs-plugins/win-capture`.
  Jogos com anticheat podem recusar o hook; nesse caso use Tela inteira.
- **Janela sem tela preta.** A captura de janela passou a usar Windows Graphics
  Capture em vez de BitBlt, que devolvia preto para programas desenhados na placa
  de vídeo (jogos em janela, navegadores). Onde WGC não existe, o plugin volta ao
  BitBlt sozinho.
- **Câmera visível.** Em uma cena vazia aparecem botões "+ Câmera", "+ Jogo",
  "+ Tela" e "+ Janela", e a câmera é sugerida automaticamente uma vez por
  sessão em qualquer cena vazia, não só na primeira instalação. Quando nenhuma
  câmera é encontrada, o painel diz o que fazer.

Publicado em 2026-09-13 em `downloads/privex-studio/0.2.0-beta.8/`
(306662516 bytes, SHA-256
`c86bbed21178536e9e586c0dad5ca4f247de8fb48c27b491f0c41ebe6073c561`); o
`latest.json` assinado oferece a beta.8 às versões anteriores. Sem assinatura de
publicador; identidade do instalador, perfil e chave de atualização inalterados. A captura de jogo injeta a DLL do hook no processo do
jogo, como o OBS; isso não foi validado com um jogo real nesta máquina.
