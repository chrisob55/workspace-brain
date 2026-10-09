import { cn } from '@/lib/utils';

export function BrainMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn('shrink-0', className)} aria-hidden>
      <defs>
        <linearGradient id="brain-mark" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#818cf8" />
          <stop offset="1" stopColor="#22d3ee" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill="#0b1020" />
      <g
        fill="none"
        stroke="url(#brain-mark)"
        strokeWidth="2.2"
        strokeLinecap="round"
      >
        <circle cx="10" cy="11" r="3" />
        <circle cx="22" cy="9" r="3" />
        <circle cx="16" cy="22" r="3.5" />
        <path d="M12.6 12.6 14.4 19M19.8 11.2 17.6 18.8M13 10.6h6" />
      </g>
    </svg>
  );
}
