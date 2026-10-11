param([ValidateSet('status','play','pause','resume','stop','next','previous')][string]$Action='status', [string]$Service='', [string]$Title='', [string]$Artist='', [int]$WaitMs=0)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $managerType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows, ContentType=WindowsRuntime]
  $propertiesType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows, ContentType=WindowsRuntime]
  $asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' } | Select-Object -First 1
  function Await-Operation($operation, [Type]$type) {
    $task = $asTask.MakeGenericMethod($type).Invoke($null, @($operation))
    if (-not $task.Wait(2500)) { throw 'Music player took too long to respond.' }
    return $task.Result
  }
  function Normalize-Name([string]$name) { return [regex]::Replace($name.ToLowerInvariant(), '[^\p{L}\p{Nd}]', '') }
  $manager = Await-Operation ($managerType::RequestAsync()) $managerType
  $until = [DateTime]::UtcNow.AddMilliseconds([Math]::Min(6000,[Math]::Max(0,$WaitMs)))
  $result = @{ ok = $false; message = 'Open a music player and start a song first.' }
  do {
    $sessions = @($manager.GetSessions())
    if (-not $Service -and -not $Title) { $sessions = @($manager.GetCurrentSession()) }
    foreach ($session in $sessions) {
      if ($null -eq $session) { continue }
      $source = [string]$session.SourceAppUserModelId
      if ($Service -eq 'spotify' -and $source -notmatch 'spotify') { continue }
      if ($Service -eq 'applemusic' -and $source -notmatch 'applemusic|itunes') { continue }
      $properties = Await-Operation ($session.TryGetMediaPropertiesAsync()) $propertiesType
      if ($Title -and (Normalize-Name $properties.Title) -ne (Normalize-Name $Title)) { continue }
      if ($Artist -and (Normalize-Name $properties.Artist) -ne (Normalize-Name $Artist)) { continue }
      if ($Action -eq 'status') {
        $result = @{ ok = $true; title = $properties.Title; artist = $properties.Artist; source = $source }
      } else {
        $operation = switch ($Action) {
          'pause' { $session.TryPauseAsync() }
          'stop' { $session.TryPauseAsync() }
          'next' { $session.TrySkipNextAsync() }
          'previous' { $session.TrySkipPreviousAsync() }
          default { $session.TryPlayAsync() }
        }
        $ok = Await-Operation $operation ([bool])
        $result = @{ ok = [bool]$ok; message = if ($ok) { 'Playback ' + $Action + ' requested' } else { 'The player declined playback control. Use its playback button.' } }
      }
      break
    }
    if ($result.ok -or [DateTime]::UtcNow -ge $until) { break }
    Start-Sleep -Milliseconds 300
  } while ($true)
  $result | ConvertTo-Json -Depth 4 -Compress
} catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }
