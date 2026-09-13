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

## beta.6 installer and publication (2026-09-13)

- Packaged with the rebuilt engine (887 payload files, unsigned beta channel).
  Installer 306052597 bytes, SHA-256
  ea98f313c654ec2690775f31c134f70a887d0d87f20336e16fe4e1693f39b6c1, Authenticode
  NotSigned. The packaged app started against a throwaway profile and stayed
  running without spawning the engine before any device choice.
- Published at the immutable URL under downloads/privex-studio/0.2.0-beta.6/
  with SHA256SUMS.txt; the previous manifest is kept as
  latest-before-beta.6.json outside the repository. The new latest.json was
  signed with the existing Ed25519 key and validated with the shipping
  updates.cjs: offered to 0.2.0-beta.5, not offered to 0.2.0-beta.6. A full
  HTTPS download of the published file matched the built hash.
- Not executed: the installer itself, an actual beta.5 to beta.6 upgrade on a
  clean Windows user, and Smart App Control/SmartScreen behaviour.

## beta.7 fixes and publication (2026-09-13)

- 64 Node tests pass (preview.close refused during a live, no-op when already
  closed). Layout smoke: the source settings sheet opens on click, sits below
  the preview without hiding it (bounds stay non-zero), Escape closes it, and
  Fechar prévia is only offered without a reserved or live session. UI smoke,
  protocol test, native preview smoke and source audit pass on the rebuilt
  engine (version resource beta.7).
- Installer 306058912 bytes, SHA-256
  255b02c86275d8a3f029a1e35a2dc6cf6dd3ee395ef2bda2b2ffd43028eb669f, unsigned
  beta. Packaged app started against a throwaway profile. Published at the
  immutable URL; signed latest.json verified with the shipping updater from
  beta.5, beta.6 (offered) and beta.7 (up to date); full HTTPS download hash
  matched.
- Not executed: real upgrade on a clean Windows user, physical camera.

## beta.8 game capture and publication (2026-09-13)

- Engine rebuilt with the upstream graphics-hook DLLs, inject-helper and
  get-graphics-offsets executables kept under data/obs-plugins/win-capture (the
  build script previously deleted every binary there, which made game capture
  impossible). Protocol test: 26 checks, including a game layer in
  any_fullscreen mode that prepares without a running game (ready=false) and a
  game layer bound to a missing window being refused. Window capture now
  requests Windows Graphics Capture.
- 64 Node tests, layout smoke (game listed among sources), UI smoke and source
  audit pass. Packaged app started against a throwaway profile.
- Installer 306662516 bytes, SHA-256
  c86bbed21178536e9e586c0dad5ca4f247de8fb48c27b491f0c41ebe6073c561, unsigned
  beta. Published at the immutable URL; signed latest.json offers beta.8 to
  beta.6 and beta.7 and reports beta.8 as current; HTTPS download hash matched.
- Not validated: an actual game hooked on this server (no GPU game available),
  anticheat behaviour, WGC on Windows 10 (yellow border), physical camera.

## beta.10 preview restoration and publication (2026-09-13)

- Real-engine probe on this machine (DPI 100%, zoom 1 and 1.25, maximized
  window) could not reproduce the beta.9 invisible preview; the beta.9 CSS
  viewport conversion was nevertheless the only preview-path change, unverified
  on user hardware, so the beta.8 placement (single conversion in the main
  process, physical bounds checked by the engine) is restored. Bounds failures
  are now displayed in the interface for diagnosis.
- 77 Node tests pass (preview conversion applied once, out-of-window bounds
  rejected, zero bounds hide the child). Layout smoke: the settings sheet sits
  below the preview with all fields reachable; UI smoke, protocol test (engine
  rebuilt as beta.10, geometry checks retained) and native preview smoke pass;
  source audit passes.
- Installer 306673060 bytes, SHA-256
  1489d565b3398073ba02fd9d01478552a334075e38872d61240d1b31b5191814, unsigned
  beta. Packaged app started against a throwaway profile. Published at the
  immutable URL; signed latest.json offers beta.10 to beta.8 and beta.9 and
  reports beta.10 as current; full HTTPS download hash matched.
- Not validated: the user's own machine and DPI; the actual cause of the beta.9
  report remains inferred, so the visible bounds error message is the next
  diagnostic step if it recurs.

## beta.11 game capture fix and publication (2026-09-13)

- Reported from a real machine: selecting Counter-Strike 2 showed "New video
  source is not ready; previous sources preserved" and the scene was never
  applied. Cause: applyLayers required every newly created capture source to
  report non-zero dimensions within three seconds before replacing the
  composition. A game hook is injected and only delivers once the game draws, so
  it routinely misses that window. Game layers are no longer awaited; camera,
  window and display still are. Game matching moved to the executable
  (priority 2), as upstream defaults, because a game retitles its window.
