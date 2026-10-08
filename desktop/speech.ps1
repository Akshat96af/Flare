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
  foreach(var info in SpeechRecognitionEngine.InstalledRecognizers()) if(info.Culture.Name.StartsWith("en-")){if(selected==null)selected=info;if(info.Culture.Name==System.Globalization.CultureInfo.CurrentCulture.Name){selected=info;break;}}
  if(selected==null) throw new Exception("An English Windows speech recognizer is not installed.");
  using(var engine=new SpeechRecognitionEngine(selected)) {
   string text=""; var done=new ManualResetEventSlim(false);
   engine.SetInputToDefaultAudioDevice();
   var dictation=new DictationGrammar(); dictation.Weight=0.6f; engine.LoadGrammar(dictation);
   var commands=new Choices("open YouTube", "open Claude", "open Chrome", "open Gemini", "open Notepad", "open ChatGPT", "volume max", "volume mute", "brightness max", "volume fifty", "brightness fifty");
   var builder=new GrammarBuilder(commands); builder.Culture=selected.Culture;
   var grammar=new Grammar(builder); grammar.Weight=1.0f; engine.LoadGrammar(grammar);
   engine.InitialSilenceTimeout=TimeSpan.FromSeconds(12); engine.EndSilenceTimeout=TimeSpan.FromMilliseconds(1500);
   engine.SpeechRecognized+=(s,e)=>{if(e.Result.Confidence>=0.4)text+=(text.Length>0?" ":"")+e.Result.Text;};
   engine.RecognizeCompleted+=(s,e)=>{done.Set();};
   engine.RecognizeAsync(RecognizeMode.Multiple);
   Console.Out.WriteLine("FLARE_SPEECH_READY"); Console.Out.Flush();
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
