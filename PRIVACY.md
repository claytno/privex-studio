# Studio privacy

The desktop client connects to https://privex.site for device authorization,
account/session state, chat, moderation, commerce controls and update metadata.
The service's privacy policy is https://privex.site/privacy. Its terms are at
https://privex.site/terms. This open-source repository does not contain user data.

Login takes place in the user's browser; Studio does not request or store the
account password. A device credential is stored locally encrypted by Windows
DPAPI and stays outside the renderer. Account identity must be confirmed before
capture/management is enabled. Logging out revokes the device and removes that
credential. Uninstalling removes the local credential, but remote revocation
requires logout or the device management page on the service.

Automatic update checks run shortly after startup and periodically while the
app is open. The official server/CDN receives ordinary connection metadata,
including the IP address. The manifest request contains no account credential
or installed-version parameter; versions are compared locally. Users can disable
automatic checks before or after login. Manual checks remain available.
The boolean preference is stored in update-preferences.json, separate from tokens.

Capture sources and microphones are selected explicitly. A local preview can
capture the chosen source without publishing. Clicking Start live authorizes
transmission of that source and selected audio to the service-specified endpoint.
Close preview/app or end the live to stop capture. Sharing a whole screen can
include private information visible on it.

No independent analytics SDK or advertising tracker is added to this client.
Network errors and device behavior may be recorded locally for diagnostics;
review logs before sharing them. Do not upload account credentials or media to
public issues. Contact for privacy matters: contato@privex.site.
