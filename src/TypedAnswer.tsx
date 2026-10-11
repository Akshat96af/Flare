import { useEffect, useState } from 'react';

export default function TypedAnswer({ text }: { text: string }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const preference = matchMedia('(prefers-reduced-motion: reduce)');
    const characters = Array.from(text);
    let frame = 0;
    const started = performance.now();
    const duration = Math.min(6500, Math.max(400, characters.length * 12));
    setShown(preference.matches ? characters.length : 0);
    const tick = (now: number) => {
      setShown(
        Math.min(characters.length, Math.ceil((characters.length * (now - started)) / duration)),
      );
      if (now - started < duration) frame = requestAnimationFrame(tick);
    };
    const reveal = () => {
      cancelAnimationFrame(frame);
      setShown(characters.length);
    };
    if (!preference.matches) frame = requestAnimationFrame(tick);
    preference.addEventListener('change', reveal);
    window.addEventListener('flare:dismiss', reveal);
    return () => {
      cancelAnimationFrame(frame);
      preference.removeEventListener('change', reveal);
      window.removeEventListener('flare:dismiss', reveal);
    };
  }, [text]);
  const characters = Array.from(text);
  return (
    <p className="typed-answer" role="status" aria-label={text}>
      <span aria-hidden="true">
        {characters.slice(0, shown).join('')}
        {shown < characters.length && <span className="typing-caret" />}
      </span>
    </p>
  );
}
