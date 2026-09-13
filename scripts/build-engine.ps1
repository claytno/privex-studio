param(
 [string]$ObsSource,
 [string]$CMake,
 [string]$VisualStudio,
 [string]$MsvcVersion,
 [string]$WindowsSdk
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
if (-not $ObsSource) { $ObsSource = Join-Path $projectRoot 'deps\obs-source' }
if (-not $CMake) { $CMake = (Get-Command cmake -ErrorAction Stop).Source }
if (-not $VisualStudio) {
 $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
 if (-not (Test-Path -LiteralPath $vswhere)) { throw 'Visual Studio discovery unavailable. Install VS2022 C++ build tools or pass -VisualStudio.' }
 $VisualStudio = (& $vswhere -latest -products '*' -version '[17.0,18.0)' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath | Select-Object -First 1)
 if (-not $VisualStudio) { throw 'Visual Studio 2022 with x86/x64 C++ tools is required.' }
}
$studioVersion = (Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json).version
if ($studioVersion -notmatch '^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$') { throw 'Invalid package version for native resource.' }
$engineBuild = Join-Path $projectRoot 'build\engine-cmake'
$enginePackage = Join-Path $projectRoot 'build\engine'
$qtRoot = Join-Path $ObsSource '.deps\obs-deps-qt6-2026-07-15-x64'
$runtime = Join-Path $ObsSource 'build_x64\rundir\RelWithDebInfo'
$platform = if ($WindowsSdk) { "x64,version=$WindowsSdk" } else { 'x64' }
$configure = @('-S',(Join-Path $projectRoot 'engine'),'-B',$engineBuild,'-G','Visual Studio 17 2022','-A',$platform,"-DCMAKE_GENERATOR_INSTANCE=$VisualStudio","-DOBS_SOURCE_DIR=$ObsSource","-DCMAKE_PREFIX_PATH=$qtRoot","-DSTUDIO_VERSION=$studioVersion")
if ($MsvcVersion) { $configure += @('-T',"v143,version=$MsvcVersion") }
& $CMake @configure
if ($LASTEXITCODE -ne 0) { throw 'Engine configuration failed' }
& $CMake --build $engineBuild --config RelWithDebInfo --parallel 4
if ($LASTEXITCODE -ne 0) { throw 'Engine build failed' }
New-Item -ItemType Directory -Force $enginePackage | Out-Null
Copy-Item -LiteralPath (Join-Path $engineBuild 'RelWithDebInfo\PrivexStudioEngine.exe') -Destination $enginePackage -Force
# Bundle media runtime DLLs only; never obs64.exe, frontend API, browser/plugin scripting.
$dlls = @('obs.dll','libobs-d3d11.dll','libobs-winrt.dll','w32-pthreads.dll','Qt6Core.dll','avcodec-62.dll','avdevice-62.dll','avfilter-11.dll','avformat-62.dll','avutil-60.dll','swresample-6.dll','swscale-9.dll','libx264-164.dll','libcurl.dll','zlib.dll','librist.dll','srt.dll')
foreach ($dll in $dlls) { Copy-Item -LiteralPath (Join-Path $runtime "bin\64bit\$dll") -Destination $enginePackage -Force }
$vcRuntime = Get-ChildItem -LiteralPath (Join-Path $VisualStudio 'VC\Redist\MSVC') -Directory | Where-Object Name -Match '^14\.' | Sort-Object Name -Descending | Select-Object -First 1
Get-ChildItem -LiteralPath (Join-Path $vcRuntime.FullName 'x64\Microsoft.VC143.CRT') -Filter '*.dll' | Copy-Item -Destination $enginePackage -Force
$moduleTarget = Join-Path $enginePackage 'obs-plugins\64bit'
$dataTarget = Join-Path $enginePackage 'data\obs-plugins'
New-Item -ItemType Directory -Force $moduleTarget,$dataTarget | Out-Null
Copy-Item -LiteralPath (Join-Path $runtime 'data\libobs') -Destination (Join-Path $enginePackage 'data') -Recurse -Force
$modules = @('win-dshow','win-wasapi','win-capture','obs-x264','obs-ffmpeg','obs-outputs','rtmp-services','image-source','obs-text')
foreach ($module in $modules) {
 Copy-Item -LiteralPath (Join-Path $runtime "obs-plugins\64bit\$module.dll") -Destination $moduleTarget -Force
 $moduleData = Join-Path $runtime "data\obs-plugins\$module"
 if (Test-Path -LiteralPath $moduleData) {
  Get-ChildItem -LiteralPath $moduleData -File -Recurse | Where-Object Extension -NotIn @('.pdb','.exe','.bat','.dll') | ForEach-Object {
   $relative = $_.FullName.Substring($moduleData.Length).TrimStart('\')
   $target = Join-Path (Join-Path $dataTarget $module) $relative
   New-Item -ItemType Directory -Force (Split-Path $target -Parent) | Out-Null
   Copy-Item -LiteralPath $_.FullName -Destination $target -Force
  }
 }
}
# Remove development/virtual-camera installers left by an older local package pass.
# Every resolved file is validated inside this task's engine runtime before deletion.
$resolvedDataTarget = [System.IO.Path]::GetFullPath($dataTarget).TrimEnd('\') + '\'
Get-ChildItem -LiteralPath $dataTarget -File -Recurse | Where-Object Extension -In @('.pdb','.exe','.bat','.dll') | ForEach-Object {
 $resolvedCandidate = [System.IO.Path]::GetFullPath($_.FullName)
 if (-not $resolvedCandidate.StartsWith($resolvedDataTarget, [System.StringComparison]::OrdinalIgnoreCase)) { throw 'Unexpected runtime cleanup path' }
 Remove-Item -LiteralPath $resolvedCandidate -Force
}
Write-Output "Engine ready: $enginePackage\PrivexStudioEngine.exe"
