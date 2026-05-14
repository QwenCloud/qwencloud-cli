# QwenCloud CLI Installer for Windows
# Usage:
#   irm https://raw.githubusercontent.com/QwenCloud/qwencloud-cli/main/install.ps1 | iex
#   .\install.ps1 -Version v1.2.0
#
# Parameters:
#   -Version           - version to install (e.g. v1.0.0, default: v1.0.0)
#
# Behavior:
#   If a previous installation exists in the install directory, the existing
#   binary will be backed up with a '-old' suffix (e.g. qwencloud.exe → qwencloud-old.exe)
#   before being overwritten. This allows easy rollback if needed.

param(
    [string]$Version = ""
)

$ErrorActionPreference = "Stop"

# ─── Default Version ────────────────────────────────────────────────────────
# Update this value when releasing a new version.
$DefaultVersion = "v1.0.0"

# ─── Brand Colors ────────────────────────────────────────────────────────────
# #987BFE via ANSI 24-bit true color escape sequences (matching install.sh)
$ESC = [char]27

$BOLD = "${ESC}[1m"
$RESET = "${ESC}[0m"
$BRAND = "${ESC}[38;2;152;123;254m"
$BRAND_BOLD = "${ESC}[1;38;2;152;123;254m"
$GREEN = "${ESC}[32m"
$RED = "${ESC}[31m"
$DIM = "${ESC}[2m"
$YELLOW = "${ESC}[33m"

# Enable VT processing on Windows (for ANSI escape support)
function Enable-VTProcessing {
    if ($PSVersionTable.PSVersion.Major -ge 7) { return }
    try {
        $null = [Console]::OutputEncoding
        # Windows 10 1511+ supports VT sequences in conhost
        $key = "HKCU:\Console"
        if (Test-Path $key) {
            $vt = (Get-ItemProperty $key -ErrorAction SilentlyContinue).VirtualTerminalLevel
            if (-not $vt) {
                # Try to enable via .NET
                Add-Type -MemberDefinition @"
[DllImport("kernel32.dll", SetLastError = true)]
public static extern bool SetConsoleMode(IntPtr hConsoleHandle, int mode);
[DllImport("kernel32.dll", SetLastError = true)]
public static extern IntPtr GetStdHandle(int handle);
[DllImport("kernel32.dll", SetLastError = true)]
public static extern bool GetConsoleMode(IntPtr hConsoleHandle, out int mode);
"@ -Namespace Win32 -Name Console -ErrorAction SilentlyContinue
                $handle = [Win32.Console]::GetStdHandle(-11)  # STD_OUTPUT_HANDLE
                $mode = 0
                [Win32.Console]::GetConsoleMode($handle, [ref]$mode) | Out-Null
                # ENABLE_VIRTUAL_TERMINAL_PROCESSING = 0x0004
                [Win32.Console]::SetConsoleMode($handle, $mode -bor 0x0004) | Out-Null
            }
        }
    } catch {
        # Silently fail - colors will degrade gracefully
    }
}

Enable-VTProcessing

function Write-Branded {
    param([string]$Text, [switch]$NoNewline)
    if ($NoNewline) {
        Write-Host "${BRAND_BOLD}${Text}${RESET}" -NoNewline
    } else {
        Write-Host "${BRAND_BOLD}${Text}${RESET}"
    }
}

function Write-Info {
    param([string]$Message)
    Write-Host "${BRAND_BOLD}qwencloud${RESET} ${DIM}»${RESET} ${Message}"
}

function Write-Success {
    param([string]$Message)
    Write-Host "${GREEN}✔${RESET} ${Message}"
}

function Write-Warn {
    param([string]$Message)
    Write-Host "${YELLOW}⚠${RESET} ${Message}"
}

function Write-Error2 {
    param([string]$Message)
    Write-Host "${RED}✘${RESET} ${Message}"
}

function Write-Fatal {
    param([string]$Message)
    Write-Error2 $Message
    exit 1
}

# ─── Platform Detection ─────────────────────────────────────────────────────

