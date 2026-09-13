# Standalone native build: evidence and proposed recipe

Status: source inspection and PowerShell syntax validation completed. The clean
upstream configuration/build below has **not** been run in this task. This is a
reviewable draft, not evidence of a successful clean-room build or SignPath approval.

## Inputs that can be made public

`native-build.lock.json` fixes OBS 32.2.2 to
`ba2f32bdf791005443988a4955e963663e16b1ed`, all four recursive submodule revisions,
and the SHA-256 of the official x64/x86 dependency and x64 Qt ZIPs. No existing
private repository, compiled local runtime, token, or deployment configuration is
an input to the proposed build. The application root must contain its own engine,
scripts, UI sources and package lock.

Reviewed upstream build files at that revision:

- `CMakePresets.json`: versions/hashes; Windows preset selects VS18/2026, so this
  recipe intentionally uses explicit VS17/2022 arguments instead of that preset.
- `cmake/windows/architecture.cmake`: x64 configure recursively configures x86
  capture helpers. The x86 dependency ZIP and x86 toolchain are required even
  though the delivered application is x64 and virtual camera is disabled.
- `cmake/common/buildspec_common.cmake`: new downloads use EXPECTED_HASH; an
  existing ZIP is not rehashed on that fast path. The draft verifies all cached
  archives itself and rejects pre-extracted caches to avoid trusting their content.
- `cmake/windows/buildspec.cmake`: archive names/destination folders; CEF download
  is skipped when browser support is disabled, but Qt is still prepared for x64.
- `cmake/windows/helpers.cmake`: dependency DLL copying is attached to the OBS
  frontend executable. A frontend-less build must explicitly stage the permitted
  prebuilt dependency DLLs; the draft does this before building the Privex engine.

## Toolchain and execution

Prerequisites: Windows x64; PowerShell7; Git; CMake3.31.6; Visual Studio2022 C++
x86/x64 tools, MSVC14.44.35207, ATL and Windows SDK10.0.26100.0. Install these
through their normal trusted distribution channels; the script does not install
software, change certificate stores, change machine configuration, or run an
upstream convenience PowerShell installer. Ensure adequate disk space for native
sources, dependency ZIPs, extraction, compilation and symbols; measure the first
clean run before fixing CI resource/time budgets.

The previously observed local build used Microsoft's bundled
`3.31.6-msvc6` variant. This draft deliberately pins public Kitware `3.31.6`
instead; passing that old bundled executable will fail the explicit version
check. Do not silently accept an arbitrary CMake version just to make CI green.
Validate the clean build with the pinned public tool before adopting this recipe.

After reviewing and moving both draft script and lock into `scripts/`:

```powershell
# From a fresh standalone checkout. A cached download directory may contain ZIPs
# verified by the script, but not previously extracted dependency trees.
pwsh -File scripts/bootstrap-native.ps1 -StudioRoot $PWD

# Syntax/configuration trial only; use another clean workspace for the full run.
pwsh -File scripts/bootstrap-native.ps1 -StudioRoot $PWD -ConfigureOnly
```

Discovery uses `cmake` on PATH and `vswhere`. Explicit `-CMake`/`-VisualStudio`
paths are supported. The bootstrap rejects a different OBS commit, modified source
tree or modified submodule. Git fetch is pinned to a complete commit ID, and
submodule initialization never follows moving branches. CMake executes the pinned
build sources only after those checks. Review changes to the lock/bootstrap as
code before running them.

The selected targets build libobs, D3D11, WinRT, threading and exactly the nine
modules the engine loads: win-dshow, win-wasapi, win-capture, obs-x264, obs-ffmpeg,
obs-outputs, rtmp-services, image-source and obs-text. Frontend, browser, websocket,
scripting, virtual camera and unused optional integrations are disabled. Their
sources may remain as pinned submodules, but their binaries are not in the native
runtime. Some capture/mux helper build targets can still be built as dependencies;
the existing package allowlist excludes helper EXEs/DLLs and virtual-camera files.

