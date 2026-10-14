param([string]$ReleaseName='WhalePet-Friends-20260930')
$ErrorActionPreference='Stop'
if($ReleaseName -notmatch '^WhalePet-Friends-[0-9-]+$'){throw 'Invalid release name'}
$projectRoot=Split-Path $PSScriptRoot -Parent
$release=$ReleaseName
$stage=Join-Path $projectRoot "output\$release"
$qa=Join-Path $projectRoot ('work\friends-release-qa-'+$release)
if(Test-Path -LiteralPath $qa){throw 'QA directory exists'}
New-Item -ItemType Directory -Path $qa | Out-Null
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip=[IO.Compression.ZipFile]::OpenRead((Join-Path $projectRoot "$release.zip"))
try{
 $count=0
 foreach($entry in $zip.Entries){
  if($entry.FullName.EndsWith('/')){continue}
  $relative=$entry.FullName.Substring($release.Length+1)
  if($relative -match '(^|/)(runtime|node_modules|work|backups|raw|qa|sessions|auth\.json)(/|$)'){throw "Private/development file: $relative"}
  if($relative -match '(^|/)(preferences|window-state|settings|state(?:-(?:chatgpt|deepseek|custom))?)\.json$'){throw "Personal runtime preferences/state: $relative"}
  if($relative -match '\.(mp3|m4a|wav|ogg|jsonl|onnx)$'){throw "Private media/model/transcript: $relative"}
  $source=Join-Path $stage $relative
  $stream=$entry.Open();$sha=[Security.Cryptography.SHA256]::Create()
  try{$hash=[Convert]::ToHexString($sha.ComputeHash($stream))}finally{$stream.Dispose();$sha.Dispose()}
  if($hash -ne (Get-FileHash -LiteralPath $source).Hash){throw "ZIP integrity mismatch: $relative"}
  $count++
 }
 if($count -ne @(Get-ChildItem -LiteralPath $stage -File -Recurse).Count){throw 'ZIP entry count mismatch'}
 Write-Output "ZIP integrity and privacy allowlist verified: $count files"
}finally{$zip.Dispose()}
$extracted=Join-Path $qa 'extracted'
[IO.Compression.ZipFile]::ExtractToDirectory((Join-Path $projectRoot "$release.zip"),$extracted)
$package=Join-Path $extracted $release
$installed=Join-Path $qa 'installed'
$desktop=Join-Path $qa 'test-desktop'
$installer=Start-Process -FilePath (Join-Path $package '安装 WhalePet.exe') -ArgumentList ('--quiet --no-launch --install-root "'+$installed+'" --desktop "'+$desktop+'"') -WindowStyle Hidden -PassThru -Wait
if($installer.ExitCode -ne 0){throw 'Installer failed'}
$shell=New-Object -ComObject WScript.Shell
$shortcut=$shell.CreateShortcut((Join-Path $desktop 'WhalePet.lnk'))
if($shortcut.TargetPath -ne (Join-Path $installed 'electron.exe')){throw 'Shortcut target invalid'}
if($shortcut.IconLocation -notlike '*WhalePet.ico,0'){throw 'Shortcut icon invalid'}
Write-Output 'Extracted ZIP installer and desktop shortcut passed (isolated test directory).'
$env:WHALEPET_PACKAGE_APP=Join-Path $installed 'resources\app'
if(-not (Test-Path -LiteralPath (Join-Path $env:WHALEPET_PACKAGE_APP 'ahoge-pull-assets.js') -PathType Leaf)){throw 'Ahoge pull asset metadata missing'}
# Companion/recovery source and assets are required, but personal game selections are never
# required for installation or the smoke test.
foreach($file in 'reload-action.js','buddy-motion.js','buddy-renderer.js','buddy-policy.js','user-activity.js','native\user-activity.ps1','assets\whalepet-buddy\typing-v1.png','assets\whalepet-buddy\gaming-v1.png','assets\whalepet-buddy\PROMPTS.md','assets\whalepet-v015\WhalePet.ico','recovery-window.js','recovery-preload.js','recovery.html','recovery.js','recovery.css','edge-travel-window.js','edge-travel-preload.js','edge-travel.html','edge-travel.js','edge-travel.css','drag-physics.js','assets\generated-transitions\ahoge-pull\open.png','assets\generated-transitions\ahoge-pull\smile.png'){
 if(-not (Test-Path -LiteralPath (Join-Path $env:WHALEPET_PACKAGE_APP $file) -PathType Leaf)){throw "Companion/recovery runtime file missing: $file"}
}
foreach($file in 'ahoge-pull-assets.js','drag-physics.js','assets\generated-transitions\ahoge-pull\open.png','assets\generated-transitions\ahoge-pull\smile.png'){
 if((Get-FileHash -LiteralPath (Join-Path $env:WHALEPET_PACKAGE_APP $file)).Hash -ne (Get-FileHash -LiteralPath (Join-Path $projectRoot $file)).Hash){throw "Ahoge pull runtime differs from reviewed source: $file"}
}
# A packaged Electron with resources/app ignores a test-script argument. Use the
# development runner (byte-identical Electron engine) to load the installed app.
if((Get-FileHash -LiteralPath (Join-Path $installed 'electron.exe')).Hash -ne (Get-FileHash -LiteralPath (Join-Path $projectRoot 'node_modules\electron\dist\electron.exe')).Hash){throw 'Electron engine mismatch'}
& (Join-Path $projectRoot 'node_modules\.bin\electron.cmd') (Join-Path $projectRoot 'tests\friends-package.js')
if($LASTEXITCODE -ne 0){throw 'Installed runtime smoke test failed'}
