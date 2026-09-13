# Privex Studio

Open-source Windows broadcasting client for the Privex service. Connect your
account in your browser, explicitly confirm the account in Studio, build a scene
from camera, window, screen, image and text sources, choose the microphone,
preview, then start your broadcast. Scenes are saved per computer.
Chat, moderation, goals and paid interactions use the authenticated service API.
The Privex service is age-restricted and broadcasting requires an eligible,
verified adult account. Building the client does not grant access to that service.

**Status:** beta. The last production installer is 0.2.0-beta.10 and is unsigned.
This repository prepares 0.2.0-beta.11 (game capture no longer blocks a scene
change while the game is not rendering). SignPath Foundation approval and Windows
publisher signing have not been obtained. Do not describe this build as signed
or guaranteed to run with Smart App Control enabled.

## Scope

This repository contains the desktop client, its native media engine wrapper,
nine client UI modules, build instructions, tests and dependency notices.
It contains no Privex website application, PHP backend, database, production
configuration or history from the private repository. The service remains
separate. API addresses and the update verification public key are public;
credentials and release signing private keys must never be committed.

## Build and test

Use Node.js 24 and Windows 10/11 x64 for the native application.

```powershell
npm ci
npm test
npm run build:ui
```

The UI and unit tests build without the private Privex repository, an account,
production credentials or a running backend. See [BUILD.md](BUILD.md) for the
native toolchain, pinned upstream source and installer build.

## Security and privacy

Account tokens stay in the Electron main process and are encrypted using Windows
DPAPI. The renderer cannot choose arbitrary API routes or native commands.
Updates require signed metadata and a matching file hash; an active broadcast
blocks installation. The installer never kills an ongoing broadcast.

Automatic update checks can be disabled in the app. Camera/microphone capture
requires explicit selection. Read [PRIVACY.md](PRIVACY.md) and
[SECURITY.md](SECURITY.md). Report security issues privately, without account
tokens or personal data.

## Code signing policy

Read [CODE_SIGNING_POLICY.md](CODE_SIGNING_POLICY.md). Free signing is being
prepared for application to SignPath Foundation; no sponsorship or approval is
claimed. Signed production releases require a human release approver.

## License

Privex-authored client code in this repository is licensed under
**GPL-3.0-or-later**, including the copied client UI modules. See [LICENSE](LICENSE)
and [NOTICE.md](NOTICE.md). Dependencies retain their own licenses. Privex names
and logos identify the official project; the software license does not grant
trademark rights, service access or rights in user content. Forks must not imply
that they are official Privex releases.

## Português

Este é somente o código do Studio. O site, o servidor e o banco do Privex
continuam privados. A licença permite estudar, modificar e redistribuir este
cliente conforme a GPL. Não publique senhas, tokens ou dados de usuários.
O aplicativo ainda é beta sem assinatura de publicador; abrir o código não
libera automaticamente a instalação no Controle Inteligente de Aplicativos.
