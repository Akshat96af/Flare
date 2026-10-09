import { useEffect, useRef, type ReactNode } from 'react';

export default function GlassRail({
  children,
  enabled,
}: {
  children: ReactNode;
  enabled: boolean;
}) {
  const rail = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = rail.current;
    if (!element) return;
    const layers = [...element.querySelectorAll<HTMLElement>('[data-rail-layer]')];
    const preferences = [
      '(prefers-reduced-motion: reduce)',
      '(prefers-reduced-transparency: reduce)',
      '(prefers-contrast: more)',
      '(forced-colors: active)',
    ].map((query) => matchMedia(query));
    const pointer = matchMedia('(hover: hover) and (pointer: fine)');
    const allowed = () => enabled && pointer.matches && !preferences.some((query) => query.matches);
    let animations: Animation[] = [];
    let active = false;
    const cancel = () => {
      animations.forEach((animation) => animation.cancel());
      animations = [];
    };
    const reset = () => {
      active = false;
      cancel();
      layers.forEach((layer) => {
        layer.style.opacity = '0';
        layer.style.clipPath =
          layer.dataset.railLayer === 'rim' ? 'inset(0 50% 0 50%)' : 'inset(0)';
      });
      element.dataset.hoverMotion = 'idle';
      element.dataset.hoverActive = 'false';
    };
    const transition = (nextActive: boolean) => {
      if (active === nextActive) return;
      active = nextActive;
      // Sample interrupted layers together; content and hit targets never transform.
      const previous = layers.map((layer) => {
        const style = getComputedStyle(layer);
        return { opacity: style.opacity, clipPath: style.clipPath };
      });
      cancel();
      const next = layers.map((layer, index) => {
        const rim = layer.dataset.railLayer === 'rim';
        const target = {
          opacity: nextActive ? '1' : '0',
          clipPath: rim && !nextActive ? 'inset(0 50% 0 50%)' : 'inset(0)',
        };
        Object.assign(layer.style, target);
        const animation = layer.animate([previous[index], target], {
          duration: nextActive ? (rim ? 880 : 640) : 420,
          easing: nextActive ? 'cubic-bezier(.18,.72,.16,1)' : 'cubic-bezier(.32,0,.2,1)',
        });
        animation.id = 'flare-glass-aperture';
        return animation;
      });
      animations = next;
      element.dataset.hoverMotion = 'moving';
      element.dataset.hoverActive = String(nextActive);
      Promise.all(next.map((animation) => animation.finished.catch(() => {}))).then(() => {
        if (animations !== next) return;
        element.dataset.hoverMotion = 'idle';
      });
    };
    const enter = (event: PointerEvent) => {
      if (event.pointerType === 'mouse' && allowed()) transition(true);
    };
    const leave = () => transition(false);
    const visibility = () => {
      if (document.hidden) reset();
    };
    reset();
    element.addEventListener('pointerenter', enter);
    element.addEventListener('pointerleave', leave);
    element.addEventListener('pointercancel', reset);
    window.addEventListener('blur', reset);
    window.addEventListener('flare:dismiss', reset);
    document.addEventListener('visibilitychange', visibility);
    [...preferences, pointer].forEach((query) => query.addEventListener('change', reset));
    return () => {
      reset();
      element.removeEventListener('pointerenter', enter);
      element.removeEventListener('pointerleave', leave);
      element.removeEventListener('pointercancel', reset);
      window.removeEventListener('blur', reset);
      window.removeEventListener('flare:dismiss', reset);
      document.removeEventListener('visibilitychange', visibility);
      [...preferences, pointer].forEach((query) => query.removeEventListener('change', reset));
    };
  }, [enabled]);

  return (
    <div ref={rail} className="search-bar" data-glass-enabled={enabled}>
      <span className="rail-optics rail-material" data-rail-layer="material" aria-hidden="true" />
      <span className="rail-optics rail-aperture" data-rail-layer="rim" aria-hidden="true" />
      <span className="rail-optics rail-inner-edge" data-rail-layer="inner" aria-hidden="true" />
      {children}
    </div>
  );
}