function Get-CpuArch {
    $arch = $null

    # Try RuntimeInformation first (.NET Core / PS 6+)
    try {
        $osArch = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture
        switch ($osArch) {
            "X64"  { $arch = "x64" }
            "Arm64" { $arch = "arm64" }
        }
    } catch {
        # Fallback to environment variable
    }

    if (-not $arch) {
        switch ($env:PROCESSOR_ARCHITECTURE) {
            "AMD64" { $arch = "x64" }
            "ARM64" { $arch = "arm64" }
            "x86"   {
                # Check if running 32-bit PS on 64-bit Windows
                if ($env:PROCESSOR_ARCHITEW6432 -eq "AMD64") {
                    $arch = "x64"
                } else {
                    Write-Fatal "32-bit Windows is not supported."
                }
            }
            default {
                Write-Fatal "Unsupported architecture: $env:PROCESSOR_ARCHITECTURE"
            }
        }
    }

    return $arch
}

# ─── PATH Management ────────────────────────────────────────────────────────

function Test-InPath {
    param([string]$Dir)
    $paths = $env:PATH -split ";"
    foreach ($p in $paths) {
        if ($p.TrimEnd("\") -eq $Dir.TrimEnd("\")) {
            return $true
        }
    }
    return $false
}

function Add-ToUserPath {
    param([string]$Dir)

    try {
        $currentPath = [Environment]::GetEnvironmentVariable("PATH", "User")
        if ($currentPath) {
            $paths = $currentPath -split ";"
            foreach ($p in $paths) {
                if ($p.TrimEnd("\") -eq $Dir.TrimEnd("\")) {
                    return $true  # Already in user PATH
                }
            }
            $newPath = "$Dir;$currentPath"
        } else {
            $newPath = $Dir
        }

        [Environment]::SetEnvironmentVariable("PATH", $newPath, "User")
        # Also update current session
        $env:PATH = "$Dir;$env:PATH"
        return $true
    } catch {
        return $false
    }
}

# ─── Main Installation ──────────────────────────────────────────────────────

function Install-QwenCloudCLI {
    Write-Host ""
    Write-Host "  ${BRAND_BOLD}╔═══════════════════════════════════════╗${RESET}"
    Write-Host "  ${BRAND_BOLD}║         QwenCloud CLI Installer       ║${RESET}"
    Write-Host "  ${BRAND_BOLD}╚═══════════════════════════════════════╝${RESET}"
    Write-Host ""

    # Detect platform
    $arch = Get-CpuArch
    Write-Info "Detected platform: ${BOLD}windows-${arch}${RESET}"

    # Resolve version: CLI param > default
    if ($Version) {
        $ver = $Version
    } else {
        $ver = $DefaultVersion
    }

    # Normalize version: ensure it starts with 'v'
    if (-not $ver.StartsWith("v")) {
        $ver = "v$ver"
    }
    Write-Info "Version: ${BOLD}${ver}${RESET}"

    # Set install directory
    $installDir = Join-Path $env:USERPROFILE ".qwencloud\bin"
    Write-Info "Install directory: ${BOLD}${installDir}${RESET}"

    # Construct download URL
    $filename = "qwencloud-windows-$arch.zip"
    $downloadUrl = "https://github.com/QwenCloud/qwencloud-cli/releases/download/$ver/$filename"
    Write-Info "Downloading ${BRAND}${filename}${RESET}..."

    # Create temp directory
    $tmpDir = Join-Path ([System.IO.Path]::GetTempPath()) ("qwencloud-install-" + [System.Guid]::NewGuid().ToString("N").Substring(0, 8))
    New-Item -ItemType Directory -Path $tmpDir -Force | Out-Null
    $tmpZip = Join-Path $tmpDir $filename

    try {
        # Download with progress bar
        try {
            [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

            $webRequest = [System.Net.HttpWebRequest]::Create($downloadUrl)
            $webRequest.AllowAutoRedirect = $true
            $webRequest.UserAgent = "QwenCloud-Installer"
            $response = $webRequest.GetResponse()
            $totalBytes = $response.ContentLength
            $responseStream = $response.GetResponseStream()
            $fileStream = [System.IO.File]::Create($tmpZip)
            $buffer = New-Object byte[] 8192
            $bytesRead = 0
            $totalRead = 0
            $barWidth = 30

            while (($bytesRead = $responseStream.Read($buffer, 0, $buffer.Length)) -gt 0) {
                $fileStream.Write($buffer, 0, $bytesRead)
                $totalRead += $bytesRead

                if ($totalBytes -gt 0) {
                    $pct = [math]::Floor(($totalRead / $totalBytes) * 100)
                    $filled = [math]::Floor(($totalRead / $totalBytes) * $barWidth)
                    $empty = $barWidth - $filled
                    $bar = ("█" * $filled) + ("░" * $empty)
                    $sizeMB = "{0:N1}" -f ($totalRead / 1MB)
                    $totalMB = "{0:N1}" -f ($totalBytes / 1MB)
                    Write-Host -NoNewline "`r  $bar ${pct}%  ${sizeMB}/${totalMB} MB"
                }
            }

            $fileStream.Close()
            $responseStream.Close()
            $response.Close()
            Write-Host ""
        } catch {
            Write-Fatal "Download failed. Please check your network connection and verify the version exists.`n  URL: $downloadUrl`n  Error: $_"
        }

        # Verify download
        if (-not (Test-Path $tmpZip) -or (Get-Item $tmpZip).Length -eq 0) {
            Write-Fatal "Downloaded file is empty or missing. The version $ver may not exist for windows-$arch."
        }
        Write-Success "Download complete"

        # Create install directory
        if (-not (Test-Path $installDir)) {
            New-Item -ItemType Directory -Path $installDir -Force | Out-Null
        }

        # Backup existing binary before overwriting
        $existingExe = Join-Path $installDir "qwencloud.exe"
        if (Test-Path $existingExe) {
            $backupExe = Join-Path $installDir "qwencloud-old.exe"
            Copy-Item -Path $existingExe -Destination $backupExe -Force
            Write-Info "Backed up existing binary → ${DIM}qwencloud-old.exe${RESET}"
        }

        # Extract
        Write-Info "Extracting to ${BOLD}${installDir}${RESET}..."
        try {
            Expand-Archive -Path $tmpZip -DestinationPath $installDir -Force
        } catch {
            Write-Fatal "Failed to extract archive. The file may be corrupted.`n  Error: $_"
        }
        Write-Success "Extraction complete"

    } finally {
        # Cleanup temp directory
        if (Test-Path $tmpDir) {
            Remove-Item -Path $tmpDir -Recurse -Force -ErrorAction SilentlyContinue
        }
    }

    # Verify installation
    $exePath = Join-Path $installDir "qwencloud.exe"
    Write-Host ""
    if (Test-Path $exePath) {
        Write-Success "${BRAND_BOLD}QwenCloud CLI${RESET} ${ver} installed successfully!"
    } else {
        Write-Success "Installation complete (${ver})"
    }

    # Check and configure PATH
    if (Test-InPath $installDir) {
        Write-Success "${BOLD}${installDir}${RESET} is already in your PATH"
        Write-Host ""
        Write-Host "  Run ${BRAND_BOLD}qwencloud${RESET} to get started."
    } else {
        $added = Add-ToUserPath $installDir
        if ($added) {
            Write-Success "Added ${BOLD}${installDir}${RESET} to your user PATH"
            Write-Host ""
            Write-Warn "Please restart your terminal for the PATH change to take effect."
            Write-Host ""
            Write-Host "  Or run this in your current session:"
            Write-Host ""
            Write-Host "    ${BOLD}`$env:PATH = `"${installDir};`$env:PATH`"${RESET}"
        } else {
            Write-Warn "Could not automatically add ${BOLD}${installDir}${RESET} to your PATH."
            Write-Host ""
            Write-Host "  To add it manually:"
            Write-Host ""
            Write-Host "  1. Open ${BOLD}Settings > System > About > Advanced system settings${RESET}"
            Write-Host "  2. Click ${BOLD}Environment Variables${RESET}"
            Write-Host "  3. Under ${BOLD}User variables${RESET}, edit ${BOLD}Path${RESET}"
            Write-Host "  4. Add: ${BOLD}${installDir}${RESET}"
            Write-Host ""
            Write-Host "  Or run in PowerShell (as current user):"
            Write-Host ""
            Write-Host "    ${DIM}[Environment]::SetEnvironmentVariable('PATH', `"${installDir};`" + [Environment]::GetEnvironmentVariable('PATH', 'User'), 'User')${RESET}"
        }
    }

    Write-Host ""
    Write-Host "  ${DIM}Documentation: https://docs.qwencloud.com${RESET}"
    Write-Host "  ${DIM}GitHub:        https://github.com/QwenCloud/qwencloud-cli${RESET}"
    Write-Host ""
}

# Run installer
Install-QwenCloudCLI
