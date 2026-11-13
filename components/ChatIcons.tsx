// Stroke icons for the message box and the chat's status chips (react-native-svg: same on the phone and the web build).
import Svg, { Path, Rect } from 'react-native-svg';

type IconProps = { size: number; color: string; stroke?: number };

const base = (size: number, color: string, stroke: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none' as const,
  stroke: color,
  strokeWidth: stroke * (24 / size),
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
});

/** Send: ↑. */
export function ArrowUpIcon({ size, color, stroke = 2.6 }: IconProps) {
  return (
    <Svg {...base(size, color, stroke)}>
      <Path d="M12 20V5" />
      <Path d="M5.5 11.5 12 5l6.5 6.5" />
    </Svg>
  );
}

/** The attach button's plus. */
export function PlusIcon({ size, color, stroke = 2 }: IconProps) {
  return (
    <Svg {...base(size, color, stroke)}>
      <Path d="M12 5v14M5 12h14" />
    </Svg>
  );
}

/** Stop: a filled rounded square (10x10 at the default size, radius 2). */
export function StopIcon({ size = 10, color }: { size?: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 10 10">
      <Rect width="10" height="10" rx="2" fill={color} />
    </Svg>
  );
}

/** A finished step (✓) or an answered approval. */
export function CheckIcon({ size, color, stroke = 2.2 }: IconProps) {
  return (
    <Svg {...base(size, color, stroke)}>
      <Path d="M5 12.5l4.5 4.5L19 7.5" />
    </Svg>
  );
}

/** A failed or denied step (✕). */
export function CrossIcon({ size, color, stroke = 2.2 }: IconProps) {
  return (
    <Svg {...base(size, color, stroke)}>
      <Path d="M6 6l12 12M18 6L6 18" />
    </Svg>
  );
}
