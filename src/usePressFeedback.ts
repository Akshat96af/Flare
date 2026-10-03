import { useEffect, type RefObject } from 'react';

// One delegated listener covers controls added by every panel, including keyboard clicks.
export function usePressFeedback(root: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const active = new Map<HTMLElement, Animation[]>();
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    const stop = () => {
      active.forEach((animations) => animations.forEach((animation) => animation.cancel()));
      active.clear();
    };
    const press = (event: MouseEvent) => {
      if (motion.matches || !(event.target instanceof Element)) return;
      const control = event.target.closest<HTMLElement>('button, select, input[type="checkbox"]');
      if (!control || control.matches(':disabled') || !element.contains(control)) return;
      active.get(control)?.forEach((animation) => animation.cancel());
      const animation = control.animate([{ scale: '0.97' }, { scale: '1' }], {
        duration: 180,
        easing: 'cubic-bezier(0.23, 1, 0.32, 1)',
      });
      const animations = [animation];
      if (control.matches('button') && document.documentElement.dataset.glass === 'on') {
        animations.push(
          control.animate([{ opacity: 0.8 }, { opacity: 0 }], {
            pseudoElement: '::after',
            duration: 260,
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
    return () => {
      element.removeEventListener('click', press, true);
      motion.removeEventListener('change', stop);
      stop();
    };
  }, [root]);
}
