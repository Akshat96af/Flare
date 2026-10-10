# Design review: Flare

## Summary

Flare is a Windows/Electron launcher for quick, repeated keyboard and pointer actions. Its visual signature is an optical search rail above quiet, readable results. This pass applies the Apple design skill's material and motion principles, not macOS window conventions or a claim to native Apple Liquid Glass.

## Improvements

- **Medium: too many reflective content surfaces.** `liquid-glass.md > The two layers`: the "Functional layer" is distinct from the "Content layer." Selected results now use a stable fill; the optical emphasis stays with navigation, the shell edge and controls.
- **Medium: interruption and preference changes.** `motion.md > Providing feedback`: "Let people cancel motion." Press animations resume from their interrupted scale, cancel on blur or preference changes, and remain brief. Reflections stop when the window loses focus or the pointer leaves.
- **Medium: transparency and contrast.** `accessibility.md > Vision` requires contrast checks; `liquid-glass.md > Review checklist` calls for opaque accessibility fallbacks. Reduced transparency removes reflections, high contrast strengthens surfaces and selection boundaries, and reduced motion removes displacement and the voice-ring rotation.
- **Medium: denser file actions.** `layout.md > Adaptability`: "Design a layout that adapts gracefully and consistently." File actions wrap at compact widths. Quick Share's QR and file information stack without hiding the Stop action. Icon actions retain text labels and tooltips.

## Craft notes

System Segoe typography remains appropriate for a Windows utility: 13 px body, 17 px section headings, 12 px secondary copy. There is no oversized hero. The redesigned material separates a beveled optical search rail and footer from neutral, opaque content. A traveling shared hover lens replaces independent hover flashes; hit targets do not move with the lens. The glass reference image informed the rim thickness, while the search-bar reference informed the reflective edge, without embedding private reference media in the product.

The replacement motion system uses a 680 ms launcher entrance, directional 560 ms panel transitions, and 480 ms content entrances with delays capped at 172 ms. The footer settles over 520 ms. Controls use 460 ms pressure/release feedback and a 600 ms edge fade. Hover transitions take 460 ms and sample their interrupted position. Search results are not staggered on query updates. All commands remain available during motion; Escape is immediate. Motion cancels on blur, dismissal and reduced-motion changes.

The search hover is a stationary optical aperture. A one-pixel platinum/cyan rim reveals symmetrically from the center over 880 ms; a restrained material and inner bevel fade in over 640 ms. Departure closes it in 420 ms. Interrupted transitions sample the rendered state. Text, icons and hit targets never tilt, scale or translate. There is no cursor-following stripe, shader, pointer-move loop or animation at rest. Blur, dismissal, hidden documents and accessibility preference changes clear the effect immediately. This is a glass-inspired material approximation, not physical refraction.

### Material tokens

| Role | Dark | Light | Contrast against content surface (dark / light) |
| --- | --- | --- | --- |
| Content surface | `#1b1d20` | `#f3f5f6` | - |
| Primary text | `#f0f2f4` | `#22262d` | 15.05 / 13.88 |
| Secondary text | `#b2b9c1` | `#586371` | 8.53 / 5.59 |
| Action accent | `#89dcf3` | `#126780` | 10.94 / 5.86 |

These are calculated WCAG ratios for opaque content, not a guarantee for every reflection or animated frame. High-contrast and reduced-transparency modes suppress the optical layers. Layout remains a full-width search rail, scrollable content, and a fixed control footer at regular and compact widths. No new nested glass cards or decorative background imagery were added.

The additional debugging pass used the installed `find-skills`, `systematic-debugging`, `fixing-motion-performance`, and `verification-before-completion` guidance. The `ui-motion` skill was examined but not applied because it requires a different animation library; Flare retains its existing CSS/WAAPI stack.

## What works

Search remains the first screen. Sensitive actions disclose scope at the point of use. File sharing is off until approved. AI discovery and generation verification are separate states. Voice transcripts remain editable before use. Light and dark themes, visible keyboard focus and one-key dismissal are preserved.

## Platform notes

CSS cannot sample other applications behind an Electron transparent window. These highlights are a glass-inspired treatment, not native desktop refraction. Native rendering intentionally avoids a redundant CSS backdrop blur. Real microphone quality, display scaling, screen-reader behavior and animation performance on different GPUs still require human/device testing. Automated contrast/accessibility scans are evidence for tested states, not a blanket conformance claim.
