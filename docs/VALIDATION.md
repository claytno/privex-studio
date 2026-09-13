# Extraction validation

This standalone repository was tested without the private website source being
part of the build graph. The client contains nine copied UI modules and a shared
CSS theme. The source allowlist, secret-pattern checks and package source archive
are restricted to approved client files.

- npm ci completed; npm run build:ui completed.
- 46 Node tests passed, including source boundary checks, account confirmation,
  update verification/cancellation, active-live blocking and update-check opt-out.
- Electron renderer layout tests passed at 1000x720, 1280x800, 1440x940/125% and
  1920x1080/150%, including account confirmation, update controls and preview
  hiding under a dialog or clipped scroll area.
- C++ wrapper compiled from this repository against the previously built public
  upstream media libraries. VERSIONINFO reports Privex Studio / 0.2.0-beta.4.
- Native self-test: 74 synthetic frames, with 43 fit, 14 overlay, 14 pause frames,
  five reconnection state checks and 12 protocol checks; no network publication
  or physical camera/microphone capture.

The clean native bootstrap recipe and dependency lock have been reviewed and
PowerShell-parsed, but a complete fresh native build using that script has not
yet passed on GitHub-hosted workers. The local wrapper build is not proof of
trusted CI artifact provenance. No new installer is presented as signed, and no
Smart App Control compatibility claim is made. A live hardware/Internet test and
downloaded signed-installer test remain necessary before a signed public release.
