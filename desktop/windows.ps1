param([string]$Action)
$ErrorActionPreference = 'Stop'
$payload = [Console]::In.ReadToEnd() | ConvertFrom-Json
try {
  switch ($Action) {
    'apps' {
      $items = @(Get-StartApps | ForEach-Object { @{ title = $_.Name; id = $_.AppID } })
      ConvertTo-Json -InputObject $items -Depth 4 -Compress
    }
    'drives' {
      @(Get-CimInstance Win32_LogicalDisk | Where-Object { $_.DriveType -in 2,3 } | ForEach-Object { @{ path = $_.DeviceID + '\'; label = $_.VolumeName; free = $_.FreeSpace; size = $_.Size } }) | ConvertTo-Json -Depth 5 -Compress
    }
    'brightness' {
      $value = [byte][Math]::Max(0,[Math]::Min(100,[int]$payload.value))
      $devices = @(Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods -ErrorAction SilentlyContinue)
      if ($devices.Count -eq 0) { throw 'This display does not expose brightness control. Use its physical controls.' }
      foreach ($device in $devices) { Invoke-CimMethod -InputObject $device -MethodName WmiSetBrightness -Arguments @{ Timeout = [uint32]1; Brightness = $value } | Out-Null }
      @{ value = $value } | ConvertTo-Json -Depth 3 -Compress
    }
    'volume' {
      Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class Enumerator {}
[ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IEnumerator {
 int EnumAudioEndpoints(int flow, int mask, out IntPtr devices);
 int GetDefaultAudioEndpoint(int flow,int role,out IDevice device);
}
[ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IDevice {
 int Activate(ref Guid iid,int context,IntPtr parameters,[MarshalAs(UnmanagedType.IUnknown)] out object result);
}
[ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IVolume {
 int RegisterControlChangeNotify(IntPtr x); int UnregisterControlChangeNotify(IntPtr x); int GetChannelCount(out uint n);
 int SetMasterVolumeLevel(float n,Guid context); int SetMasterVolumeLevelScalar(float n,Guid context);
 int GetMasterVolumeLevel(out float n); int GetMasterVolumeLevelScalar(out float n);
}
public static class Audio {
 public static void Set(float value) { var e=(IEnumerator)new Enumerator(); IDevice d; Marshal.ThrowExceptionForHR(e.GetDefaultAudioEndpoint(0,1,out d)); var id=typeof(IVolume).GUID; object v; Marshal.ThrowExceptionForHR(d.Activate(ref id,23,IntPtr.Zero,out v)); Marshal.ThrowExceptionForHR(((IVolume)v).SetMasterVolumeLevelScalar(value,Guid.Empty)); }
}
'@
      $value = [Math]::Max(0,[Math]::Min(100,[int]$payload.value))
      [Audio]::Set($value / 100.0)
      @{ value = $value } | ConvertTo-Json -Depth 3 -Compress
    }
    'search' {
      $q = ([string]$payload.query).Replace("'", "''").Replace('%','').Replace('_','')
      $connection = New-Object -ComObject ADODB.Connection
      $connection.Open("Provider=Search.CollatorDSO;Extended Properties='Application=Windows';")
      $rows = $connection.Execute("SELECT TOP 30 System.ItemPathDisplay,System.FileName FROM SystemIndex WHERE System.FileName LIKE '%$q%'")
      $items = @()
      while (-not $rows.EOF) { $items += @{ path = [string]$rows.Fields.Item(0).Value; title = [string]$rows.Fields.Item(1).Value }; $rows.MoveNext() }
      $rows.Close(); $connection.Close()
      ConvertTo-Json -InputObject $items -Depth 4 -Compress
    }
    'speech-capabilities' {
      Add-Type -AssemblyName System.Speech
      $recognizers = @([System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers() | Where-Object { $_.Culture.Name -like 'en-*' } | ForEach-Object { $_.Culture.Name })
      @{ available = $recognizers.Count -gt 0; languages = $recognizers } | ConvertTo-Json -Depth 4 -Compress
    }
    default { throw 'Unsupported Windows command.' }
  }
} catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }
