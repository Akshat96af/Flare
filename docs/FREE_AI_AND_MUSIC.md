# Free AI and music commands

## Setup

1. Create an API key in [OpenRouter](https://openrouter.ai/keys). A consumer chat subscription is not an API key.
2. In Flare, open Settings > Intelligence > OpenRouter (free models).
3. Enter the key, then Check connection. Discovery does not generate text or prove generation availability.
4. Choose Automatic (free models), or one of the discovered compatible free models, and Save connection.
5. Test response is optional and requires confirmation. It makes exactly one small request and can consume free quota.

The model list is refreshed from the provider, not a hard-coded promise that every model stays free forever. Flare accepts only the free router or `:free` IDs, filters the catalogue for zero token/request prices and JSON response support, and caps provider prompt, completion and request prices at zero. It never silently switches from Gemini to OpenRouter or uses a paid fallback. Unavailable free capacity still produces an error. Provider account privacy restrictions can also limit available models.

The [free router](https://openrouter.ai/openrouter/free) chooses a compatible free model. This is a practical starting point, not a guarantee of consistent answer quality, speed or uptime. Prompts leave the computer; free providers can have different retention policies. Avoid sensitive prompts unless those policies meet your needs. OpenRouter is text-only in Flare; Windows speech stays available, but cloud speech currently requires Gemini or OpenAI.

## Commands and answers

Explicit basic shortcuts are parsed locally without an AI call. More natural phrasing is interpreted by the selected model and validated against a finite action registry. Ordinary questions return plain-text answers. Apps are matched against indexed app names, with known website fallback; arbitrary shell commands are never executed.

Examples:

- `apple music dil mera by yashraj`
- `play dil mera by yashraj on spotify`
- `open spotify`
- `volume max`
- `what is the difference between RAM and storage?`

Music lookup first verifies title and artist against Apple's public song catalogue, including featured artists. Ambiguous matches ask for clarification. A verified Apple Music track can open directly. Spotify additionally needs an exact mapping on the public Songlink page; its retired public API is not used. Missing mappings, changed page formats and lookup failures do not open guessed tracks or search pages. No Spotify key or paid lookup service is required, but this means Spotify coverage is incomplete.

Checked on 2026-10-10: `Dil Mera` featuring Yashraj resolves to an exact Apple Music track. The public mapping did not expose a Spotify track link, so Flare reports that limitation. Player protocol handlers are checked before opening native links; absent or failed handlers fall back to the exact web URL. Links returned to the renderer are single-use, short-lived capabilities that are cleared on cancellation. Track opening is not verified playback: browser autoplay rules, login, music subscriptions and regional availability still apply. The Spotify playback API is not integrated.

## Verification

`npm run test:ai-music` launches an isolated Electron profile with mocked network responses and external launches. It covers the free model picker, real preload bridge, exact links, single-use tokens, cancellation and visible lookup errors. Unit tests also cover command parsing, host validation, ambiguous matches, free-route restrictions and bounded 503 retries. Live generation quality and paid playback were not tested.

## References

- [OpenRouter free router](https://openrouter.ai/openrouter/free)
- [OpenRouter provider price limits](https://openrouter.ai/docs/guides/routing/provider-selection)
- [Apple search results and track links](https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/iTuneSearchAPI/UnderstandingSearchResults.html)
- [Spotify playback requirements](https://developer.spotify.com/documentation/web-api/reference/start-a-users-playback)
- [Gemini error troubleshooting](https://ai.google.dev/gemini-api/docs/troubleshooting)
