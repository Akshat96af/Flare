import { useEffect, useRef, type ReactNode, type PointerEvent } from 'react';

export default function GlassRail({
  children,
  enabled,
}: {
  children: ReactNode;
  enabled: boolean;
}) {
  const sheen = useRef<HTMLSpanElement>(null);
  const rail = useRef<HTMLDivElement>(null);
  const bounds = useRef<DOMRect | null>(null);
  const frame = useRef(0);
  const position = useRef(0);
  const clear = () => {
    cancelAnimationFrame(frame.current);
    frame.current = 0;
    bounds.current = null;
    if (sheen.current) sheen.current.style.opacity = '0';
  };
  useEffect(() => {
    if (!enabled) clear();
    const preferences = [
      matchMedia('(prefers-reduced-motion: reduce)'),
      matchMedia('(prefers-reduced-transparency: reduce)'),
      matchMedia('(prefers-contrast: more)'),
      matchMedia('(forced-colors: active)'),
      matchMedia('(hover: hover) and (pointer: fine)'),
    ];
    preferences.forEach((preference) => preference.addEventListener('change', clear));
    const resize = new ResizeObserver(clear);
    if (rail.current) resize.observe(rail.current);
    window.addEventListener('resize', clear);
    window.addEventListener('scroll', clear, true);
    window.addEventListener('blur', clear);
    document.addEventListener('visibilitychange', clear);
    return () => {
      clear();
      resize.disconnect();
      preferences.forEach((preference) => preference.removeEventListener('change', clear));
      window.removeEventListener('resize', clear);
      window.removeEventListener('scroll', clear, true);
      window.removeEventListener('blur', clear);
      document.removeEventListener('visibilitychange', clear);
    };
  }, [enabled]);
  const enter = (event: PointerEvent<HTMLDivElement>) => {
    if (
      !enabled ||
      event.pointerType !== 'mouse' ||
      !matchMedia('(hover: hover) and (pointer: fine)').matches ||
      matchMedia('(prefers-reduced-motion: reduce)').matches ||
      matchMedia('(prefers-reduced-transparency: reduce)').matches ||
      matchMedia('(prefers-contrast: more)').matches ||
      matchMedia('(forced-colors: active)').matches
    )
      return;
    // Cache geometry once per entry; pointer frames only move a composited reflection.
    bounds.current = event.currentTarget.getBoundingClientRect();
    if (sheen.current) sheen.current.style.opacity = '1';
    move(event);
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (!bounds.current) return;
    position.current = Math.max(
      0,
      Math.min(bounds.current.width, event.clientX - bounds.current.left),
    );
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      if (sheen.current)
        sheen.current.style.transform = `translateX(${position.current - 140}px) skewX(-18deg)`;
      frame.current = 0;
    });
  };
  return (
    <div
      ref={rail}
      className="search-bar"
      data-glass-enabled={enabled}
      onPointerEnter={enter}
      onPointerMove={move}
      onPointerLeave={clear}
      onPointerCancel={clear}
    >
      <span ref={sheen} className="glass-sheen" aria-hidden="true" />
      {children}
    </div>
  );
}
