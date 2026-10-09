import { useEffect, useRef, type RefObject } from 'react';
import { cinematicEase } from './usePanelMotion';

// A single lens travels between controls; hit targets and labels never move.
export default function HoverLens({
  root,
  view,
}: {
  root: RefObject<HTMLElement | null>;
  view: string;
}) {
  const lens = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const surface = root.current,
      highlight = lens.current;
    if (!surface || !highlight) return;
    const preferences = [
      matchMedia('(prefers-reduced-motion: reduce)'),
      matchMedia('(prefers-reduced-transparency: reduce)'),
      matchMedia('(prefers-contrast: more)'),
      matchMedia('(forced-colors: active)'),
    ];
    let target: HTMLElement | null = null;
    let move: Animation | undefined;
    let fade: Animation | undefined;
    let hasPosition = false;
    const clear = () => {
      move?.cancel();
      fade?.cancel();
      highlight.style.opacity = '0';
      highlight.style.transform = 'none';
      highlight.style.width = '0px';
      highlight.style.height = '0px';
      target = null;
      hasPosition = false;
    };
    const leave = () => {
      target = null;
      fade?.cancel();
      fade = highlight.animate([{ opacity: 1 }, { opacity: 0 }], {
        duration: 280,
        fill: 'forwards',
      });
    };
    const over = (event: PointerEvent) => {
      if (
        event.pointerType !== 'mouse' ||
        preferences.some((query) => query.matches) ||
        document.documentElement.dataset.glass !== 'on'
      ) {
        clear();
        return;
      }
      const control =
        event.target instanceof Element
          ? event.target.closest<HTMLElement>(
              '.icon-button, .filter-tabs button, .segmented button, .primary, .subtle',
            )
          : null;
      if (!control || control.matches(':disabled, [aria-disabled="true"]')) {
        if (target) leave();
        return;
      }
      if (target === control) return;
      // Read geometry only when the target changes, never during animation frames.
      const box = control.getBoundingClientRect(),
        base = surface.getBoundingClientRect();
      const old = hasPosition && highlight.getBoundingClientRect();
      const sx = surface.offsetWidth / base.width,
        sy = surface.offsetHeight / base.height;
      const next = {
        x: (box.left - base.left) * sx - surface.clientLeft,
        y: (box.top - base.top) * sy - surface.clientTop,
        width: box.width * sx,
        height: box.height * sy,
      };
      const radius = getComputedStyle(control).borderRadius;
      move?.cancel();
      fade?.cancel();
      highlight.style.width = next.width + 'px';
      highlight.style.height = next.height + 'px';
      highlight.style.borderRadius = radius;
      highlight.style.transform = `translate3d(${next.x}px, ${next.y}px, 0)`;
      highlight.style.opacity = '1';
      const from = old
        ? `translate3d(${(old.left - base.left) * sx - surface.clientLeft}px, ${(old.top - base.top) * sy - surface.clientTop}px, 0) scale(${(old.width * sx) / next.width}, ${(old.height * sy) / next.height})`
        : `translate3d(${next.x}px, ${next.y + 4}px, 0) scale(.86)`;
      move = highlight.animate(
        [
          { transform: from, opacity: old ? 0.85 : 0 },
          { transform: highlight.style.transform, opacity: 1 },
        ],
        { duration: 460, easing: cinematicEase },
      );
      move.id = 'flare-hover';
      target = control;
      hasPosition = true;
    };
    const observer = new MutationObserver(() => {
      if ((target && !target.isConnected) || document.documentElement.dataset.glass !== 'on')
        clear();
    });
    observer.observe(surface, { childList: true, subtree: true });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-glass'],
    });
    const resize = new ResizeObserver(clear);
    resize.observe(surface);
    surface.addEventListener('pointerover', over);
    surface.addEventListener('pointerleave', clear);
    surface.addEventListener('pointerdown', clear);
    surface.addEventListener('scroll', clear, true);
    window.addEventListener('blur', clear);
    window.addEventListener('resize', clear);
    preferences.forEach((query) => query.addEventListener('change', clear));
    return () => {
      clear();
      observer.disconnect();
      resize.disconnect();
      surface.removeEventListener('pointerover', over);
      surface.removeEventListener('pointerleave', clear);
      surface.removeEventListener('pointerdown', clear);
      surface.removeEventListener('scroll', clear, true);
      window.removeEventListener('blur', clear);
      window.removeEventListener('resize', clear);
      preferences.forEach((query) => query.removeEventListener('change', clear));
    };
  }, [root, view]);
  return <span ref={lens} className="hover-lens" aria-hidden="true" />;
}
