param([string]$Python = 'python')
$ErrorActionPreference = 'Stop'
$projectFolder = $PSScriptRoot
Push-Location $projectFolder
try {
    & $Python -m PyInstaller --noconfirm --clean --onedir --console --name voice-backend `
        --distpath runtime --workpath build/python --specpath build `
        --collect-all livekit --collect-all onnxruntime --collect-all sounddevice `
        --collect-all _sounddevice_data `
        --collect-submodules httpcore2 --collect-submodules httpx2 `
        --copy-metadata httpcore2 --copy-metadata httpx2 `
        --recursive-copy-metadata livekit-agents `
        --hidden-import livekit.plugins.silero --hidden-import livekit.plugins.sarvam `
        --hidden-import livekit.plugins.openai backend/desktop_agent.py
    if ($LASTEXITCODE -ne 0) { throw 'Python backend build failed.' }
} finally { Pop-Location }
