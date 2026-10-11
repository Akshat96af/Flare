!include nsDialogs.nsh
!include LogicLib.nsh
Var FlareActions
Var FlareOcr
Var FlareVoice
Var FlareFast
Var FlareBalanced
Var FlareActionsState
Var FlareOcrState
Var FlareVoiceState
Var FlareModel
Var FlareComponentsLoaded

!macro customInit
  StrCpy $FlareActionsState 1
  StrCpy $FlareOcrState 0
  StrCpy $FlareVoiceState 0
  StrCpy $FlareModel "base.en"
  StrCpy $FlareComponentsLoaded 0
!macroend

!macro customPageAfterChangeDir
  Page custom FlareComponentsCreate FlareComponentsLeave
!macroend

Function FlareComponentsCreate
  ${If} $FlareComponentsLoaded == 0
    ${If} ${FileExists} "$INSTDIR\resources\optional\installed.ini"
      ReadINIStr $FlareActionsState "$INSTDIR\resources\optional\installed.ini" "Features" "Actions"
      ReadINIStr $FlareOcrState "$INSTDIR\resources\optional\installed.ini" "Features" "OCR"
      ReadINIStr $FlareVoiceState "$INSTDIR\resources\optional\installed.ini" "Features" "Voice"
      ReadINIStr $FlareModel "$INSTDIR\resources\optional\installed.ini" "Features" "Model"
    ${EndIf}
    StrCpy $FlareComponentsLoaded 1
  ${EndIf}
  !insertmacro MUI_HEADER_TEXT "Make Flare yours" "Choose the features to install on this computer."
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}
  ${NSD_CreateLabel} 0 0 100% 30u "All engines and models are included in this setup. Nothing is downloaded during installation. File contents and microphone access still require permission."
  Pop $0
  ${NSD_CreateCheckbox} 0 40u 100% 18u "Smart file actions"
  Pop $FlareActions
  ${NSD_SetState} $FlareActions $FlareActionsState
  ${NSD_CreateCheckbox} 0 64u 100% 18u "Local OCR - text from images and scanned PDFs (3 MB)"
  Pop $FlareOcr
  ${NSD_SetState} $FlareOcr $FlareOcrState
  ${NSD_CreateCheckbox} 0 88u 100% 18u "Offline Whisper - English voice recognition"
  Pop $FlareVoice
  ${NSD_SetState} $FlareVoice $FlareVoiceState
  ${NSD_CreateRadioButton} 12u 110u 45% 18u "Fast (82 MB)"
  Pop $FlareFast
  ${NSD_CreateRadioButton} 52% 110u 48% 18u "Balanced (152 MB)"
  Pop $FlareBalanced
  ${If} $FlareModel == "tiny.en"
    ${NSD_Check} $FlareFast
  ${Else}
    ${NSD_Check} $FlareBalanced
  ${EndIf}
  nsDialogs::Show
FunctionEnd

Function FlareComponentsLeave
  ${NSD_GetState} $FlareActions $FlareActionsState
  ${NSD_GetState} $FlareOcr $FlareOcrState
  ${NSD_GetState} $FlareVoice $FlareVoiceState
  ${NSD_GetState} $FlareFast $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $FlareModel "tiny.en"
  ${Else}
    StrCpy $FlareModel "base.en"
  ${EndIf}
FunctionEnd

!macro customInstall
  ${If} $FlareOcrState != ${BST_CHECKED}
    RMDir /r "$INSTDIR\resources\optional\ocr"
  ${EndIf}
  ${If} $FlareVoiceState != ${BST_CHECKED}
    RMDir /r "$INSTDIR\resources\optional\voice"
  ${ElseIf} $FlareModel == "tiny.en"
    Delete "$INSTDIR\resources\optional\voice\ggml-base.en.bin"
  ${Else}
    Delete "$INSTDIR\resources\optional\voice\ggml-tiny.en.bin"
  ${EndIf}
  StrCpy $1 "false"
  StrCpy $2 "false"
  StrCpy $3 "false"
  ${If} $FlareActionsState == ${BST_CHECKED}
    StrCpy $1 "true"
  ${EndIf}
  ${If} $FlareOcrState == ${BST_CHECKED}
    StrCpy $2 "true"
  ${EndIf}
  ${If} $FlareVoiceState == ${BST_CHECKED}
    StrCpy $3 "true"
  ${EndIf}
  CreateDirectory "$INSTDIR\resources\optional"
  WriteINIStr "$INSTDIR\resources\optional\installed.ini" "Features" "Actions" "$FlareActionsState"
  WriteINIStr "$INSTDIR\resources\optional\installed.ini" "Features" "OCR" "$FlareOcrState"
  WriteINIStr "$INSTDIR\resources\optional\installed.ini" "Features" "Voice" "$FlareVoiceState"
  WriteINIStr "$INSTDIR\resources\optional\installed.ini" "Features" "Model" "$FlareModel"
  FileOpen $0 "$INSTDIR\resources\optional\installed.json" w
  FileWrite $0 '{$\"actions$\":$1,$\"ocr$\":$2,$\"voice$\":$3,$\"model$\":$\"$FlareModel$\"}'
  FileClose $0
!macroend
