import { useEffect, useRef, type ReactNode } from 'react';

export default function GlassRail({
  children,
  enabled,
}: {
  children: ReactNode;
  enabled: boolean;
}) {
  const rail = useRef<HTMLDivElement>(null);
  const contour = useRef<HTMLSpanElement>(null);
  const near = useRef<HTMLSpanElement>(null);
  const far = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const element = rail.current,
      material = contour.current,
      front = near.current,
      back = far.current;
    if (!element || !material || !front || !back) return;
    const preferences = [
      matchMedia('(prefers-reduced-motion: reduce)'),
      matchMedia('(prefers-reduced-transparency: reduce)'),
      matchMedia('(prefers-contrast: more)'),
      matchMedia('(forced-colors: active)'),
    ];
    const pointer = matchMedia('(hover: hover) and (pointer: fine)');
    const allowed = () => enabled && pointer.matches && !preferences.some((query) => query.matches);
    let bounds: DOMRect | null = null;
    let frame = 0,
      previous = 0,
      deadline = 0;
    const position = [0, 0, 0],
      velocity = [0, 0, 0],
      target = [0, 0, 0];
    const layers = [material, front, back];
    const paint = () => {
      const [x, y, presence] = position;
      material.style.opacity = Math.max(0, Math.min(1, presence)).toFixed(4);
      front.style.transform = `translate3d(${(x * 22).toFixed(3)}px, ${(y * 0.8).toFixed(3)}px, 0) scaleX(${(1 + presence * 0.035).toFixed(4)})`;
      back.style.transform = `translate3d(${(-x * 16).toFixed(3)}px, ${(-y * 0.6).toFixed(3)}px, 0) scaleX(${(1 + presence * 0.025).toFixed(4)})`;
      front.style.opacity = (0.65 - y * 0.25).toFixed(4);
      back.style.opacity = (0.65 + y * 0.25).toFixed(4);
    };
    const releaseLayers = () =>
      layers.forEach((layer) => {
        layer.style.willChange = '';
      });
    const reset = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      bounds = null;
      position.fill(0);
      velocity.fill(0);
      target.fill(0);
      paint();
      releaseLayers();
    };
    const tick = (now: number) => {
      const dt = Math.max(0.001, Math.min(0.032, (now - previous) / 1000));
      previous = now;
      let moving = false;
      for (let i = 0; i < position.length; i++) {
        // Near-critical damping, bounded in time. No layout reads occur in this loop.
        velocity[i] += ((target[i] - position[i]) * 155 - velocity[i] * 25) * dt;
        position[i] += velocity[i] * dt;
        moving ||= Math.abs(target[i] - position[i]) > 0.001 || Math.abs(velocity[i]) > 0.005;
      }
      if (!moving || now >= deadline) {
        target.forEach((value, index) => {
          position[index] = value;
        });
        velocity.fill(0);
        frame = 0;
        paint();
        releaseLayers();
        return;
      }
      paint();
      frame = requestAnimationFrame(tick);
    };
    const animate = () => {
      deadline = performance.now() + 1800;
      if (frame) return;
      material.style.willChange = 'opacity';
      front.style.willChange = back.style.willChange = 'transform, opacity';
      previous = performance.now();
      frame = requestAnimationFrame(tick);
    };
    const move = (event: PointerEvent) => {
      if (!bounds || event.pointerType !== 'mouse') return;
      target[0] = Math.max(-1, Math.min(1, ((event.clientX - bounds.left) / bounds.width) * 2 - 1));
      target[1] = Math.max(-1, Math.min(1, ((event.clientY - bounds.top) / bounds.height) * 2 - 1));
      target[2] = 1;
      animate();
    };
    const enter = (event: PointerEvent) => {
      if (!allowed() || event.pointerType !== 'mouse') return;
      bounds = element.getBoundingClientRect();
      move(event);
    };
    const leave = () => {
      if (!bounds) return;
      bounds = null;
      target.fill(0);
      animate();
    };
    reset();
    const resize = new ResizeObserver(reset);
    resize.observe(element);
    element.addEventListener('pointerenter', enter);
    element.addEventListener('pointermove', move);
    element.addEventListener('pointerleave', leave);
    element.addEventListener('pointercancel', reset);
    window.addEventListener('blur', reset);
    window.addEventListener('flare:dismiss', reset);
    window.addEventListener('resize', reset);
    window.addEventListener('scroll', reset, true);
    document.addEventListener('visibilitychange', reset);
    [...preferences, pointer].forEach((query) => query.addEventListener('change', reset));
    return () => {
      reset();
      resize.disconnect();
      element.removeEventListener('pointerenter', enter);
      element.removeEventListener('pointermove', move);
      element.removeEventListener('pointerleave', leave);
      element.removeEventListener('pointercancel', reset);
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
      <span ref={contour} className="glass-contour" aria-hidden="true">
        <span ref={near} className="glass-contour-near" />
        <span ref={far} className="glass-contour-far" />
      </span>
      {children}
    </div>
  );
}
