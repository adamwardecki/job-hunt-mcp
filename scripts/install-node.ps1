# Installs the official Node.js LTS for the job-hunt plugin (Windows).
# Uses winget when it is there (winget checks the package against its manifest hash). Otherwise downloads
# the .msi from nodejs.org, checks its SHA-256 and its Authenticode signature, and opens the Windows
# installer for the user to click through.
#
#   install-node.ps1            install (does nothing if Node 22.18+ is there)
#   install-node.ps1 -Check     exit 0 if Node 22.18+ (23.4+ on 23.x) is the one the plugin will use,
#                               1 if Node is missing or too old, 3 if an older Node first on PATH hides a newer one
#   install-node.ps1 -DryRun    download and verify the checksum, install nothing
#
# Install and dry-run modes exit 0 when Node is fine or installed (or the installer was opened), else 2
# (including the shadowed case, without downloading: installing the LTS would not fix it).
#
# Node is looked for first on PATH, then in "Program Files\nodejs".
#
# Run: powershell -NoProfile -ExecutionPolicy Bypass -File install-node.ps1 [-Check | -DryRun]
# Env (for tests):
#   JOB_HUNT_NODE_DIST     download base (default https://nodejs.org/dist; when set, winget is not used)
#   JOB_HUNT_NODE          use this binary instead of the PATH lookup; when set without JOB_HUNT_NODE_DEFAULT,
#                          no default locations are checked at all
#   JOB_HUNT_NODE_DEFAULT  use this binary instead of the default install locations
param([switch]$Check, [switch]$DryRun)
$ErrorActionPreference = 'Stop'
$Dist = if ($env:JOB_HUNT_NODE_DIST) { $env:JOB_HUNT_NODE_DIST } else { 'https://nodejs.org/dist' }
$Signer = 'OpenJS Foundation'

function Fail([string]$Message) { [Console]::Error.WriteLine($Message); exit 2 }

# The first line `node --version` prints, or '' if it did not run.
function Get-NodeVersion([string]$Path) {
  $ErrorActionPreference = 'Continue'  # on 5.1, a warning on stderr must not count as a failure
  try { return "$(& $Path --version 2>$null | Select-Object -First 1)".Trim() } catch { return '' }
}

# True if the version string supports this plugin: 22.18+, 23.4+ or 24+.
function Test-NewEnough([string]$Version) {
  if ($Version -notmatch '^v(\d+)\.(\d+)\.') { return $false }
  $major = [int]$Matches[1]; $minor = [int]$Matches[2]
  return ($major -ge 24) -or ($major -eq 23 -and $minor -ge 4) -or ($major -eq 22 -and $minor -ge 18)
}

# One line about the Node the plugin would use. State: ok; old (missing or too old, installing the LTS
# fixes that); shadowed (a new enough Node is hidden behind an older one on PATH).
function Get-NodeStatus {
  $first = if ($env:JOB_HUNT_NODE) { $env:JOB_HUNT_NODE } else {
    (Get-Command node -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1).Source
  }
  $firstV = ''
  if ($first -and (Test-Path -LiteralPath $first -PathType Leaf)) {
    $firstV = Get-NodeVersion $first
    if (Test-NewEnough $firstV) { return [pscustomobject]@{ State = 'ok'; Message = "Node.js $firstV is installed at $first." } }
  } else { $first = $null }

  $defaults = @()
  if ($env:JOB_HUNT_NODE_DEFAULT) { $defaults = @($env:JOB_HUNT_NODE_DEFAULT) }
  elseif (-not $env:JOB_HUNT_NODE) {
    $defaults = @("$env:ProgramFiles\nodejs\node.exe")
    if ($env:ProgramW6432 -and $env:ProgramW6432 -ne $env:ProgramFiles) { $defaults += "$env:ProgramW6432\nodejs\node.exe" }
  }
  foreach ($c in $defaults) {
    if ($c -eq $first -or -not (Test-Path -LiteralPath $c -PathType Leaf)) { continue }
    $v = Get-NodeVersion $c
    if (-not (Test-NewEnough $v)) { continue }
    if (-not $first) {
      return [pscustomobject]@{ State = 'ok'; Message = "Node.js $v is installed at $c (not on PATH yet; reopening the app usually fixes that)." }
    }
    $older = if ($firstV) { "$firstV at $first" } else { "$first, which did not run" }
    return [pscustomobject]@{ State = 'shadowed'; Message = "Node.js $v is installed at $c, but an older Node.js ($older) comes first on PATH and the plugin would use that one. Remove or update the older one, then reopen the app." }
  }
  $msg = if (-not $first) { 'Node.js is not installed.' }
    elseif (-not $firstV) { "Node.js at $first did not run." }
    else { "Node.js $firstV at $first is too old; the plugin needs 22.18 or newer (23.x needs 23.4 or newer)." }
  return [pscustomobject]@{ State = 'old'; Message = $msg }
}

$status = Get-NodeStatus
if ($Check) {
  Write-Output $status.Message
  if ($status.State -eq 'ok') { exit 0 } elseif ($status.State -eq 'shadowed') { exit 3 } else { exit 1 }
}

