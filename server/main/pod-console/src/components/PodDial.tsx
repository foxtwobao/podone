interface PodDialProps {
  mood?: 'idle' | 'speaking' | 'curious' | 'offline' | 'warn';
  size?: 'sm' | 'md' | 'lg';
}

export function PodDial({ mood = 'idle', size = 'md' }: PodDialProps) {
  const box =
    size === 'sm' ? 'w-8 h-8' : size === 'lg' ? 'w-16 h-16' : 'w-12 h-12';
  const svgSize = size === 'sm' ? 18 : size === 'lg' ? 34 : 24;
  const eyeColor =
    mood === 'speaking'
      ? '#60a5fa'
      : mood === 'curious'
        ? '#facc15'
        : mood === 'warn'
          ? '#f59e0b'
          : mood === 'offline'
            ? '#71717a'
            : '#f4f4f5';

  return (
    <div
      className={`${box} rounded-full bg-[#141416] border-2 flex items-center justify-center shrink-0 ${
        mood === 'speaking'
          ? 'border-blue-400 shadow-[0_0_0_3px_rgba(96,165,250,0.2)]'
          : mood === 'warn'
            ? 'border-amber-500/70'
            : mood === 'offline'
              ? 'border-[var(--border)] opacity-65'
              : 'border-white/15'
      }`}
      aria-hidden="true"
    >
      <svg width={svgSize} height={svgSize} viewBox="0 0 36 36" fill="none">
        {mood === 'curious' ? (
          <>
            <rect x="6" y="12" width="9" height="12" rx="4.5" fill={eyeColor} />
            <rect x="20" y="9" width="10" height="16" rx="5" fill={eyeColor} />
          </>
        ) : mood === 'offline' ? (
          <>
            <rect x="6" y="17" width="9" height="2.6" rx="1.3" fill={eyeColor} />
            <rect x="21" y="17" width="9" height="2.6" rx="1.3" fill={eyeColor} />
          </>
        ) : (
          <>
            <rect x="6" y="11" width="9" height="14" rx="4.5" fill={eyeColor} />
            <rect x="21" y="11" width="9" height="14" rx="4.5" fill={eyeColor} />
          </>
        )}
      </svg>
    </div>
  );
}
