import { useEffect, type RefObject } from 'react';
import { cinematicEase } from './usePanelMotion';

// One delegated listener covers controls added by every panel, including keyboard clicks.
export function usePressFeedback(root: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const active = new Map<HTMLElement, Animation[]>();
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    const transparency = matchMedia('(prefers-reduced-transparency: reduce)');
    const contrast = matchMedia('(prefers-contrast: more)');
    const forcedColors = matchMedia('(forced-colors: active)');
    const stop = () => {
      active.forEach((animations) => animations.forEach((animation) => animation.cancel()));
      active.clear();
    };
    const press = (event: MouseEvent) => {
      if (motion.matches || !(event.target instanceof Element)) return;
      const control = event.target.closest<HTMLElement>('button, select, input[type="checkbox"]');
      if (
        !control ||
        control.matches(':disabled, [aria-disabled="true"]') ||
        control.closest('[inert]') ||
        !element.contains(control)
      )
        return;
      // Sample only on interruption, never in an animation loop.
      const previousScale = active.has(control) ? getComputedStyle(control).scale : 'none';
      active.get(control)?.forEach((animation) => animation.cancel());
      const scale = control.matches('.result-main, .setting-link')
        ? '0.995'
        : control.matches('.icon-button')
          ? '0.86'
          : '0.96';
      const animation = control.animate(
        [
          { scale: previousScale === 'none' ? scale : previousScale },
          { scale: control.matches('.icon-button') ? '1.045' : '1.006', offset: 0.58 },
          { scale: '1' },
        ],
        {
          duration: 460,
          easing: cinematicEase,
        },
      );
      const animations = [animation];
      if (
        control.matches('button') &&
        document.documentElement.dataset.glass === 'on' &&
        !transparency.matches &&
        !contrast.matches &&
        !forcedColors.matches
      ) {
        animations.push(
          control.animate([{ opacity: 0.9 }, { opacity: 0 }], {
            pseudoElement: '::after',
            duration: 600,
            easing: 'ease-out',
          }),
        );
      }
      active.set(control, animations);
      Promise.all(animations.map((item) => item.finished.catch(() => {}))).finally(() => {
        if (active.get(control) === animations) active.delete(control);
      });
    };
    element.addEventListener('click', press, true);
    motion.addEventListener('change', stop);
    transparency.addEventListener('change', stop);
    contrast.addEventListener('change', stop);
    forcedColors.addEventListener('change', stop);
    window.addEventListener('blur', stop);
    document.addEventListener('visibilitychange', stop);
    return () => {
      element.removeEventListener('click', press, true);
      motion.removeEventListener('change', stop);
      transparency.removeEventListener('change', stop);
      contrast.removeEventListener('change', stop);
      forcedColors.removeEventListener('change', stop);
      window.removeEventListener('blur', stop);
      document.removeEventListener('visibilitychange', stop);
      stop();
    };
  }, [root]);
}
