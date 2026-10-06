/** Brand marks for the "Connect apps" surface (inline so there are no extra assets). */

interface IconProps {
  size?: number;
}

export function GmailIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden focusable="false">
      <path
        fill="#EA4335"
        d="M24 5.46v13.9c0 .9-.73 1.64-1.64 1.64h-3.82V11.73L12 16.64l-6.55-4.91v9.27H1.64A1.64 1.64 0 0 1 0 19.36V5.46c0-2.02 2.31-3.18 3.93-1.96L5.45 4.64 12 9.55l6.55-4.91 1.53-1.14C21.69 2.28 24 3.43 24 5.46Z"
      />
    </svg>
  );
}

export function CalendarIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden focusable="false">
      <rect x="3" y="3" width="18" height="18" rx="2.4" fill="#1A73E8" />
      <rect x="5" y="6.6" width="14" height="12.4" fill="#fff" />
      <rect x="6.5" y="1.6" width="1.8" height="3.4" rx="0.9" fill="#1A73E8" />
      <rect x="15.7" y="1.6" width="1.8" height="3.4" rx="0.9" fill="#1A73E8" />
      <text
        x="12"
        y="17"
        textAnchor="middle"
        fontFamily="Arial, Helvetica, sans-serif"
        fontSize="7"
        fontWeight="700"
        fill="#1A73E8"
      >
        31
      </text>
    </svg>
  );
}

export function DriveIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 87.3 78" aria-hidden focusable="false">
      <path
        d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z"
        fill="#0066da"
      />
      <path
        d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0-1.2 4.5h27.5z"
        fill="#00ac47"
      />
      <path
        d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.5l5.85 11.5z"
        fill="#ea4335"
      />
      <path d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d" />
      <path
        d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h56.5c1.6 0 3.15-.45 4.5-1.2z"
        fill="#2684fc"
      />
      <path
        d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5z"
        fill="#ffba00"
      />
    </svg>
  );
}
