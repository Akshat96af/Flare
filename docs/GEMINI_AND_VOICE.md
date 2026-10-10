# Gemini and voice setup

## Recommended setup in Flare

1. Open Settings > Intelligence and select Google Gemini.
2. Keep your saved API key, or enter a Gemini API key. A consumer AI subscription is not a replacement for API credentials or API quota.
3. Click **Check connection**. This lists models returned by your account; it does not verify that generation works.
4. Select a listed text model. Flare preserves the saved selection and otherwise prefers Gemini 3.6 Flash when the account returns it. Listing a model does not guarantee availability, capacity or access to every input modality.
5. Click **Test response**, then **Run test** only if you accept possible API usage charges. This makes one small request with no files or audio, no retries and no silent model substitutions. Ordinary text requests retry HTTP 503 up to twice with backoff; retries may count toward usage. Speech uploads are not retried automatically.
6. To use Gemini for speech, choose **Voice recognition > Online**. Choose **Same as Intelligence**, or a dedicated transcription model actually returned by Check connection. Click **Save connection**.
7. Open Voice, select the intended microphone, wait for Listening, speak, then review the transcript. Alt+Space starts voice after a one-second hold. Escape cancels and releases the microphone.

Online speech is an explicit opt-in. Windows only keeps recordings local. Windows + online fallback uploads the captured recording only when native recognition fails or returns no transcript. A plausible but incorrect Windows transcript does not automatically trigger a second, paid request; choose Online when native recognition is consistently inaccurate.

## Troubleshooting

| Symptom | Next step |
| --- | --- |
| No input signal | Check the microphone selector, hardware mute and Windows input volume. Flare does not upload detected silence. |
| Access blocked | Allow Flare in Windows microphone privacy settings. |
| Microphone busy | Close applications using exclusive microphone access, then retry. |
| Windows repeatedly mishears | Choose Online and save the connection; native dictation quality varies with installed language and microphone. |
| 404 | Refresh the model list and choose another returned model. A listing alone is not proof that the generation endpoint will serve it. |
| 405 on POST | Flare uses Google's documented POST endpoint. Check VPN/proxy/network filtering. Replacing a key is not a general fix for a method rejection. |
| 401/403 | Check API key validity, restrictions and project permissions. |
| 429 | Check the API project's quota; model and tier limits may differ. |
| 503 | The provider is unavailable or busy. Normal text requests retry up to twice. If it persists, wait, select another listed model, or connect OpenRouter free models. Changing an API key is not a general fix. |
| Empty/blocked/truncated output | Rephrase or select another model. Flare will not execute a partial response. |

Only the query or explicitly recorded speech is sent by these integrations. AI cannot inspect your drives or run arbitrary shell commands. Local search and approved file operations remain separate. Keys stay encrypted in the native process and are never returned to the UI.

## Verification limits

Automated tests use generated audio and fake provider responses. They verify capture, payloads, routing, model selection, consent, cancellation and error handling, not real-world word accuracy or provider uptime. No live paid generation or real microphone recording was used in this implementation pass. Try a short, non-sensitive phrase after opting in to Online.

## Primary documentation

- [Gemini model discovery](https://ai.google.dev/api/models)
- [GenerateContent endpoint and structured responses](https://ai.google.dev/api/generate-content)
- [Gemini audio understanding](https://ai.google.dev/gemini-api/docs/audio)
- [Gemini API rate limits](https://ai.google.dev/gemini-api/docs/rate-limits)
