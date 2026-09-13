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

## Live equipment and audio revision (unreleased working tree)

- 52 Node tests pass, including live source-switch failure preservation,
  concurrent end cancellation, format-change rejection, independent audio levels,
  and read-only audience route restrictions.
- Global goal controls are applied to the native overlay on all catalog paths;
  disabling goals removes the overlay even while a saved goal is still active.
- Native wrapper rebuilt locally; synthetic GPU/protocol tests pass with seven
  source-switch/audio checks in addition to composition and reconnect tests.
  Tests never publish or capture a physical camera/microphone/desktop.
- Audio sources can be independently selected and adjusted from 0–100%; interval
  mode silences both. Automatic device discovery preserves selections and does
  not enable capture until the user applies equipment. Desktop audio starts off.
- Changing video equipment preserves the canvas and output. An unavailable new
  source leaves the previous source running. Changing aspect ratio still requires
  ending an active broadcast. The native window keeps renderer timers running
  while minimized so normal backgrounding does not trigger the live watchdog.
- Remaining hardware validation: switch between real displays/cameras while
  publishing, unplug/replug WASAPI devices, verify desktop/mic levels and echo on
  a second machine, and minimize Studio for several minutes during a real live.
  This local build is not a signed installer or a production deployment.

## beta.5 audio signal meters

- Native libobs meters report microphone and desktop input peaks and post-volume
  output peaks at 5 Hz. Only bounded dBFS values and state flags cross IPC, through
  a dedicated channel that does not re-render the entire manager on every sample.
- Muting, zero volume and the interval scene silence the output indication while
  input remains usable to check the device. Clipping holds for 1.5 seconds; missing
  callbacks expire after one second. Silence, startup, unavailable data and an
  unconfigured source have separate visible states.
- Callback removal and source detachment precede source destruction/replacement.
  Synthetic native tests feed generated PCM into libobs (no capture, playback or
  publication), validate -6/-12 dBFS gain mapping, silence, mute, clipping, stale
  readings and concurrent attachment/removal. Eight meter checks passed.
- Renderer regression covers visible input/output values, clipping feedback and
  mute semantics; IPC tests reject extra sample/device data and stale events after
  stopping. These meters measure individual sources, not final mixed-output
  clipping. Real device sensitivity and loopback/echo still require hardware QA.

## Scenes and compact studio revision (beta.6 working tree)

- 63 Node tests pass, including layer validation and the image allowlist, layer
  toggles bounded to the prepared composition, saved-layout round-trip with a
  vanished image dropped rather than replaced, and rejected layouts leaving the
  previous one untouched.
- Native wrapper rebuilt locally from this tree. Self-test on the GPU: fit,
  pause and goal frames as before, plus corner-layer frames, hidden-layer frames,
  source reuse across recompositions and rejection of an invalid layer list
  (four layer checks). Protocol test: 22 checks including a text-only scene with
  no capture device, layer toggling, live reconfiguration and preservation when a
  device is unavailable. No network publish or physical capture.
- Electron layout test at 1000x720, 1280x800, 1440x940/125% and 1920x1080/150%:
  preview keeps the 16:9 (or 9:16) canvas ratio, docks and control bar fit
  without scrolling, discovery never starts capture, Abrir prévia is the only
  capture consent, adding/positioning sources while the preview is open applies
  automatically, visibility uses the layer command, images come only from the
  native picker, new scenes copy the current one and layouts are persisted.
  Dialog and clipped-scroll preview hiding still pass.
- Native preview smoke with the layered engine: synthetic own window captured at
  404x261 into the 640x360 child, PrintWindow colours verified, hide/restore,
  resize, pause/resume and release on stop.
- Not validated: physical camera over a shared screen, real image files chosen by
  a person, prolonged broadcasts with scene switching, and the installer build.