- Engine self-test asserts the readiness rule directly (camera/window/display
  awaited, game never, image/text/synthetic never): three checks. Protocol test,
  33 checks, now also composes a game layer that is not rendering and adds one
  during a live reconfigure, both of which previously failed; that section is
  skipped when a game window is open on the machine so no one's game is captured.
- 77 Node tests, layout smoke, UI smoke, native preview smoke and source audit
  pass. Packaged app starts against a throwaway profile.
- Installer 306687205 bytes, SHA-256
  c7f1ee5d81cf31af03610b2d8e7520320477e08818a70a0d0b623c216e91b5d7, unsigned
  beta. Published at the immutable URL; the signed manifest offers beta.11 to
  beta.9 and beta.10 and reports beta.11 as current; the HTTPS download hash
  matched.
- Not validated: a real game hooked on this server, which has no game GPU;
  anticheat refusal and Vulkan titles (the Vulkan layer is not registered by
  this installer) remain known limits.

## beta.12 live rename and interaction cue (2026-09-13)

- New server surface, published first: PUT /api/lives/studio/title and
  PUT /api/obs/v1/live/{id}/title rename the caller's own open session, and
  the studio state carries session.interaction_seq, the highest interaction id
  of that session. Backend tests cover renaming by the owner only, rejection of
  empty, blank, over-length and control-character titles, refusal once the live
  ended, the directory and the viewer endpoint showing the new title, and the
  counter growing with real purchases while never carrying buyer or amount.
- 78 Node tests including the Studio rename command: whitespace collapsed before
  the request, the exact device route used, the visible title updated at once,
  and six malformed payloads that never reach the server. Layout smoke now edits
  the title during a live and saves it, and checks the interaction switch exists.
- The cue adds no polling: it reads a counter already present in the state both
  surfaces read. One alert every two seconds at most. The Studio switch is in the
  audio panel because a microphone near the speaker would broadcast the cue.
- Engine unchanged in behaviour; protocol, self-test, UI smoke, native preview
  smoke and source audit pass. Packaged app starts against a throwaway profile.
- Installer 306687003 bytes, SHA-256
  de6680c0469f28ae9305bd5e754d96655e99016c2d40b14b53b541a7cfa8326f, unsigned
  beta, published at the immutable URL; manifest offers beta.12 to beta.10 and
  beta.11; HTTPS download hash matched.
- Not validated: a real broadcast being renamed mid-air with viewers attached,
  and the cue heard during an actual live.

## beta.13 held frame, separate scenes and lower latency (2026-09-13)

- Held frame: a new libobs filter (`privex_hold_frame`) caches the last rendered
  frame of a game or window capture and keeps drawing it while the source
  reports no size, which is what happens on alt-tab, on minimize and when a game
  stops drawing. The self-test proves it with pixels on the published mix: a
  synthetic capture that stops delivering keeps its picture on the canvas
  (validHeldFrames 27 while stopped) and is reported as `holding`, so the source
  list shows "quadro congelado" instead of a silent black frame. The filter is
  never attached to a camera, so a frozen face cannot stand in for a person.
- Separate scenes: a scene change now composes a new canvas and hands it to an
  obs-transitions source (slide, fade or cut, 0-2000 ms), instead of editing the
  composition on air into the next one. The self-test asserts the new canvas is a
  different scene object, that the change reaches the published pixels, that a
  source shared by both scenes is not reopened, and that an injected failure
  keeps the previous scene on air while publishing continues. The interval slate
  and the public goal moved to their own output channels (3 and 4) so they stay
  above the scene through a change; the preview now renders the published mix.
- A new scene starts empty and a separate button duplicates the current one.
- Publishing latency: the client encoder uses tune=zerolatency, no B-frames and a
  keyframe every second (about 0.6 s less between this computer and the server).
  Measured cost at the ingest on a 20 s synthetic clip at 2500 kbps: SSIM 0.9903
  against 0.9943. The audience picture is produced by the server re-encode, whose
  settings did not change.
- 80 Node tests, engine self-test (including heldFrameChecks 6, sceneChangeChecks
  7, publishLatencyChecks 5), protocol test, layout smoke at four window sizes,
  UI smoke, native preview smoke (real window capture through the new filter) and
  the source audit all pass. Packaged app starts against a throwaway profile.
- Installer 307548737 bytes, SHA-256
  dd2e256cec7f85bd151534a1da42943dfc81b767311de7c4414901adbad179a0, unsigned
  beta, published at the immutable URL; the signed manifest offers beta.13 to
  beta.10, beta.11 and beta.12 and not to itself; HTTPS download hash matched.
- Not validated: a real game alt-tabbed on this server, which has no game GPU,
  and the end-to-end delay measured with a real broadcast and a real viewer.
