param(
  [string]$GamesJsonBase64 = 'W10=',
  [ValidateSet('0', '1')][string]$ReadKeyboard = '1',
  [int]$OwnerProcessId = 0
)

# No hook, injection, text decoding, window title, network request, or activity
# file. Only the final aggregate JSON below is sent to the WhalePet parent.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

try {
  # Windows PowerShell 5.1 emits a JSON array as one pipeline object, including
  # an empty Object[]; wrapping that pipeline directly creates a nested array.
  # Collect first, then enumerate the value so an empty allowlist stays empty.
  $decodedGames = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($GamesJsonBase64)) | ConvertFrom-Json
  $gameNames = @($decodedGames)
  if ($gameNames.Count -gt 32) { exit 1 }
  foreach ($gameName in $gameNames) {
    if ($gameName -isnot [string] -or $gameName.Length -gt 80 -or $gameName -notmatch '^[\p{L}\p{N}_. -]+$' -or $gameName -eq '.' -or $gameName -eq '..') { exit 1 }
  }
  Add-Type -TypeDefinition @'
using System;
using System.Diagnostics;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public static class WhalePetActivity {
    [DllImport("user32.dll")]
    private static extern short GetAsyncKeyState(int virtualKey);
    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
    private static readonly bool[] down = new bool[256];
    private static bool initialized = false;

    public static int PollKeyboard(out bool held) {
        int presses = 0;
        held = false;
        for (int key = 0x08; key <= 0xFE; key++) {
            // Mouse codes are below 0x08. Skip generic modifiers because their
            // left/right codes would count the same physical key twice.
            if (key == 0x10 || key == 0x11 || key == 0x12) continue;
            // Use only the high bit (currently down). The low "since last
            // call" bit is explicitly unreliable across processes on Windows.
            bool current = GetAsyncKeyState(key) < 0;
            if (initialized && current && !down[key]) presses++;
            held |= current;
            down[key] = current;
        }
        initialized = true;
        return presses;
    }

    public static bool IsSelectedGame(string[] allowed) {
        if (allowed == null || allowed.Length == 0) return false;
        IntPtr window = GetForegroundWindow();
        if (window == IntPtr.Zero) return false;
        uint foregroundProcessId;
        if (GetWindowThreadProcessId(window, out foregroundProcessId) == 0 || foregroundProcessId == 0) return false;
        try {
            using (Process process = Process.GetProcessById((int)foregroundProcessId)) {
                string name = process.ProcessName;
                foreach (string candidate in allowed) {
                    if (String.Equals(name, candidate, StringComparison.OrdinalIgnoreCase)) return true;
                }
            }
        } catch { }
        return false;
    }

    public static bool OwnerAlive(int processId) {
        if (processId <= 0) return false;
        try {
            using (Process process = Process.GetProcessById(processId)) { return !process.HasExited; }
        } catch { return false; }
    }
}
'@

  $clock = [Diagnostics.Stopwatch]::StartNew()
  $pendingPresses = 0
  $held = $false
  $gaming = $false
  $sentHeld = $false
  $sentGaming = $false
  $lastSent = -1000L
  $lastGamePoll = -1000L
  $lastOwnerCheck = -1000L
  while ($true) {
    $now = $clock.ElapsedMilliseconds
    if (($now - $lastOwnerCheck) -ge 500) {
      if (-not [WhalePetActivity]::OwnerAlive($OwnerProcessId)) { break }
      $lastOwnerCheck = $now
    }
    if ($ReadKeyboard -eq '1') {
      $sampleHeld = $false
      $pendingPresses += [WhalePetActivity]::PollKeyboard([ref]$sampleHeld)
      $held = $sampleHeld
    }
    if (($now - $lastGamePoll) -ge 250) {
      $gaming = [WhalePetActivity]::IsSelectedGame([string[]]$gameNames)
      $lastGamePoll = $now
    }
    $changed = $pendingPresses -gt 0 -or $held -ne $sentHeld -or $gaming -ne $sentGaming
    if (($now - $lastSent) -ge 100 -and ($changed -or ($now - $lastSent) -ge 1000)) {
      $json = '{"presses":' + $pendingPresses + ',"held":' + $held.ToString().ToLowerInvariant() + ',"gaming":' + $gaming.ToString().ToLowerInvariant() + '}'
      [Console]::WriteLine($json)
      $pendingPresses = 0
      $sentHeld = $held
      $sentGaming = $gaming
      $lastSent = $now
    }
    [Threading.Thread]::Sleep(50)
  }
  exit 0
} catch {
  # Keep OS/process/compiler diagnostics private. Parent reports a safe error.
  exit 1
}
