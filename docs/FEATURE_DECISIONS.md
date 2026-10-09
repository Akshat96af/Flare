# Feature decisions

Flare is a fast Windows launcher, not a second file manager. These choices favor a few complete actions over a growing catalogue of partial integrations.

| Candidate | Argument for | Argument against | Decision |
| --- | --- | --- | --- |
| Temporary file sharing | A natural next action after finding a file; no hosting bill | Needs explicit network consent, revocation and expiry | Add one-file, 10-minute LAN links, QR codes and Stop sharing |
| Reveal and copy path | Common launcher actions, immediate and local | Adds toolbar density | Add icon actions only when a file is selected; wrap on narrow windows |
| Pinned shortcuts | Useful for frequently opened locations | Needs a separate home-state and ordering design | Defer to a focused follow-up |
| Another calculator, clipboard manager or preview system | Proven launcher utilities | Flare already has these capabilities | Improve the existing paths; don't add duplicates |
| Cloud storage and public links | Works across different networks | Hosting cost, account handling, retention and privacy obligations | Defer |
| Remote control and plugin marketplace | Broad extensibility | Much larger trust and maintenance boundary | Defer |

## References

- [Flow Launcher](https://github.com/Flow-Launcher/Flow.Launcher): reference for quick file/app actions, previews and calculator workflows. No source copied.
- [PowerToys Command Palette](https://learn.microsoft.com/en-us/windows/powertoys/command-palette/overview): reference for a focused command surface. No source copied.
- [LocalSend](https://github.com/localsend/localsend): reference for server-free local sharing. LocalSend uses its own secure protocol. Flare does **not** implement that protocol or claim interoperability.

## Sharing boundary

Flare's current sharing feature is a browser-download link over **unencrypted HTTP** on one chosen private IPv4 interface. A private IP address does not prove a network is trusted: the user must approve the network before starting. The random link is a bearer secret, not a recipient identity check. Anyone who obtains it and can reach the interface can download the selected file.

The server does not start on launch, exposes no directory listing or upload endpoint, expires after ten minutes, and stops on demand or app exit. New download requests check the selected file's identity and modification metadata. Do not edit a file during a transfer. Closing the panel keeps the share active; the footer and tray indicate that state. Windows Firewall, VPN routing, guest-network isolation and different subnets can prevent reception. No firewall rules are changed automatically.

For confidential files or authenticated, encrypted transfers, use an appropriate secure sharing tool rather than this preview feature.
