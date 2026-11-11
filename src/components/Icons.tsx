// Schlichte Linien-Icons (24px), ohne externe Abhängigkeiten.
type P = { className?: string };
const base = (d: React.ReactNode, className = "h-6 w-6") => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
    {d}
  </svg>
);
export const IconHome = ({ className }: P) => base(<><path d="M3 11l9-7 9 7" /><path d="M5 10v10h14V10" /><path d="M10 20v-6h4v6" /></>, className);
export const IconSpark = ({ className }: P) => base(<><path d="M12 3v4M12 17v4M3 12h4M17 12h4" /><path d="M7.5 7.5l2 2M14.5 14.5l2 2M16.5 7.5l-2 2M9.5 14.5l-2 2" /></>, className);
export const IconList = ({ className }: P) => base(<><path d="M8 6h13M8 12h13M8 18h13" /><circle cx="4" cy="6" r="1" /><circle cx="4" cy="12" r="1" /><circle cx="4" cy="18" r="1" /></>, className);
export const IconBook = ({ className }: P) => base(<><path d="M4 5a2 2 0 012-2h12v18H6a2 2 0 01-2-2z" /><path d="M8 7h7M8 11h7" /></>, className);
export const IconMore = ({ className }: P) => base(<><circle cx="5" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="19" cy="12" r="1.5" /></>, className);
export const IconInfo = ({ className }: P) => base(<><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>, className ?? "h-5 w-5");
export const IconChart = ({ className }: P) => base(<><path d="M3 3v18h18" /><path d="M7 15l4-4 3 3 5-6" /></>, className);
export const IconGear = ({ className }: P) => base(<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z" /></>, className);
export const IconDownload = ({ className }: P) => base(<><path d="M12 3v12M7 10l5 5 5-5" /><path d="M5 21h14" /></>, className);
export const IconShield = ({ className }: P) => base(<><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" /></>, className);
export const IconClose = ({ className }: P) => base(<><path d="M6 6l12 12M18 6L6 18" /></>, className);
export const IconSearch = ({ className }: P) => base(<><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></>, className);
export const IconChevron = ({ className }: P) => base(<path d="M9 6l6 6-6 6" />, className ?? "h-5 w-5");
