# Contributing

Use an issue or pull request for non-sensitive bugs and improvements. Include
tests for security, update or financial-control changes. All contributed code
must be compatible with GPL-3.0-or-later. Contributors retain their copyright.

Run npm ci, npm test and npm run build:ui. Native changes require Windows tests
and the source build described in BUILD.md. Network/capture tests must use test
accounts and explicit consent; never move real money to validate this client.

Do not add private service source, credentials, logs, account profiles, downloaded
user media, obfuscated proprietary components or binary-only project code.
Public dependencies must retain their notices and verifiable provenance.
