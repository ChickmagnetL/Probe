$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$tauriDir = Join-Path $repoRoot "tauri"
$engineDir = Join-Path $repoRoot "engine"
$venvPython = Join-Path $engineDir ".venv\Scripts\python.exe"
$vsInstallPath = "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools"
$vsDevShellDll = Join-Path $vsInstallPath "Common7\Tools\Microsoft.VisualStudio.DevShell.dll"

if (!(Test-Path $vsDevShellDll)) {
    throw "Visual Studio Build Tools DevShell not found: $vsDevShellDll"
}

Import-Module $vsDevShellDll
Enter-VsDevShell -VsInstallPath $vsInstallPath -DevCmdArguments "-arch=x64 -host_arch=x64" | Out-Null

$env:Path += ";$env:USERPROFILE\.cargo\bin"
$env:TAURI_PYTHON_PATH = $venvPython

$hostTriple = (
    & rustc -vV |
    Select-String "^host:\s+(.+)$" |
    Select-Object -First 1
).Matches[0].Groups[1].Value

$sidecarPath = Join-Path $tauriDir "probe-engine-$hostTriple.exe"

if (!(Test-Path $sidecarPath)) {
    $pyinstaller = Join-Path $engineDir ".venv\Scripts\pyinstaller.exe"
    if (!(Test-Path $venvPython)) {
        throw "Python virtual environment not found: $venvPython"
    }
    if (!(Test-Path $pyinstaller)) {
        throw "PyInstaller not found in engine/.venv. Run `uv pip install --python engine\.venv\Scripts\python.exe pyinstaller` first."
    }

    Push-Location $engineDir
    try {
        & $pyinstaller probe.spec --noconfirm --clean --distpath dist
    } finally {
        Pop-Location
    }

    Copy-Item -LiteralPath (Join-Path $engineDir "dist\probe-engine.exe") -Destination $sidecarPath -Force
}

Push-Location $tauriDir
try {
    npm exec --prefix ..\frontend tauri dev
} finally {
    Pop-Location
}
