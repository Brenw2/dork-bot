// Small stroke icons drawn with react-native-svg, so they look the same on the phone and the web build.
import Svg, { Path, Rect } from 'react-native-svg';

type IconProps = { size?: number; color: string; stroke?: number };

/** Two overlapping sheets: the Copy button on code blocks. */
export function CopyIcon({ size = 15, color, stroke = 1.8 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={stroke * (24 / size)} strokeLinecap="round" strokeLinejoin="round">
      <Rect x="9" y="9" width="12" height="12" rx="2.5" />
      <Path d="M5 15V6.5A2.5 2.5 0 0 1 7.5 4H15" />
    </Svg>
  );
}