# Running it twice, or on a machine that already has Node, must not install anything.
if ($status.State -eq 'ok') { Write-Output "$($status.Message) Nothing to install."; exit 0 }
if ($status.State -eq 'shadowed') { Fail $status.Message }
Write-Output $status.Message
Write-Output 'Installing the current LTS.'

if (-not $env:JOB_HUNT_NODE_DIST -and -not $DryRun -and (Get-Command winget -ErrorAction SilentlyContinue)) {
  Write-Output 'Installing Node.js LTS with winget. Windows will ask you to allow it.'
  # winget's own output goes to the screen; only its exit code comes back. A throw means winget cannot run.
  $code = $null
  try {
    $code = & {
      $ErrorActionPreference = 'Continue'
      winget install --id OpenJS.NodeJS.LTS -e --source winget --accept-package-agreements --accept-source-agreements --disable-interactivity | Out-Host
      $LASTEXITCODE
    }
  } catch { $code = $null }
  if ($null -eq $code) {
    Write-Output 'winget is not working on this computer. Using the installer from nodejs.org instead.'
  } else {
    # Check Node first whatever the code: "already installed" and "reboot required" are non-zero too.
    $after = Get-NodeStatus
    if ($after.State -eq 'ok') { Write-Output 'Node.js is installed. Quit Claude completely and reopen it so it can see Node.js.'; exit 0 }
    if ($after.State -eq 'shadowed') { Fail $after.Message }
    # No fallback to the .msi here: the user may have just said no to the Windows prompt.
    if ($code -ne 0) {
      Fail ("winget could not install Node.js (code {0}). If you cancelled the Windows prompt, nothing was installed. Otherwise install it yourself from https://nodejs.org/en/download." -f ('0x{0:X8}' -f $code))
    }
    Fail 'winget finished but Node.js 22.18 or newer still cannot be found. Install it yourself from https://nodejs.org/en/download.'
  }
}

$arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
$tmp = $null
$web = $null
$keepTmp = $false  # the .msi must survive while the Windows installer has it open
function Get-File([string]$Url, [string]$Name) {
  $dest = Join-Path $tmp $Name
  $web.DownloadFile($Url, $dest)
  return $dest
}

# Fail exits the script; that is not caught by the catch below, and the finally still runs.
try {
  $tmp = Join-Path ([IO.Path]::GetTempPath()) ('jh-node-' + [guid]::NewGuid())
  New-Item -ItemType Directory -Path $tmp | Out-Null
  # Windows PowerShell 5.1 may default to TLS 1.0, which nodejs.org refuses.
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
  $web = [Net.WebClient]::new()

  try { $index = Get-File "$Dist/index.tab" 'index.tab' } catch { Fail "Could not reach $Dist. Check the internet connection and try again." }
  $version = $null
  foreach ($line in (Get-Content -LiteralPath $index | Select-Object -Skip 1)) {
    $cols = $line -split "`t"
    if ($cols.Count -gt 9 -and $cols[9] -ne '-') { $version = $cols[0]; break }
  }
  if (-not $version -or $version -notmatch '^v[0-9]+\.[0-9]+\.[0-9]+$') { Fail "Could not find a Node.js LTS release in $Dist/index.tab." }

  $msiName = "node-$version-$arch.msi"
  Write-Output "Downloading Node.js $version (LTS) from $Dist ..."
  Write-Output 'This is about 30 MB and can take a few minutes.'
  try {
    $msi = Get-File "$Dist/$version/$msiName" $msiName
    $sums = Get-File "$Dist/$version/SHASUMS256.txt" 'SHASUMS256.txt'
  } catch { Fail "Download of $msiName failed. Nothing was installed." }
  $want = Get-Content -LiteralPath $sums | ForEach-Object { $p = $_ -split '\s+'; if ($p[1] -eq $msiName) { $p[0] } } | Select-Object -First 1
  $got = (Get-FileHash -LiteralPath $msi -Algorithm SHA256).Hash
  if (-not $want -or $want -ne $got) { Fail "Checksum mismatch for $msiName. Nothing was installed." }
  Write-Output 'Checksum ok.'

  if ($DryRun) { Write-Output "Dry run: would check the signature and open $msi"; exit 0 }

  # Valid chain, signer common name exactly the OpenJS Foundation, and the same organisation (O=) in the subject.
  $sig = Get-AuthenticodeSignature -LiteralPath $msi
  $cert = $sig.SignerCertificate
  if ($sig.Status -ne 'Valid' -or -not $cert -or
      $cert.GetNameInfo('SimpleName', $false) -ne $Signer -or
      $cert.Subject -notmatch ('(^|, )O="?' + [regex]::Escape($Signer) + '"?(,|$)')) {
    Fail "$msiName is not signed by the $Signer. Nothing was installed."
  }

  Start-Process msiexec.exe -ArgumentList @('/i', "`"$msi`"")
  $keepTmp = $true
  Write-Output 'The Node.js installer is open. Click through it (Windows will ask you to allow it), then come back and say done.'
} catch {
  Fail "Something unexpected went wrong ($($_.Exception.Message)). Nothing was installed."
} finally {
  if ($web) { $web.Dispose() }
  if ($tmp -and -not $keepTmp) { Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue }
}
