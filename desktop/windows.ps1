param([string]$Action)
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$payload = [Console]::In.ReadToEnd() | ConvertFrom-Json
try {
  switch ($Action) {
    'apps' {
      $items = @(Get-StartApps | ForEach-Object { @{ title = $_.Name; id = $_.AppID } })
      ConvertTo-Json -InputObject $items -Depth 4 -Compress
    }
    'app-icons' {
      if (@($payload.paths).Count -gt 30) { throw 'Too many app icons requested.' }
      Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
[StructLayout(LayoutKind.Sequential)] struct IconSize { public int Width; public int Height; }
[StructLayout(LayoutKind.Sequential)] struct BitmapHeader {
 public uint Size; public int Width; public int Height; public ushort Planes; public ushort BitCount;
 public uint Compression; public uint ImageSize; public int XResolution; public int YResolution;
 public uint ColorsUsed; public uint ColorsImportant;
}
[ComImport, Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAppImage { [PreserveSig] int GetImage(IconSize size, uint flags, out IntPtr bitmap); }
public static class AppIcon {
 [DllImport("shell32.dll", CharSet=CharSet.Unicode, PreserveSig=true)]
 static extern int SHCreateItemFromParsingName(string path, IntPtr context, ref Guid id, out IAppImage image);
 [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr bitmap);
 [DllImport("gdi32.dll")] static extern IntPtr CreateCompatibleDC(IntPtr context);
 [DllImport("gdi32.dll")] static extern bool DeleteDC(IntPtr context);
 [DllImport("gdi32.dll")] static extern int GetDIBits(IntPtr context, IntPtr bitmap, uint first, uint count, [Out] byte[] pixels, ref BitmapHeader header, uint usage);
 public static string Read(string path) {
  IAppImage image = null; IntPtr handle = IntPtr.Zero; IntPtr context = IntPtr.Zero;
  try {
   var id = typeof(IAppImage).GUID;
   Marshal.ThrowExceptionForHR(SHCreateItemFromParsingName(path, IntPtr.Zero, ref id, out image));
   Marshal.ThrowExceptionForHR(image.GetImage(new IconSize { Width=32, Height=32 }, 5, out handle));
   using (var dimensions = Image.FromHbitmap(handle))
   using (var output = new MemoryStream()) {
    int width = dimensions.Width, height = dimensions.Height;
    if (width < 1 || height < 1 || width > 256 || height > 256) throw new InvalidOperationException();
    var header = new BitmapHeader { Size=40, Width=width, Height=-height, Planes=1, BitCount=32 };
    var pixels = new byte[width * height * 4];
    context = CreateCompatibleDC(IntPtr.Zero);
    if (GetDIBits(context, handle, 0, (uint)height, pixels, ref header, 0) != height) throw new InvalidOperationException();
    bool hasAlpha = false;
    for (int i=3; i<pixels.Length; i+=4) if (pixels[i] != 0) { hasAlpha = true; break; }
    if (!hasAlpha) for (int i=3; i<pixels.Length; i+=4) pixels[i] = 255;
    // Shell bitmaps use premultiplied alpha; FromHbitmap alone discards it.
    using (var bitmap = new Bitmap(width, height, PixelFormat.Format32bppPArgb)) {
     var data = bitmap.LockBits(new Rectangle(0,0,width,height), ImageLockMode.WriteOnly, PixelFormat.Format32bppPArgb);
     try { for (int row=0; row<height; row++) Marshal.Copy(pixels, row*width*4, IntPtr.Add(data.Scan0,row*data.Stride), width*4); }
     finally { bitmap.UnlockBits(data); }
     bitmap.Save(output, ImageFormat.Png);
    }
    return "data:image/png;base64," + Convert.ToBase64String(output.ToArray());
   }
  } finally {
   if (context != IntPtr.Zero) DeleteDC(context);
   if (handle != IntPtr.Zero) DeleteObject(handle);
   if (image != null) Marshal.ReleaseComObject(image);
  }
 }
}
'@
      $items = @()
      foreach ($file in $payload.paths) {
        $file = [string]$file
        if ($file.Length -gt 32767) { continue }
        $shellApp = $file -match '^shell:AppsFolder\\[\w.\-!]+$'
        $localApp = [IO.Path]::IsPathRooted($file) -and [IO.Path]::GetExtension($file) -in '.lnk','.exe','.url'
        if (-not ($shellApp -or $localApp)) { continue }
        try { $items += @{ path = $file; icon = [AppIcon]::Read($file) } } catch { }
      }
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
    { $_ -in 'volume','audio-status' } {
      Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class Enumerator {}
[ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IEnumerator {
 [PreserveSig] int EnumAudioEndpoints(int flow, int mask, out IntPtr devices);
 [PreserveSig] int GetDefaultAudioEndpoint(int flow,int role,out IDevice device);
}
[ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IDevice {
 [PreserveSig] int Activate(ref Guid iid,int context,IntPtr parameters,[MarshalAs(UnmanagedType.IUnknown)] out object result);
}
[ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IVolume {
 [PreserveSig] int RegisterControlChangeNotify(IntPtr x); [PreserveSig] int UnregisterControlChangeNotify(IntPtr x); [PreserveSig] int GetChannelCount(out uint n);
 [PreserveSig] int SetMasterVolumeLevel(float n,ref Guid context); [PreserveSig] int SetMasterVolumeLevelScalar(float n,ref Guid context);
 [PreserveSig] int GetMasterVolumeLevel(out float n); [PreserveSig] int GetMasterVolumeLevelScalar(out float n);
}
public static class Audio {
 static IVolume Endpoint() { var e=(IEnumerator)new Enumerator(); IDevice d; Marshal.ThrowExceptionForHR(e.GetDefaultAudioEndpoint(0,1,out d)); var id=typeof(IVolume).GUID; object v; Marshal.ThrowExceptionForHR(d.Activate(ref id,23,IntPtr.Zero,out v)); return (IVolume)v; }
 public static void Set(float value) { var context=Guid.Empty; Marshal.ThrowExceptionForHR(Endpoint().SetMasterVolumeLevelScalar(value,ref context)); }
 public static float Read() { float value; Marshal.ThrowExceptionForHR(Endpoint().GetMasterVolumeLevelScalar(out value)); return value; }
}
'@
      $value = [Audio]::Read() * 100
      if ($Action -eq 'volume') { $value = [Math]::Max(0,[Math]::Min(100,[int]$payload.value)); [Audio]::Set($value / 100.0) }
      @{ value = $value } | ConvertTo-Json -Depth 3 -Compress
    }
    'search' {
      $q = ([string]$payload.query).Replace("'", "''").Replace('%','').Replace('_','')
      $scopes = @($payload.roots | ForEach-Object { "SCOPE='file:" + ([string]$_).Replace('\','/').Replace("'","''") + "'" })
      if ($scopes.Count -eq 0) { throw 'Choose search locations first.' }
      $scope = '(' + ($scopes -join ' OR ') + ')'
      $connection = New-Object -ComObject ADODB.Connection
      $connection.Open("Provider=Search.CollatorDSO;Extended Properties='Application=Windows';")
      $rows = $connection.Execute("SELECT TOP 30 System.ItemPathDisplay,System.FileName FROM SystemIndex WHERE $scope AND System.FileName LIKE '%$q%'")
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