The standalone `scripts/build-engine.ps1` now defaults to `deps/obs-source` and
discovers its tools. Optional pinned MSVC/SDK parameters preserve exact CI choices.
It passes `package.json`'s version into the engine's new VERSIONINFO resource,
including ProductName, OriginalFilename and full beta version. This is metadata,
not a digital signature. Native application behavior was not changed for this work.

## Required upstream changes: none for the new architecture

The current local upstream checkout contains these **legacy fork** modifications:

| Path | Diff summary | Needed for standalone engine? |
| --- | --- | --- |
| `cmake/common/bootstrap.cmake` | 2 added/2 removed; product/website branding | No; keep upstream identity on upstream libraries |
| `frontend/obs-main.cpp` | 2 added/2 removed; old frontend customization | No |
| `frontend/settings/OBSBasicSettings_Stream.cpp` | 3 added/1 removed; old stream settings integration | No |
| `frontend/widgets/OBSBasic.cpp` | 7 added/8 removed; old UI customization | No |
| `frontend/widgets/OBSBasic_Service.cpp` | 6 added; old service integration | No |
| `plugins/CMakeLists.txt` | 1 added; registers legacy Privex plugin | No |
| `plugins/privex-studio/CMakeLists.txt` and `privex-studio.cpp` | Untracked legacy plugin | No |

No tracked libobs or other media-module source modification was found. Therefore
the proposed recipe starts with clean upstream, adds no fork branding patch and
does not compile the legacy frontend/plugin. Changing build configuration and
version metadata means these are newly built artifacts, not byte-identical copies
of the previous local runtime. Public corresponding-source bundles should describe
this new build, not accidentally include the old private-client fork patch.

## CI and signing provenance

SignPath's GitHub connector checks that a workflow built and uploaded the artifact;
for its OSS offering the workflow jobs leading to signing must use GitHub-hosted
runners. A runtime copied from this developer PC or produced by a self-hosted runner
is therefore not an adequate replacement. Configure the SignPath GitHub app,
restricted policies and workflow-artifact submission after a clean hosted build
passes. [Official GitHub integration](https://docs.signpath.io/trusted-build-systems/github).

Opening only the client can be a sensible boundary, but acceptance is not automatic:
the client package and its included components must meet the Foundation's OSS
conditions. Review assets, licensing, bundled source completeness, MFA and the
published code-signing policy. Do not configure a blanket rule to re-sign every
upstream DLL. Clarify treatment of the repackaged Electron executable and upstream
OBS/dependency binaries with SignPath before enabling signing.
[Foundation conditions](https://signpath.org/terms.html).

Suggested release sequence after eligibility/configuration are settled:

1. Clean GitHub-hosted checkout of the public Studio revision; fixed action commits,
   npm lock, native lock and recorded runner/toolchain versions.
2. Bootstrap native libraries; build own engine and React/Electron package. Run
   unit tests, package-source inventory checks and filesystem/network allowlists.
3. Upload an unsigned workflow artifact, then request the narrowly configured
   signature. Do not sign from untrusted pull-request workflows or use a signing
   token with arbitrary artifact upload permissions.
4. Reconstruct/verify the installer from the signed inputs as required by the
   approved signing flow; verify Authenticode, version resources, files/hashes,
   ASAR integrity and installer contents. Updater manifest signing is a separate
   release step and never belongs in this bootstrap.

Remaining validation: clean CMake configure including x86 helper dependencies;
module target staging; native import closure; engine version-resource inspection;
packaged launch; installation/update/uninstallation; capture/preview and RTMPS on
an interactive Windows machine. Hosted Windows runners may have no usable physical
capture device/GPU; report those tests separately rather than skipping them and
claiming camera coverage. Official dependency ZIPs are pinned binary inputs, not
libraries rebuilt from source in this recipe. Source-rebuild coverage and
bit-for-bit reproducibility remain separate projects. The script's JSON inventory
is useful evidence but is not itself a SignPath/SLSA attestation.
