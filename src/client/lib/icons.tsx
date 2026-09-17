/** Inline stroke icons. One set, one weight, no emoji anywhere in the app. */

import type { SVGProps } from "react";

const PATHS = {
  grid: "M3 3h7.5v7.5H3zM13.5 3H21v7.5h-7.5zM3 13.5h7.5V21H3zM13.5 13.5H21V21h-7.5z",
  flow: "M7 20V5M3.5 8.5L7 5l3.5 3.5M17 4v15M13.5 15.5L17 19l3.5-3.5",
  scale: "M12 3.5v17M5 7.5h14M5 7.5l-2.6 6a2.9 2.9 0 0 0 5.2 0zM19 7.5l2.6 6a2.9 2.9 0 0 1-5.2 0zM8.5 20.5h7",
  chart: "M3.5 20.5h17M6.8 17v-6M12 17V5.5M17.2 17v-3.5",
  gear: "M12 2.6v2.6M12 18.8v2.6M4.3 4.3l1.9 1.9M17.8 17.8l1.9 1.9M2.6 12h2.6M18.8 12h2.6M4.3 19.7l1.9-1.9M17.8 6.2l1.9-1.9",
  plus: "M12 5.5v13M5.5 12h13",
  close: "M6 6l12 12M18 6L6 18",
  search: "M15.8 15.8l4.7 4.7",
  chevronDown: "M6.5 9.5l5.5 5.5 5.5-5.5",
  chevronLeft: "M14.5 5.5L8 12l6.5 6.5",
  chevronRight: "M9.5 5.5L16 12l-6.5 6.5",
  upRight: "M7 17L17 7M8.5 7h8.5v8.5",
  downLeft: "M17 7L7 17M15.5 17H7V8.5",
  calendar: "M3.2 10h17.6M8.2 2.8v4.4M15.8 2.8v4.4",
  filter: "M3.5 6h17M6.5 12h11M10 18h4",
  download: "M12 3.5v11.5M7.5 10.5L12 15l4.5-4.5M4 20.5h16",
  check: "M4.5 12.5l5 5 10-11",
  alert: "M12 4.2l8.8 15.6H3.2zM12 10v4M12 17h.01",
  repeat: "M4 8.5h11.5a4 4 0 0 1 0 8H9M6.5 5.5l-3 3 3 3M11.5 13.5l-3 3 3 3",
  note: "M5 3.5h9.5L19.5 8.5V20.5H5zM14 3.5v5.2h5.2M8.5 13h7M8.5 16.5h4.5",
  trash: "M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13",
  pencil: "M16.5 4.2l3.3 3.3L8.2 19.1 4 20l.9-4.2z",
  wallet: "M3.2 10.2h17.6",
  bank: "M3.5 9.5L12 4l8.5 5.5M5.5 9.5v9M18.5 9.5v9M10 9.5v9M14 9.5v9M3 20.5h18",
  card: "M2.8 10h18.4",
  car: "M3.5 14.5l1.8-5.2A2.5 2.5 0 0 1 7.7 7.5h8.6a2.5 2.5 0 0 1 2.4 1.8l1.8 5.2",
  seed: "M12 20.5V11M12 11c0-3.6 2.9-6.5 6.5-6.5C18.5 8.1 15.6 11 12 11zM12 14.5c0-2.8-2.2-5-5-5 0 2.8 2.2 5 5 5z",
  tag: "M20.4 12.6L11.8 4H4v7.8l8.6 8.6a1.9 1.9 0 0 0 2.7 0l5.1-5.1a1.9 1.9 0 0 0 0-2.7z",
  home: "M4 10.8L12 4l8 6.8V20H4zM9.5 20v-6h5v6",
  lock: "M7 10.5V8a5 5 0 0 1 10 0v2.5M12 15v2.5",
  logout: "M9 20.5H5.5A1.5 1.5 0 0 1 4 19V5a1.5 1.5 0 0 1 1.5-1.5H9M15.5 16.5L20 12l-4.5-4.5M20 12H9",
  sun: "M12 3v2M12 19v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M3 12h2M19 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4",
  moon: "M20.5 14.8A8.5 8.5 0 0 1 9.2 3.5a8.5 8.5 0 1 0 11.3 11.3z",
  table: "M3.2 9.6h17.6M9.2 9.6v10M3.2 14.6h17.6",
  target: "",
  eyeOff: "M3 3l18 18M10.6 6.3A9.7 9.7 0 0 1 12 6.2c5 0 9 5.8 9 5.8a17 17 0 0 1-2.4 3.1M6.2 8.1A17.6 17.6 0 0 0 3 12s4 5.8 9 5.8a9.4 9.4 0 0 0 3.6-.7M9.9 10.2a2.9 2.9 0 0 0 4 4",
} as const;

/** Icons whose shape needs more than a path. */
const EXTRAS: Partial<Record<IconName, JSX.Element>> = {
  search: <circle cx="10.8" cy="10.8" r="6.8" />,
  target: (
    <>
      <circle cx="12" cy="12" r="8.2" />
      <circle cx="12" cy="12" r="3.4" />
    </>
  ),
  calendar: <rect x="3.2" y="5.2" width="17.6" height="15.6" rx="2.4" />,
  wallet: (
    <>
      <rect x="3.2" y="6" width="17.6" height="13" rx="2.6" />
      <circle cx="16.8" cy="14.6" r="1.25" />
    </>
  ),
  card: <rect x="2.8" y="5.5" width="18.4" height="13" rx="2.4" />,
  car: (
    <>
      <rect x="3" y="14.5" width="18" height="4.5" rx="1.8" />
      <circle cx="7.5" cy="19" r="1.4" />
      <circle cx="16.5" cy="19" r="1.4" />
    </>
  ),
  tag: <circle cx="7.9" cy="7.9" r="1.35" />,
  gear: <circle cx="12" cy="12" r="3.1" />,
  chart: <path d="M3.5 20.5h17" />,
  lock: <rect x="4.5" y="10.5" width="15" height="10.5" rx="2.4" />,
  table: <rect x="3.2" y="4.4" width="17.6" height="15.2" rx="2.2" />,
  moon: undefined,
};

export type IconName = keyof typeof PATHS;

interface IconProps extends Omit<SVGProps<SVGSVGElement>, "name"> {
  name: IconName;
  size?: number;
  strokeWidth?: number;
}

export function Icon({ name, size = 16, strokeWidth = 1.75, ...rest }: IconProps) {
  const path = PATHS[name];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={{ flexShrink: 0 }}
      {...rest}
    >
      {EXTRAS[name]}
      {path ? <path d={path} /> : null}
    </svg>
  );
}
