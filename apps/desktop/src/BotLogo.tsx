/**
 * Botifyr's mark as a vector, so bots can be given their own colour scheme.
 * The head stays neutral; `accent` (the shield) and `chevron` (the inner "f"
 * badge) are what get recoloured per bot.
 */

export interface BotScheme {
  /** Shield/body colour. */
  accent: string;
  /** Chevron colour behind the "f". */
  chevron: string;
}

export const BOT_SCHEMES: BotScheme[] = [
  { accent: "#19b7c9", chevron: "#f5a623" }, // classic teal + gold
  { accent: "#4f7cf7", chevron: "#93b0ff" },
  { accent: "#8b5cf6", chevron: "#c4a8ff" },
  { accent: "#e0568b", chevron: "#f7a8c4" },
  { accent: "#2bb673", chevron: "#8fe0b6" },
  { accent: "#e0842b", chevron: "#f6c489" },
  { accent: "#d94f4f", chevron: "#f2a3a3" },
  { accent: "#57b0e6", chevron: "#a9d8f5" },
];

/** Stable scheme for a given id, so a bot always keeps the same colours. */
export function schemeFor(id: string): BotScheme {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return BOT_SCHEMES[hash % BOT_SCHEMES.length];
}

interface BotLogoProps {
  size?: number;
  scheme?: BotScheme;
  className?: string;
}

export function BotLogo({ size = 64, scheme = BOT_SCHEMES[0], className }: BotLogoProps) {
  const { accent, chevron } = scheme;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      className={className}
      role="img"
      aria-label="Botifyr"
      focusable="false"
    >
      {/* antennas */}
      <g stroke="#141416" strokeWidth={3.4} strokeLinecap="round">
        <line x1="42" y1="17" x2="34.5" y2="7" />
        <line x1="58" y1="17" x2="65.5" y2="7" />
      </g>
      <circle cx="33" cy="6" r="5" fill="#141416" />
      <circle cx="67" cy="6" r="5" fill="#141416" />

      {/* head */}
      <rect x="27" y="14" width="46" height="30" rx="9" fill="#e9eaee" stroke="#141416" strokeWidth={3.4} />
      <path d="M31 20h20a6 6 0 0 1 6 6v9H34a6 6 0 0 1-6-6v-6a3 3 0 0 1 3-3Z" fill="#f5f6f8" />
      <rect x="40.5" y="23" width="5.5" height="9.5" rx="2.6" fill="#141416" />
      <rect x="54" y="23" width="5.5" height="9.5" rx="2.6" fill="#141416" />

      {/* shield body */}
      <path
        d="M13 46h74L61 87.5Q50 95 39 87.5Z"
        fill={accent}
        stroke="#141416"
        strokeWidth={3.4}
        strokeLinejoin="round"
      />
      {/* chevron */}
      <path
        d="M29 50h42L56 71.5Q50 77 44 71.5Z"
        fill={chevron}
        stroke="#141416"
        strokeWidth={3.4}
        strokeLinejoin="round"
      />
      {/* badge */}
      <circle cx="50" cy="69" r="10" fill="#141416" />
      <text
        x="50"
        y="74"
        textAnchor="middle"
        fontFamily="Georgia, 'Times New Roman', serif"
        fontSize="14"
        fontWeight="700"
        fill="#ffffff"
      >
        f
      </text>
    </svg>
  );
}
