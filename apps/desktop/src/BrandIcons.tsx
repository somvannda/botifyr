/** Brand marks for marketplace apps (self-contained SVGs). */

interface IconProps {
  size?: number;
  className?: string;
}

export function GithubBrand({ size = 24, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden className={className}>
      <path
        fill="#1b1f24"
        d="M12 .5A11.5 11.5 0 0 0 .5 12a11.5 11.5 0 0 0 7.86 10.92c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.53-1.34-1.3-1.7-1.3-1.7-1.06-.72.08-.71.08-.71 1.17.08 1.79 1.2 1.79 1.2 1.04 1.79 2.73 1.27 3.4.97.1-.76.4-1.27.74-1.56-2.56-.29-5.26-1.28-5.26-5.7 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.8 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.84 1.19 3.1 0 4.43-2.7 5.4-5.28 5.69.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 23.5 12 11.5 11.5 0 0 0 12 .5Z"
      />
    </svg>
  );
}

export function SlackBrand({ size = 24, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden className={className}>
      <path
        fill="#E01E5A"
        d="M5.04 15.16a2.53 2.53 0 0 1-2.52 2.53A2.53 2.53 0 0 1 0 15.16a2.53 2.53 0 0 1 2.52-2.52h2.52v2.52Zm1.27 0a2.53 2.53 0 0 1 2.52-2.52 2.53 2.53 0 0 1 2.52 2.52v6.32A2.53 2.53 0 0 1 8.83 24a2.53 2.53 0 0 1-2.52-2.52v-6.32Z"
      />
      <path
        fill="#36C5F0"
        d="M8.83 5.04a2.53 2.53 0 0 1-2.52-2.52A2.53 2.53 0 0 1 8.83 0a2.53 2.53 0 0 1 2.52 2.52v2.52H8.83Zm0 1.27a2.53 2.53 0 0 1 2.52 2.52 2.53 2.53 0 0 1-2.52 2.52H2.52A2.53 2.53 0 0 1 0 8.83a2.53 2.53 0 0 1 2.52-2.52h6.31Z"
      />
      <path
        fill="#2EB67D"
        d="M18.96 8.83a2.53 2.53 0 0 1 2.52-2.52A2.53 2.53 0 0 1 24 8.83a2.53 2.53 0 0 1-2.52 2.52h-2.52V8.83Zm-1.27 0a2.53 2.53 0 0 1-2.52 2.52 2.53 2.53 0 0 1-2.52-2.52V2.52A2.53 2.53 0 0 1 15.17 0a2.53 2.53 0 0 1 2.52 2.52v6.31Z"
      />
      <path
        fill="#ECB22E"
        d="M15.17 18.96a2.53 2.53 0 0 1 2.52 2.52A2.53 2.53 0 0 1 15.17 24a2.53 2.53 0 0 1-2.52-2.52v-2.52h2.52Zm0-1.27a2.53 2.53 0 0 1-2.52-2.52 2.53 2.53 0 0 1 2.52-2.52h6.31A2.53 2.53 0 0 1 24 15.17a2.53 2.53 0 0 1-2.52 2.52h-6.31Z"
      />
    </svg>
  );
}

export function NotionBrand({ size = 24, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden className={className}>
      <rect x="2" y="2" width="20" height="20" rx="4" fill="#111" />
      <path d="M8 17V7h2.3l3.9 6V7H17v10h-2.3l-3.9-6v6H8Z" fill="#fff" />
    </svg>
  );
}

export function TelegramBrand({ size = 24, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden className={className}>
      <circle cx="12" cy="12" r="11" fill="#229ED9" />
      <path
        d="M6.2 11.7 17.5 7.4c.5-.2 1 .1.8.9l-1.6 7.4c-.1.5-.4.6-.8.4l-2.6-1.9-1.2 1.2c-.2.2-.4.2-.6 0l.4-2.6 4.7-4.2c.2-.2 0-.3-.3-.2l-5.8 3.6-2.1-.6c-.5-.2-.5-.5.3-.7Z"
        fill="#fff"
      />
    </svg>
  );
}
