# Building Privex Studio

Node24, npm and Git are required. The private Privex repository is never required.
Run npm ci, npm test and npm run build:ui from this directory. npm dependencies
are fixed by package-lock.json. If npm blocks a dependency's installation hook,
review that hook before explicitly allowing it; Electron needs its official
runtime download and esbuild needs its platform executable.

## Native Windows engine

Install Visual Studio2022 C++ tools including ATL, MSVC14.44.35207 and Windows
SDK10.0.26100.0, and CMake3.31.6. The bootstrap discovers Visual Studio with
vswhere and cmake on PATH; explicit tool paths are also supported.

```powershell
pwsh -File scripts/bootstrap-native.ps1 -StudioRoot $PWD
```

The script fetches the official OBS commit, initializes pinned submodules and
verifies dependency ZIP SHA-256 hashes. It rejects modified source and old
extracted caches. It compiles media components and our wrapper, and records
build/native-provenance.json. See scripts/native-build.lock.json and
[the build review](docs/BUILD-REPRODUCIBILITY.md). A successful build is not a
claim of byte-for-byte reproducibility, a camera test or SignPath approval.

## Corresponding dependency sources

```powershell
git init deps/obs-deps-source
git -C deps/obs-deps-source remote add origin https://github.com/obsproject/obs-deps.git
git -C deps/obs-deps-source fetch --depth=1 origin 8683107a02300923abe4f293920f4b5edc8cb624
git -C deps/obs-deps-source checkout --detach 8683107a02300923abe4f293920f4b5edc8cb624
node scripts/prepare-dependency-sources.mjs
```

The collector reads the pinned recipes, downloads matching source archives,
checks expected hashes and writes the source inventory. It does not execute
downloaded source. The package build requires this inventory and refuses missing
licenses or sources.

## Installer

Install Inno Setup6.7.3 from its official distribution, then:

```powershell
node scripts/audit-source.mjs
npm run package
pwsh -File scripts/build-installer.ps1 -Channel beta -AllowUnsignedBeta -IsccPath '<path-to-ISCC.exe>'
```

This creates an **unsigned beta**. It may be blocked by Smart App Control.
SignPath integration is pending project acceptance and configuration of the
organization, project, artifact configuration and manual approval policy.
Do not upload local binaries and claim they were built by a verified CI job.

## Validation

Run node --test engine/protocol.test.cjs and the engine self-test after building.
Renderer layout tests run with Electron: node_modules/electron/dist/electron.exe
tests/layout-smoke.cjs. Native preview capture requires an active interactive
Windows desktop. The explicit --geometry-only mode tests window positioning,
not camera or captured pixels. Test streaming with an authorized test account.

The workflow runs unit tests and a frontend build on GitHub-hosted Windows.
Native release provenance must also be built and validated on GitHub-hosted
workers before a Foundation signing request; that release integration remains
pending. No workflow has production credentials or publishes a live update.
