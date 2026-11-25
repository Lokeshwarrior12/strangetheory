import { type ReactNode, useState } from 'react';

interface TiltCardProps {
  children: ReactNode;
  className?: string;
  glowColor?: string;
}

export function TiltCard({ children, className = '', glowColor = '#22D3EE' }: TiltCardProps) {
  const [transform, setTransform] = useState('perspective(900px) rotateX(0deg) rotateY(0deg)');
  const [glowPos, setGlowPos] = useState<{ x: number; y: number; active: boolean }>({
    x: 50,
    y: 50,
    active: false,
  });

  const handleMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * 100;
    const py = ((e.clientY - rect.top) / rect.height) * 100;
    const x = px / 100 - 0.5;
    const y = py / 100 - 0.5;
    const rotY = (x * 4.5).toFixed(2);
    const rotX = (-y * 4.5).toFixed(2);
    setTransform(`perspective(900px) rotateX(${rotX}deg) rotateY(${rotY}deg)`);
    setGlowPos({ x: px, y: py, active: true });
  };

  const handleLeave = () => {
    setTransform('perspective(900px) rotateX(0deg) rotateY(0deg)');
    setGlowPos((prev) => ({ ...prev, active: false }));
  };

  return (
    <div
      onPointerMove={handleMove}
      onPointerLeave={handleLeave}
      style={{ transform, transition: 'transform 180ms cubic-bezier(0.16, 1, 0.3, 1)' }}
      className={`relative rounded-xl ${className}`}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 rounded-xl transition-opacity duration-200"
        style={{
          opacity: glowPos.active ? 1 : 0,
          background: `radial-gradient(320px circle at ${glowPos.x}% ${glowPos.y}%, ${glowColor}1E, transparent 70%)`,
        }}
      />
      {children}
    </div>
  );
}
