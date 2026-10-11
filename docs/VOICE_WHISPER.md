# Voice capture and Whisper

Flare now records one selected microphone stream. The same stream supplies the meter, local Windows recognition and optional cloud transcription. Windows receives a temporary mono 16 kHz PCM WAV instead of opening another microphone. The recording is removed when recognition ends. Cancelling kills recognition and releases microphone tracks.

Windows speech remains available without an API key, but its dictation accuracy varies. A synthetic speech test on this computer returned a transcript and misheard YouTube; microphone routing is repaired, while Windows accuracy is not guaranteed.
## Offline Whisper

Choose Offline Whisper in Flare Setup, then choose Fast (tiny.en) or Balanced (base.en). Engine and model data are inside the installer. The separately offered Microsoft C++ support runtime may require administrator approval; it is not installed unless selected. You can switch between Windows speech and installed Whisper models in Settings > Intelligence > On-device voice, even with chat AI off.

Whisper runs the captured mono 16 kHz recording through the official CPU-only Whisper.cpp engine. Models and runtime files are checksum-verified before use. Offline mode blocks online transcription, including automatic fallback. Temporary WAV/transcript files are removed on completion or cancellation. Replay audio stays in memory only while Voice is open. A live microphone test on different hardware is still required; a local synthetic English command successfully transcribed with the bundled Fast model.

Declined model components stay unavailable; rerun Setup to add them. No background model download occurs on a user's installed copy. Source builds use the private payload cache prepared by `npm run payloads`.

For the stronger transcription option:

1. Create a key on the [Groq console](https://console.groq.com/keys), using a free-tier account.
2. Select Groq (Whisper voice) in Settings > Intelligence and enter the key.
3. Check connection and select a discovered text model. Voice recognition defaults to Online for this provider.
4. Choose Whisper Turbo (the default) or the discovered `whisper-large-v3` model and Save connection.
5. Open Voice, choose your microphone and speak. Review the editable transcript before submitting the command.

Whisper is an existing open-source speech model, served through Groq's documented OpenAI-compatible transcription endpoint. Flare uses its existing native HTTP client and encrypted key storage; it does not bundle copied application code. Recordings are uploaded only when online voice is enabled. The Groq account's tier controls quota and billing. No live Groq transcription was run without a user-provided key.

References: [Groq speech-to-text](https://console.groq.com/docs/speech-to-text), [Groq rate limits](https://console.groq.com/docs/rate-limits), [OpenAI Whisper source](https://github.com/openai/whisper).

AI answers reveal progressively and stop animating when dismissed or replaced. Reduced motion shows the complete answer immediately. Copy answer copies the complete response.
