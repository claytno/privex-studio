# Privex Studio native media engine

Own C++ executable using libobs, with no OBS frontend executable/API, browser, scripting, websocket server or user plugin scanning. The Electron main process owns its bounded stdin/stdout JSON pipe. The React renderer must never receive publication credentials or unrestricted access to this pipe.

Build: `powershell -File scripts/build-engine.ps1`. Runtime: `build/engine/PrivexStudioEngine.exe`, with adjacent DLLs, `data` and `obs-plugins`. Run verification: `node engine/protocol.test.cjs`.

## Protocol 1

One JSON object per line: `{ "id": 1, "command": "status" }`. Replies `{id,ok:true,result}` or `{id,ok:false,error}`. Events: `{event:"ready",protocol:1}` and flat `{event:"status",...}` every second. Input lines are limited to 16 KiB and queue to 64; EOF closes output and all capture. The host must apply timeouts, restrict the parent process, enforce app singleton, and kill the child if graceful termination fails.

| Command | Fields / behavior |
|---|---|
| `enumerate` | Returns arrays cameras/microphones/displays/windows `{id,name}`. Does not start physical capture. |
| `prepare` | `sourceType` camera/display/window; `cameraId` for camera or `sourceId` otherwise; explicit `microphoneId` or empty for silence; `muted`; width/height 1280×720,720×1280,1920×1080,1080×1920; fps30. Starts local capture only after user chooses. |
| `prepare` preview | Optional `parentHwnd` decimal or `0x` string, window must belong to engine's parent process. `bounds:{x,y,width,height}` physical pixels. Native compositor child window, no frame copies through JS. |
| `resize` | `bounds:{x,y,width,height}` physical pixels. |
| `preview` | `visible:boolean`, hides preview without stopping transmission. |
| `mute` | `muted:boolean`. Only selected mic enters audio mix. Camera embedded audio is always excluded. |
| `scene` | `mode:"pause"` or `"live"`. Pause hides video behind a native interval slate and forces mic mute. Resume restores the earlier requested mute state; a mute request during pause changes that later state, never opens the mic during pause. |
| `overlay` | `visible:boolean`; when visible, public `title` (max100 characters), nonnegative integer `raisedCents` and positive integer `targetCents`. Native text and progress bar, no URLs/scripts/files. Host must obtain amounts from backend, not user edits. Requires prepared capture; stop removes goal data to prevent stale session/account values. |
| `start` | `server` RTMPS only, `streamKey` temporary publication grant. Host supplies both from authenticated backend; never renderer. Requires video with nonzero dimensions. H264 veryfast CBR 2500 kbps720p /4500 kbps1080p, AAC128 kbps, 2-second keyframes. |
| `stop` | Idempotently ends output and releases camera, microphone and preview. Must prepare again before starting another stream. |
| `status` | state idle/ready/connecting/streaming/reconnecting; prepared, streaming, muted, canvas/source dimensions, totalBytes, droppedFrames, numeric stopCode. Never includes keys or raw network errors. |
| `shutdown` | Ends output/capture, frees media engine and exits. |

Canvas always fits the full source (no implicit crop/zoom). Preview fits the same canvas. Exact window title matching prevents fallback to another title or full desktop. A specific microphone is required rather than OS default to prevent changing to a different mic silently. Reconnection attempts are bounded to 5 retries ×3 seconds; backend remains authoritative and host must stop on revocation/session end. OBS presence is not proof of server playback.

## Security and packaging

- No credentials persisted by this engine; active service necessarily holds the temporary key in memory until output cleanup. Managed-string copies cannot be guaranteed to be erased. Never claim protection against inspection by the same Windows user/admin.
- Normal libobs logs are suppressed because third-party modules may log publish URLs. Only self-test emits initialization warnings, and self-test cannot publish or capture physical devices.
- Load fixed module names from installation path only. Bundled media modules: win-dshow, win-wasapi, win-capture, obs-x264, obs-ffmpeg, obs-outputs, rtmp-services, image-source, obs-text.
- Compiler enables ASLR, NX, high-entropy ASLR and control-flow guard. This does not replace signed installation/update packages and server authorization.
- Installer must distribute upstream license notices and corresponding source as applicable. OBS/libobs upstream32.2.2 commit `ba2f32bdf791005443988a4955e963663e16b1ed`; Qt dependency bundle2026-07-15, x264/FFmpeg included by upstream build. Never remove their obligations or represent third-party components as privately authored.

## Verification and limits

Compiled `--self-test` renders an actual1280×720 synthetic white source on a720×1280 GPU canvas and reads BGRA output frames: both side edges and center remain white, top/bottom remain black. Further GPU pixel checks prove interval covers the camera and the native goal bar reflects50% progress, with native GDI text texture created. Pause/resume tests preserve both previously muted and unmuted states using a synthetic source flag, without microphone access. Checks bundled H264/AAC encoder construction. Protocol test covers error responses, missing devices, invalid resize/mute, duplicate stop, no plaintext runtime stderr, and EOF cleanup. No real camera, microphone, public stream or account involved.

`node tests/native-preview-smoke.cjs` additionally runs the real Electron host and `main/engine.cjs` wrapper with an exclusively synthetic owned window (no camera, mic, desktop capture or publishing). It verifies capture dimensions, engine-owned child HWND,640×360 preview, hide/restore, resize, pause/resume, and removal of capture/child window on stop. On this workstation, targeted `PrintWindow` successfully captured the Direct3D child: red/green/blue synthetic pixels verified. The helper never captures the desktop or another user's window. Evidence is written to `build/native-preview-smoke/report.json` and `native-child-printwindow.png`. The .NET helper is test-only and is not bundled in the app.

Physical device variations, prolonged RTMPS delivery, device removal during output, and end-to-end audio synchronization still require hardware validation. Native parenting is tested with the real Electron/engine bridge in an isolated fixture; final application modal/route positioning remains a UI integration concern. This initial engine has one selected video source plus interval and native goal overlay; custom scene editing, picture-in-picture, arbitrary browser overlays, and system audio mixer are later media work, not implemented by this binary.
