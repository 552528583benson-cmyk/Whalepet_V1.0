param([string]$ReleaseName='WhalePet-Friends-20260920')
$ErrorActionPreference='Stop'
if($ReleaseName -notmatch '^WhalePet-Friends-[0-9-]+$'){throw 'Invalid release name'}
$projectRoot=Split-Path $PSScriptRoot -Parent
$stage=Join-Path $projectRoot "output\$ReleaseName"
$zipPath=Join-Path $projectRoot "$ReleaseName.zip"
if((Test-Path -LiteralPath $stage) -or (Test-Path -LiteralPath $zipPath)){throw 'Release exists; do not overwrite reviewed artifacts'}
$appDir=Join-Path $stage 'resources\app'
New-Item -ItemType Directory -Path $appDir -Force | Out-Null
$electronRoot=Join-Path $projectRoot 'node_modules\electron\dist'
# Keep the engine and all GPU fallbacks; omit its demo app and unused UI locales.
Get-ChildItem -LiteralPath $electronRoot -File | Copy-Item -Destination $stage
New-Item -ItemType Directory -Path (Join-Path $stage 'locales') | Out-Null
foreach($locale in 'en-US','zh-CN','zh-TW'){
 Copy-Item -LiteralPath (Join-Path $electronRoot "locales\$locale.pak") -Destination (Join-Path $stage 'locales')
}
$appFiles=@('main.js','pet.js','preload.js','index.html','style.css','idle-life.js','drag-physics.js','drag-math.js','state-schema.js','codex-state-follower.js','preferences.js','settings-window.js','settings-preload.js','settings.js','settings.html','settings.css','set-whalepet-state.js','get-whalepet-status.js','PROVIDER_INTEGRATION.md')
foreach($file in $appFiles){Copy-Item -LiteralPath (Join-Path $projectRoot $file) -Destination $appDir}
$package=Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json
# Runtime-only manifest: no developer commands or dependencies are shipped.
@{name=$package.name;productName=$package.productName;version=$package.version;private=$true;main='main.js';description=$package.description} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $appDir 'package.json') -Encoding utf8
$hd=Join-Path $appDir 'assets\whalepet-hd'
New-Item -ItemType Directory -Path (Join-Path $hd 'idle-life') -Force | Out-Null
foreach($pose in 'idle','connecting','thinking','reading','searching','tool-use','working','testing','generating','needs-input','ready','blocked'){
 Copy-Item -LiteralPath (Join-Path $projectRoot "assets\whalepet-hd\$pose.png") -Destination $hd
}
Copy-Item -LiteralPath (Join-Path $projectRoot 'assets\whalepet-hd\idle-life\blink-source.png') -Destination (Join-Path $hd 'idle-life')
$tail=Join-Path $appDir 'assets\generated-transitions\tail-hang'
New-Item -ItemType Directory -Path $tail -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $projectRoot 'assets\generated-transitions\tail-hang\pose.png') -Destination $tail
Copy-Item -LiteralPath (Join-Path $projectRoot 'assets\whalepet-v015\WhalePet.ico') -Destination (Join-Path $stage 'WhalePet.ico')
foreach($file in 'ASSET_ATTRIBUTION.md','THIRD_PARTY_REFERENCES.md','LICENSES'){
 Copy-Item -LiteralPath (Join-Path $projectRoot $file) -Destination $stage -Recurse
}
Copy-Item -LiteralPath (Join-Path $projectRoot 'docs\FRIENDS-README.txt') -Destination (Join-Path $stage 'SHARE-README.txt')
$compiler=Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
& $compiler /nologo /target:winexe /reference:System.Windows.Forms.dll "/win32icon:$(Join-Path $stage 'WhalePet.ico')" "/out:$(Join-Path $stage '安装 WhalePet.exe')" (Join-Path $PSScriptRoot 'WhalePetInstaller.cs')
if($LASTEXITCODE -ne 0){throw 'Installer compilation failed'}
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::CreateFromDirectory($stage,$zipPath,[IO.Compression.CompressionLevel]::Optimal,$true)
Get-Item -LiteralPath $zipPath | Select-Object FullName,Length
Get-FileHash -LiteralPath $zipPath -Algorithm SHA256
