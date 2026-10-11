param([switch]$PushToTalk, [Parameter(Mandatory=$true)][string]$AudioFile)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
try {
  Add-Type -AssemblyName System.Speech
  Add-Type -ReferencedAssemblies System.Speech -TypeDefinition @'
using System;
using System.Threading;
using System.Speech.Recognition;
public static class FlareSpeech {
 public static string Listen(string file) {
  RecognizerInfo selected=null;
  foreach(var info in SpeechRecognitionEngine.InstalledRecognizers()) if(info.Culture.Name.StartsWith("en-")){if(selected==null)selected=info;if(info.Culture.Name==System.Globalization.CultureInfo.CurrentCulture.Name){selected=info;break;}}
  if(selected==null) throw new Exception("An English Windows speech recognizer is not installed.");
  using(var engine=new SpeechRecognitionEngine(selected)) {
   string text=""; var done=new ManualResetEventSlim(false);
   engine.SetInputToWaveFile(file);
   var dictation=new DictationGrammar(); dictation.Weight=0.6f; engine.LoadGrammar(dictation);
   engine.InitialSilenceTimeout=TimeSpan.FromSeconds(12); engine.EndSilenceTimeout=TimeSpan.FromMilliseconds(1500);
   Exception failure=null;
   engine.SpeechRecognized+=(s,e)=>{if(e.Result.Confidence>=0.35)text+=(text.Length>0?" ":"")+e.Result.Text;};
   engine.RecognizeCompleted+=(s,e)=>{failure=e.Error;done.Set();};
   engine.RecognizeAsync(RecognizeMode.Multiple);
   if(!done.Wait(30000)){engine.RecognizeAsyncCancel();throw new Exception("Recorded speech recognition timed out.");}
   if(failure!=null)throw failure;
   return text;
  }
 }
}
'@
  $result = [FlareSpeech]::Listen($AudioFile)
  @{ text = $result } | ConvertTo-Json -Depth 3 -Compress
} catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }
