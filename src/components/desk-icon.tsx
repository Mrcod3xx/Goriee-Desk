"use client";

import { memo } from "react";

// Memoized because Icon is rendered 134 times across the desk and every one of
// those instances used to re-render on each WebSocket price tick. Props are
// primitives, so the default shallow compare is exact and always bails out.
export const Icon = memo(function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true as const,
  };
  const paths: Record<string, React.ReactNode> = {
    grid: <><rect x="3.5" y="3.5" width="7" height="7" rx="1.2" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.2" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.2" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.2" /></>,
    research: <><path d="M4 18.5 9 13l3.5 3 7.5-9" /><path d="M15.5 7H20v4.5" /><path d="M4 21h16" /></>,
    backtest: <><path d="M4 18V9m5 9V5m5 13v-6m5 6V3" /><path d="M2.5 21h19" /></>,
    replay: <><polygon points="11 19 2 12 11 5 11 19" /><polygon points="22 19 13 12 22 5 22 19" /></>,
    wallet: <><rect x="3" y="5" width="18" height="15" rx="2" /><path d="M3 9h18m-5 5h2" /><path d="M6 5V3h12v2" /></>,
    journal: <><path d="M6 3.5h12a1.5 1.5 0 0 1 1.5 1.5v15l-2.5-1.8-2.5 1.8-2.5-1.8-2.5 1.8-2.5-1.8L5 20V5a1.5 1.5 0 0 1 1-1.5Z" /><path d="M8 8h8M8 12h8" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="m19.4 15 .1.1a1.7 1.7 0 0 1-2.4 2.4l-.1-.1a1.7 1.7 0 0 0-2.9 1.2v.2a1.7 1.7 0 0 1-3.4 0v-.2a1.7 1.7 0 0 0-2.9-1.2l-.1.1a1.7 1.7 0 0 1-2.4-2.4l.1-.1a1.7 1.7 0 0 0-1.2-2.9H4a1.7 1.7 0 0 1 0-3.4h.2a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a1.7 1.7 0 0 1 2.4-2.4l.1.1a1.7 1.7 0 0 0 2.9-1.2V2a1.7 1.7 0 0 1 3.4 0v.2a1.7 1.7 0 0 0 2.9 1.2l.1-.1a1.7 1.7 0 0 1 2.4 2.4l-.1.1a1.7 1.7 0 0 0 1.2 2.9h.2a1.7 1.7 0 0 1 0 3.4h-.2a1.7 1.7 0 0 0-1.2 2.9Z" /></>,
    refresh: <><path d="M20 7v5h-5" /><path d="M4.8 9a7.5 7.5 0 0 1 12.7-2L20 9M4 17v-5h5" /><path d="M19.2 15a7.5 7.5 0 0 1-12.7 2L4 15" /></>,
    arrow: <><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></>,
    close: <><path d="m6 6 12 12M18 6 6 18" /></>,
    search: <><circle cx="10.8" cy="10.8" r="6.8" /><path d="m16 16 4.5 4.5" /></>,
    scan: <><path d="M5 8V5h3m8 0h3v3m0 8v3h-3m-8 0H5v-3" /><circle cx="12" cy="12" r="3.2" /><path d="M12 6v2m0 8v2M6 12h2m8 0h2" /></>,
    plus: <><path d="M12 5v14M5 12h14" /></>,
    playbook: <><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z" /><path d="M6 6h10M6 10h10" /><path d="m4 19.5a2.5 2.5 0 0 1 2.5-2.5H20" /></>,
    shield: <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></>,
    bell: <><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></>,
    trending: <><polyline points="23 6 13.5 15.5 8.5 10.5 1 18" /><polyline points="17 6 23 6 23 12" /></>,
    check: <><polyline points="20 6 9 17 4 12" /></>,
    alert: <><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></>,
    calendar: <><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></>,
    sparkles: <><path d="m12 3 1.9 4.8 4.8 1.9-4.8 1.9L12 16.5l-1.9-4.8L5.3 9.8l4.8-1.9L12 3z" /><path d="M19 15l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9.9-2.1z" /></>,
    info: <><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></>,
    cpu: <><rect x="4" y="4" width="16" height="16" rx="2" /><rect x="9" y="9" width="6" height="6" /><line x1="9" y1="1" x2="9" y2="4" /><line x1="15" y1="1" x2="15" y2="4" /><line x1="9" y1="20" x2="9" y2="23" /><line x1="15" y1="20" x2="15" y2="23" /><line x1="20" y1="9" x2="23" y2="9" /><line x1="20" y1="14" x2="23" y2="14" /><line x1="1" y1="9" x2="4" y2="9" /><line x1="1" y1="14" x2="4" y2="14" /></>,
    more: <><circle cx="12" cy="12" r="1.75" /><circle cx="19" cy="12" r="1.75" /><circle cx="5" cy="12" r="1.75" /></>,
    wave: <path d="M2 12c3-4 6-4 9 0s6 4 9 0" />,
    columns: <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 3v18m6-18v18" /></>,
    target: <><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1.5" /></>,
    bolt: <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />,
    chevronDown: <path d="m6 9 6 6 6-6" />,
    clock: <><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></>,
    history: <><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /><path d="M12 7v5l4 2" /></>,
  };
  return <svg {...common}>{paths[name] ?? paths.grid}</svg>;
});
