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
          transform: `translate3d(${returning ? -12 : 16}px, 0, 0)`,
          transformOrigin: '50% 0',
        },
        { opacity: 1, transform: 'translate3d(0, 0, 0)', transformOrigin: '50% 0' },
      ],
      320,
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
            { opacity: 0.3, transform: 'translate3d(0, 6px, 0)' },
            { opacity: 1, transform: 'translate3d(0, 0, 0)' },
          ],
          240,
          16 + Math.min(index, 5) * 16,
        );
      });
    const heading = surface.querySelector<HTMLElement>(':scope > .section-heading');
    if (heading)
      play(
        heading,
        [
          { opacity: 0.5, transform: 'translate3d(0, -4px, 0)' },
          { opacity: 1, transform: 'translate3d(0, 0, 0)' },
        ],
        240,
        0,
      );
    const footer = element.querySelector<HTMLElement>(':scope > .launcher-footer');
    if (footer)
      play(
        footer,
        [
          { opacity: 0.6, transform: 'translate3d(0, 4px, 0)' },
          { opacity: 1, transform: 'translate3d(0, 0, 0)' },
        ],
        260,
        20,
      );
    const stop = () => animations.forEach((animation) => animation.cancel());
    // Settle moving ancestors before a picker calculates its top-layer anchor.
    const interact = (event: Event) => {
      if (event.target instanceof Element && event.target.closest('select, input, textarea'))
        stop();
    };
    element.addEventListener('pointerdown', interact, true);
    element.addEventListener('focusin', interact);
    motion.addEventListener('change', stop);
    window.addEventListener('blur', stop);
    window.addEventListener('flare:dismiss', stop);
    return () => {
      stop();
      element.removeEventListener('pointerdown', interact, true);
      element.removeEventListener('focusin', interact);
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
          { opacity: 0, transform: 'translate3d(0, -10px, 0) scale(.985)' },
          { opacity: 1, offset: 0.32 },
          { opacity: 1, transform: 'translate3d(0, 0, 0) scale(1)' },
        ],
        { duration: 420, easing: cinematicEase },
      );
      animation.id = 'flare-launch';
      animations.push(animation);
      const rail = element.querySelector('.search-bar');
      if (rail)
        animations.push(
          rail.animate(
            [
              { opacity: 0.4, transform: 'translate3d(0, 4px, 0)' },
              { opacity: 1, transform: 'translate3d(0, 0, 0)' },
            ],
            { duration: 300, delay: 30, easing: cinematicEase, fill: 'backwards' },
          ),
        );
    };
    const settlePicker = (event: Event) => {
      if (event.target instanceof Element && event.target.closest('select')) stop();
    };
    enter();
    element.addEventListener('pointerdown', settlePicker, true);
    element.addEventListener('focusin', settlePicker);
    window.addEventListener('flare:activate', enter);
    window.addEventListener('flare:dismiss', stop);
    window.addEventListener('blur', stop);
    motion.addEventListener('change', stop);
    return () => {
      stop();
      element.removeEventListener('pointerdown', settlePicker, true);
      element.removeEventListener('focusin', settlePicker);
      window.removeEventListener('flare:activate', enter);
      window.removeEventListener('flare:dismiss', stop);
      window.removeEventListener('blur', stop);
      motion.removeEventListener('change', stop);
    };
  }, [root]);
}
