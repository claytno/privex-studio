# Draft: reviewed source-based recipe. Syntax checked; clean upstream build not yet executed.
# Move with native-build.lock.json into the standalone repository scripts/ directory.
# No software installers, signature operations, machine configuration or public uploads.
[CmdletBinding()]
param(
 [Parameter(Mandatory=$true)][string]$StudioRoot,
 [string]$CMake,
 [string]$VisualStudio,
 [ValidateRange(1,32)][int]$Parallel=4,
 [switch]$ConfigureOnly
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$lock=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'native-build.lock.json') -Raw | ConvertFrom-Json
$StudioRoot=[IO.Path]::GetFullPath($StudioRoot)
if(-not(Test-Path -LiteralPath (Join-Path $StudioRoot 'engine\CMakeLists.txt'))){throw 'StudioRoot must contain the standalone engine sources.'}
if(-not $CMake){$CMake=(Get-Command cmake -ErrorAction Stop).Source}
if(-not $VisualStudio){
 $vswhere=Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
 if(-not(Test-Path -LiteralPath $vswhere)){throw 'Install VS2022 C++ tools or pass -VisualStudio.'}
 $VisualStudio=(& $vswhere -latest -products '*' -version '[17.0,18.0)' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath | Select-Object -First 1)
 if(-not $VisualStudio){throw 'VS2022 C++ toolchain not found.'}
}
function Invoke-Checked([string]$Program,[string[]]$Arguments){
 & $Program @Arguments
 if($LASTEXITCODE -ne 0){throw ('Native command failed: '+[IO.Path]::GetFileName($Program)+' (exit '+$LASTEXITCODE+')')}
}
$cmakeVersion=(& $CMake --version | Select-Object -First 1)
if($LASTEXITCODE -ne 0 -or $cmakeVersion -ne ('cmake version '+$lock.toolchain.cmake)){throw ('Pinned CMake '+$lock.toolchain.cmake+' required; found '+$cmakeVersion)}
$cl=Join-Path $VisualStudio ('VC\Tools\MSVC\'+$lock.toolchain.msvc+'\bin\Hostx64\x64\cl.exe')
if(-not(Test-Path -LiteralPath $cl)){throw ('Install the pinned MSVC '+$lock.toolchain.msvc+' x86/x64 toolset and ATL through Visual Studio Installer.')}
$sdk=Join-Path ${env:ProgramFiles(x86)} ('Windows Kits\10\Include\'+$lock.toolchain.sdk+'\um\Windows.h')
if(-not(Test-Path -LiteralPath $sdk)){throw ('Windows SDK '+$lock.toolchain.sdk+' is required.')}
$obs=Join-Path $StudioRoot 'deps\obs-source'
if(-not(Test-Path -LiteralPath $obs)){
 New-Item -ItemType Directory -Force (Split-Path $obs -Parent) | Out-Null
 Invoke-Checked git @('init',$obs)
 Invoke-Checked git @('-C',$obs,'config','core.autocrlf','false')
 Invoke-Checked git @('-C',$obs,'remote','add','origin',$lock.obs.url)
 Invoke-Checked git @('-C',$obs,'fetch','--depth=1','origin',$lock.obs.commit)
 Invoke-Checked git @('-C',$obs,'checkout','--detach',$lock.obs.commit)
}
$head=(& git -C $obs rev-parse HEAD)
if($LASTEXITCODE -ne 0 -or $head.Trim() -ne $lock.obs.commit){throw 'Existing OBS checkout does not match the lock; use a fresh workspace.'}
$origin=(& git -C $obs remote get-url origin)
if($LASTEXITCODE -ne 0 -or $origin.Trim() -ne $lock.obs.url){throw 'OBS origin must match the official locked URL.'}
$dirty=(& git -C $obs status --porcelain --untracked-files=normal)
if($LASTEXITCODE -ne 0 -or $dirty){throw 'OBS sources must be clean. Legacy frontend/plugin patches are not used.'}
# Only the repository-pinned submodule revisions; never --remote or an unpinned branch.
Invoke-Checked git @('-C',$obs,'-c','protocol.file.allow=never','submodule','update','--init','--recursive','--depth=1')
foreach($entry in $lock.submodules.PSObject.Properties){
 $module=Join-Path $obs $entry.Name
 $revision=(& git -C $module rev-parse HEAD)
 if($LASTEXITCODE -ne 0 -or $revision.Trim() -ne $entry.Value){throw ('Unexpected submodule revision: '+$entry.Name)}
 $changes=(& git -C $module status --porcelain --untracked-files=normal)
 if($LASTEXITCODE -ne 0 -or $changes){throw ('Modified submodule: '+$entry.Name)}
}
$deps=Join-Path $obs '.deps'
New-Item -ItemType Directory -Force $deps | Out-Null
# Check cached ZIPs too: upstream's CMake downloader verifies newly downloaded files,
# but its existing-file fast path does not rehash the archive before extracting.
foreach($archive in $lock.archives){
 $destination=Join-Path $deps $archive.name
 if(-not(Test-Path -LiteralPath $destination)){
  $temporary=$destination+'.part'
  Invoke-WebRequest -Uri $archive.url -OutFile $temporary -MaximumRedirection 5
  if((Get-FileHash -LiteralPath $temporary -Algorithm SHA256).Hash.ToLowerInvariant() -ne $archive.sha256){throw ('Dependency hash mismatch: '+$archive.name)}
  Move-Item -LiteralPath $temporary -Destination $destination
 }
 if((Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant() -ne $archive.sha256){throw ('Cached dependency hash mismatch: '+$archive.name)}
}
# Avoid an unverified extracted cache. No deletion is performed: choose a clean workspace.
foreach($archiveDir in @('obs-deps-2026-07-15-x64','obs-deps-2026-07-15-x86','obs-deps-qt6-2026-07-15-x64')){
 if(Test-Path -LiteralPath (Join-Path $deps $archiveDir)){throw 'Extracted dependency cache already exists. Use a clean CI workspace; validated ZIP caches alone may be reused.'}
}
$build=Join-Path $obs 'build_x64'
$configure=@('-S',$obs,'-B',$build,'-G',$lock.toolchain.generator,'-A',('x64,version='+$lock.toolchain.sdk),'-T',('v143,version='+$lock.toolchain.msvc),('-DCMAKE_GENERATOR_INSTANCE='+$VisualStudio),'-DCMAKE_TLS_VERIFY=ON','-DENABLE_FRONTEND=OFF','-DENABLE_BROWSER=OFF','-DENABLE_WEBSOCKET=OFF','-DENABLE_SCRIPTING=OFF','-DENABLE_VIRTUALCAM=OFF','-DENABLE_AJA=OFF','-DENABLE_DECKLINK=OFF','-DENABLE_VLC=OFF','-DENABLE_VST=OFF','-DENABLE_WEBRTC=OFF','-DENABLE_NVENC=OFF','-DENABLE_QSV11=OFF','-DENABLE_NVAFX=OFF','-DENABLE_NVVFX=OFF','-DENABLE_TEST_INPUT=OFF')
Invoke-Checked $CMake $configure
if($ConfigureOnly){Write-Output 'Configuration completed; no clean build or native runtime validation is claimed.';return}
$targets=@('obs','libobs-d3d11','libobs-winrt','w32-pthreads','win-dshow','win-wasapi','win-capture','obs-x264','obs-ffmpeg','obs-outputs','rtmp-services','image-source','obs-text')
Invoke-Checked $CMake (@('--build',$build,'--config',$lock.toolchain.configuration,'--parallel',"$Parallel",'--target')+$targets)
# A frontend-less target build does not call obs-studio's _bundle_dependencies.
# Populate only the same dependency DLL allowlist needed by the standalone engine.
$runtime=Join-Path $build 'rundir\RelWithDebInfo\bin\64bit'
New-Item -ItemType Directory -Force $runtime | Out-Null
$prebuiltBin=Join-Path $deps 'obs-deps-2026-07-15-x64\bin'
foreach($name in @('avcodec-62.dll','avdevice-62.dll','avfilter-11.dll','avformat-62.dll','avutil-60.dll','swresample-6.dll','swscale-9.dll','libx264-164.dll','libcurl.dll','zlib.dll','librist.dll','srt.dll')){
 Copy-Item -LiteralPath (Join-Path $prebuiltBin $name) -Destination $runtime -Force
}
Copy-Item -LiteralPath (Join-Path $deps 'obs-deps-qt6-2026-07-15-x64\bin\Qt6Core.dll') -Destination $runtime -Force
& (Join-Path $StudioRoot 'scripts\build-engine.ps1') -ObsSource $obs -CMake $CMake -VisualStudio $VisualStudio -MsvcVersion $lock.toolchain.msvc -WindowsSdk $lock.toolchain.sdk
if($LASTEXITCODE -ne 0){throw 'Standalone engine build failed.'}
$enginePackage=Join-Path $StudioRoot 'build\engine'
foreach($forbidden in @('obs64.exe','obs-browser.dll','obs-frontend-api.dll','obspython.dll','obslua.dll','obs-websocket.dll')){
 if(Get-ChildItem -LiteralPath $enginePackage -Recurse -File -Filter $forbidden){throw ('Unexpected runtime artifact: '+$forbidden)}
}
$inventory=@(Get-ChildItem -LiteralPath $enginePackage -Recurse -File | Sort-Object FullName | ForEach-Object {
 [ordered]@{path=$_.FullName.Substring($enginePackage.Length+1).Replace('\','/');sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant();bytes=$_.Length}
})
[ordered]@{status='built-not-runtime-tested';obs_commit=$lock.obs.commit;submodules=$lock.submodules;toolchain=$lock.toolchain;archives=$lock.archives;targets=$targets;configuration=$configure;runtime=$inventory;signatureCreated=$false;bitForBitReproductionClaimed=$false} | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath (Join-Path $StudioRoot 'build\native-provenance.json') -Encoding utf8
Write-Output 'Native build completed. Run tests and the independent package audit before signing or distribution.'
