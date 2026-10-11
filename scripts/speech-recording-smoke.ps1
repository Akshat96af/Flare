$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$directory = Join-Path (Join-Path $PSScriptRoot '../Files/private/verification') ('speech-recording-' + [Guid]::NewGuid())
New-Item -ItemType Directory -Path $directory -Force | Out-Null
$file = Join-Path $directory 'synthetic.wav'
$synth = [System.Speech.Synthesis.SpeechSynthesizer]::new()
try {
  $format = [System.Speech.AudioFormat.SpeechAudioFormatInfo]::new(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
  $synth.SetOutputToWaveFile($file, $format)
  $synth.Speak('Open YouTube. Set brightness to fifty percent.')
} finally { $synth.Dispose() }
& powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot '../desktop/speech.ps1') -AudioFile $file
if ($LASTEXITCODE -ne 0) { throw 'Recorded Windows recognition failed.' }
