import { useEffect, useRef, type ReactNode } from 'react';

export default function GlassRail({
  children,
  enabled,
}: {
  children: ReactNode;
  enabled: boolean;
}) {
  const rail = useRef<HTMLDivElement>(null);
  const face = useRef<HTMLDivElement>(null);
  const depth = useRef<HTMLSpanElement>(null);
  const left = useRef<HTMLSpanElement>(null);
  const right = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const element = rail.current,
      surface = face.current;
    const shadow = depth.current,
      key = left.current,
      fill = right.current;
    if (!element || !surface || !shadow || !key || !fill) return;
    const preferences = [
      '(prefers-reduced-motion: reduce)',
      '(prefers-reduced-transparency: reduce)',
      '(prefers-contrast: more)',
      '(forced-colors: active)',
    ].map((query) => matchMedia(query));
    const pointer = matchMedia('(hover: hover) and (pointer: fine)');
    const allowed = () => enabled && pointer.matches && !preferences.some((query) => query.matches);
    let bounds: DOMRect | null = null;
    let frame = 0,
      x = 0,
      y = 0,
      pressed = false;
    let animations: Animation[] = [];
    const rest = 'perspective(1000px) translate3d(0, 0, 0) rotateX(0deg) rotateY(0deg) scale(1)';
    const cancel = () => {
      animations.forEach((animation) => animation.cancel());
      animations = [];
    };
    const reset = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      cancel();
      bounds = null;
      pressed = false;
      surface.style.transform = rest;
      surface.style.willChange = '';
      shadow.style.opacity = key.style.opacity = fill.style.opacity = '0';
      element.dataset.hoverMotion = 'idle';
    };
    const render = (active: boolean) => {
      // All style reads precede writes. The outer hit region never tilts or changes size.
      const from = getComputedStyle(surface).transform;
      const opacities = [shadow, key, fill].map((node) => getComputedStyle(node).opacity);
      cancel();
      const transform = active
        ? `perspective(1000px) translate3d(${(x * 1.4).toFixed(3)}px, ${pressed ? -1 : -2.5}px, 0) rotateX(${(-y * 4.5).toFixed(3)}deg) rotateY(${(x * 0.9).toFixed(3)}deg) scale(${pressed ? 0.988 : 0.994})`
        : rest;
      surface.style.transform = transform;
      surface.style.willChange = 'transform';
      const motion = surface.animate([{ transform: from }, { transform }], {
        duration: active ? (pressed ? 160 : 620) : 760,
        easing: 'cubic-bezier(.16,1,.24,1)',
      });
      motion.id = 'flare-hover-lift';
      const levels = active ? [0.8, 0.55 - x * 0.25, 0.55 + x * 0.25] : [0, 0, 0];
      const next = [motion];
      [shadow, key, fill].forEach((node, i) => {
        node.style.opacity = String(levels[i]);
        const animation = node.animate([{ opacity: opacities[i] }, { opacity: levels[i] }], {
          duration: active ? 500 : 760,
          easing: 'cubic-bezier(.16,1,.24,1)',
        });
        animation.id = 'flare-hover-light';
        next.push(animation);
      });
      animations = next;
      element.dataset.hoverMotion = 'moving';
      Promise.all(next.map((animation) => animation.finished.catch(() => {}))).then(() => {
        if (animations !== next) return;
        surface.style.willChange = '';
        element.dataset.hoverMotion = 'idle';
      });
    };
    const move = (event: PointerEvent) => {
      if (!bounds || event.pointerType !== 'mouse') return;
      x = Math.max(-1, Math.min(1, ((event.clientX - bounds.left) / bounds.width) * 2 - 1));
      y = Math.max(-1, Math.min(1, ((event.clientY - bounds.top) / bounds.height) * 2 - 1));
      if (!frame)
        frame = requestAnimationFrame(() => {
          frame = 0;
          render(true);
        });
    };
    const enter = (event: PointerEvent) => {
      if (!allowed() || event.pointerType !== 'mouse') return;
      bounds = element.getBoundingClientRect();
      move(event);
    };
    const leave = () => {
      if (!bounds) return;
      bounds = null;
      pressed = false;
      cancelAnimationFrame(frame);
      frame = 0;
      render(false);
    };
    const down = (event: PointerEvent) => {
      if (bounds && event.pointerType === 'mouse') {
        pressed = true;
        render(true);
      }
    };
    const up = () => {
      if (pressed && bounds) {
        pressed = false;
        render(true);
      }
    };
    const observer = new ResizeObserver(reset);
    reset();
    observer.observe(element);
    element.addEventListener('pointerenter', enter);
    element.addEventListener('pointermove', move);
    element.addEventListener('pointerleave', leave);
    element.addEventListener('pointerdown', down);
    element.addEventListener('pointercancel', reset);
    window.addEventListener('pointerup', up);
    window.addEventListener('blur', reset);
    window.addEventListener('flare:dismiss', reset);
    window.addEventListener('resize', reset);
    window.addEventListener('scroll', reset, true);
    document.addEventListener('visibilitychange', reset);
    [...preferences, pointer].forEach((query) => query.addEventListener('change', reset));
    return () => {
      reset();
      observer.disconnect();
      element.removeEventListener('pointerenter', enter);
      element.removeEventListener('pointermove', move);
      element.removeEventListener('pointerleave', leave);
      element.removeEventListener('pointerdown', down);
      element.removeEventListener('pointercancel', reset);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('blur', reset);
      window.removeEventListener('flare:dismiss', reset);
      window.removeEventListener('resize', reset);
      window.removeEventListener('scroll', reset, true);
      document.removeEventListener('visibilitychange', reset);
      [...preferences, pointer].forEach((query) => query.removeEventListener('change', reset));
    };
  }, [enabled]);

  return (
    <div ref={rail} className="search-bar" data-glass-enabled={enabled}>
      <span ref={depth} className="rail-depth" aria-hidden="true" />
      <div ref={face} className="search-surface">
        <span ref={left} className="rail-light rail-light-left" aria-hidden="true" />
        <span ref={right} className="rail-light rail-light-right" aria-hidden="true" />
        {children}
      </div>
    </div>
  );
}
