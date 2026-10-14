param(
  [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA "WhalePet\v0.15"),
  [string]$DesktopPath = [Environment]::GetFolderPath("Desktop"),
  [switch]$NoLaunch
)

$ErrorActionPreference = "Stop"
$sourceRoot = $PSScriptRoot
$sourceExe = Join-Path $sourceRoot "electron.exe"
$sourceApp = Join-Path $sourceRoot "resources\app"
$sourceIcon = Join-Path $sourceRoot "WhalePet.ico"

foreach ($required in @($sourceExe, $sourceApp, $sourceIcon)) {
  if (-not (Test-Path -LiteralPath $required)) {
    throw "安装包不完整，缺少：$required"
  }
}

$sourceResolved = (Resolve-Path -LiteralPath $sourceRoot).Path
$installFullPath = [IO.Path]::GetFullPath($InstallRoot)
if ($installFullPath.StartsWith($sourceResolved + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
  throw "安装位置不能放在当前解压文件夹内部。"
}

New-Item -ItemType Directory -Path $installFullPath -Force | Out-Null
Get-ChildItem -LiteralPath $sourceResolved -Force | Copy-Item -Destination $installFullPath -Recurse -Force

New-Item -ItemType Directory -Path $DesktopPath -Force | Out-Null
$targetExe = Join-Path $installFullPath "electron.exe"
$targetApp = Join-Path $installFullPath "resources\app"
$targetIcon = Join-Path $installFullPath "WhalePet.ico"
$shortcutPath = Join-Path $DesktopPath "WhalePet.lnk"

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $targetExe
$shortcut.Arguments = '"' + $targetApp + '"'
$shortcut.WorkingDirectory = $installFullPath
$shortcut.IconLocation = $targetIcon + ",0"
$shortcut.Description = "可爱的小鲸桌面宠物"
$shortcut.Save()

Write-Host ""
Write-Host "安装完成！桌面已经创建 WhalePet 图标。" -ForegroundColor Cyan
Write-Host "安装位置：$installFullPath"

if (-not $NoLaunch) {
  Start-Process -FilePath $targetExe -ArgumentList ('"' + $targetApp + '"') -WorkingDirectory $installFullPath
}
