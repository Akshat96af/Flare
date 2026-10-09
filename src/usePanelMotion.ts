import { useLayoutEffect, useRef, type RefObject } from 'react';

export const cinematicEase = 'cubic-bezier(.16, 1, .24, 1)';

export function usePanelMotion(root: RefObject<HTMLElement | null>, view: string) {
  const previous = useRef(view);
  useLayoutEffect(() => {
    const element = root.current;
    const changed = previous.current !== view;
    const returning = view === 'search' || view === 'general' || view === '';
    previous.current = view;
    if (!element || !changed) return;
    element.scrollTop = 0;
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    if (motion.matches) return;
    const surface =
      element.querySelector<HTMLElement>(
        ':scope > .settings-panel, :scope > .tools-panel, :scope > .voice-panel, :scope > .share-panel, :scope > .history-panel, :scope > .plan-panel, :scope > .search-content, :scope > .settings-content',
      ) || (element.matches('.tools-panel') ? element : null);
    if (!surface) return;
    surface.dataset.paneMotion = 'true';
    const animations: Animation[] = [];
    const play = (node: HTMLElement, frames: Keyframe[], duration: number, delay = 0) => {
      const animation = node.animate(frames, {
        duration,
        delay,
        easing: cinematicEase,
        fill: 'backwards',
      });
      animation.id = 'flare-panel';
      animations.push(animation);
    };
    play(
      surface,
      [
        {
          opacity: 0,
          transform: `translate3d(${returning ? -24 : 32}px, 10px, 0) scale(.975)`,
          transformOrigin: '50% 0',
        },
        { opacity: 1, transform: 'translate3d(0, 0, 0) scale(1)', transformOrigin: '50% 0' },
      ],
      560,
    );
    // Choreograph navigation, never query updates. Long forms get a bounded cascade.
    const content =
      surface.querySelector<HTMLElement>(
        ':scope > .settings-content, :scope > .tool-grid, :scope > .share-content',
      ) || surface;
    const children = Array.from(content.children).filter(
      (child): child is HTMLElement =>
        child instanceof HTMLElement && !child.matches('.section-heading, .result-list, style'),
    );
    if (view !== 'search' && children.length <= 12)
      children.forEach((child, index) => {
        play(
          child,
          [
            { opacity: 0.12, transform: 'translate3d(0, 18px, 0)' },
            { opacity: 1, transform: 'translate3d(0, 0, 0)' },
          ],
          480,
          32 + Math.min(index, 5) * 28,
        );
      });
    const heading = surface.querySelector<HTMLElement>(':scope > .section-heading');
    if (heading)
      play(
        heading,
        [
          { opacity: 0.15, transform: 'translate3d(0, -9px, 0)' },
          { opacity: 1, transform: 'translate3d(0, 0, 0)' },
        ],
        480,
        20,
      );
    const footer = element.querySelector<HTMLElement>(':scope > .launcher-footer');
    if (footer)
      play(
        footer,
        [
          { opacity: 0.5, transform: 'translate3d(0, 12px, 0)' },
          { opacity: 1, transform: 'translate3d(0, 0, 0)' },
        ],
        520,
        60,
      );
    const stop = () => animations.forEach((animation) => animation.cancel());
    motion.addEventListener('change', stop);
    window.addEventListener('blur', stop);
    window.addEventListener('flare:dismiss', stop);
    return () => {
      stop();
      motion.removeEventListener('change', stop);
      window.removeEventListener('blur', stop);
      window.removeEventListener('flare:dismiss', stop);
    };
  }, [root, view]);
}

export function useLauncherMotion(root: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    let animations: Animation[] = [];
    const stop = () => {
      animations.forEach((animation) => animation.cancel());
      animations = [];
    };
    const enter = () => {
      stop();
      if (motion.matches) return;
      const animation = element.animate(
        [
          { opacity: 0, transform: 'translate3d(0, -20px, 0) scale(.94)' },
          { opacity: 1, offset: 0.32 },
          { opacity: 1, transform: 'translate3d(0, 0, 0) scale(1)' },
        ],
        { duration: 680, easing: cinematicEase },
      );
      animation.id = 'flare-launch';
      animations.push(animation);
      const rail = element.querySelector('.search-bar');
      if (rail)
        animations.push(
          rail.animate(
            [
              { opacity: 0.2, transform: 'translate3d(0, 8px, 0)' },
              { opacity: 1, transform: 'translate3d(0, 0, 0)' },
            ],
            { duration: 560, delay: 60, easing: cinematicEase, fill: 'backwards' },
          ),
        );
    };
    enter();
    window.addEventListener('flare:activate', enter);
    window.addEventListener('flare:dismiss', stop);
    window.addEventListener('blur', stop);
    motion.addEventListener('change', stop);
    return () => {
      stop();
      window.removeEventListener('flare:activate', enter);
      window.removeEventListener('flare:dismiss', stop);
      window.removeEventListener('blur', stop);
      motion.removeEventListener('change', stop);
    };
  }, [root]);
}
