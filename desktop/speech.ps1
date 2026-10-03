param([switch]$PushToTalk)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
try {
  Add-Type -AssemblyName System.Speech
  Add-Type -ReferencedAssemblies System.Speech -TypeDefinition @'
using System;
using System.Threading;
using System.Speech.Recognition;
public static class FlareSpeech {
 public static string Listen(bool push) {
  RecognizerInfo selected=null;
  foreach(var info in SpeechRecognitionEngine.InstalledRecognizers()) if(info.Culture.Name.StartsWith("en-")){selected=info;break;}
  if(selected==null) throw new Exception("An English Windows speech recognizer is not installed.");
  using(var engine=new SpeechRecognitionEngine(selected)) {
   string text=""; var done=new ManualResetEventSlim(false);
   engine.SetInputToDefaultAudioDevice(); engine.LoadGrammar(new DictationGrammar());
   engine.InitialSilenceTimeout=TimeSpan.FromSeconds(8); engine.EndSilenceTimeout=TimeSpan.FromMilliseconds(1000);
   engine.SpeechRecognized+=(s,e)=>{text+=(text.Length>0?" ":"")+e.Result.Text;};
   engine.RecognizeCompleted+=(s,e)=>{done.Set();};
   engine.RecognizeAsync(push?RecognizeMode.Multiple:RecognizeMode.Single);
   var stop=Console.In.ReadLineAsync(); bool stopping=false; var start=DateTime.UtcNow;
   while(!done.IsSet && (DateTime.UtcNow-start).TotalSeconds<30) {
    if(stop.IsCompleted&&!stopping){engine.RecognizeAsyncStop();stopping=true;}
    Thread.Sleep(30);
   }
   if(!done.IsSet)engine.RecognizeAsyncCancel();
   return text;
  }
 }
}
'@
  $result = [FlareSpeech]::Listen($PushToTalk.IsPresent)
  @{ text = $result } | ConvertTo-Json -Depth 3 -Compress
} catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }
