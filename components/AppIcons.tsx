import Svg, { Circle, Path, Rect } from 'react-native-svg';

export type IconName =
  | 'compose' | 'ellipsis' | 'chats' | 'sidebar' | 'back' | 'check' | 'search' | 'warning' | 'clock' | 'plug'
  | 'palette' | 'info' | 'trash' | 'pencil' | 'plus' | 'close';

/** The app's line icons (24 x 24 grid), drawn with react-native-svg so they look the same on the phone and the desktop. */
export function Icon({ name, size = 24, color, stroke = 1.8 }: { name: IconName; size?: number; color: string; stroke?: number }) {
  const line = { stroke: color, strokeWidth: stroke, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };
  let body;
  switch (name) {
    case 'compose':
      body = (
        <>
          <Path d="M12 4H6.5A2.5 2.5 0 0 0 4 6.5v11A2.5 2.5 0 0 0 6.5 20h11a2.5 2.5 0 0 0 2.5-2.5V12" {...line} />
          <Path d="M18.4 3.4a2 2 0 0 1 2.8 2.8L12 15.4 8 16.3l.9-4z" {...line} />
        </>
      );
      break;
    case 'ellipsis':
      body = (
        <>
          <Circle cx={12} cy={12} r={9.5} {...line} />
          <Circle cx={7.8} cy={12} r={1.15} fill={color} />
          <Circle cx={12} cy={12} r={1.15} fill={color} />
          <Circle cx={16.2} cy={12} r={1.15} fill={color} />
        </>
      );
      break;
    case 'chats':
      body = (
        <>
          <Path d="M3.5 6A2.5 2.5 0 0 1 6 3.5h7A2.5 2.5 0 0 1 15.5 6v4A2.5 2.5 0 0 1 13 12.5H8.5L5.5 15v-2.5A2.5 2.5 0 0 1 3.5 10z" {...line} />
          <Path d="M9 16.2c.5.8 1.4 1.3 2.5 1.3H15l3 2.5v-2.5a2.5 2.5 0 0 0 2.5-2.5v-4A2.5 2.5 0 0 0 18 8.5h-1.5" {...line} />
        </>
      );
      break;
    case 'sidebar':
      body = (
        <>
          <Rect x={3.5} y={4.5} width={17} height={15} rx={2.5} {...line} />
          <Path d="M9.5 4.5v15" {...line} />
        </>
      );
      break;
    case 'back':
      body = <Path d="M15.5 3.5 7 12l8.5 8.5" {...line} />;
      break;
    case 'check':
      body = <Path d="M4.5 12.5 9.5 17.5 19.5 6.5" {...line} />;
      break;
    case 'search':
      body = (
        <>
          <Circle cx={10.5} cy={10.5} r={6.5} {...line} />
          <Path d="m15.5 15.5 5 5" {...line} />
        </>
      );
      break;
    case 'warning':
      body = (
        <>
          <Path d="M12 3.5 2.5 20h19z" {...line} />
          <Path d="M12 10v4.5" {...line} />
          <Circle cx={12} cy={17.3} r={0.9} fill={color} />
        </>
      );
      break;
    case 'clock':
      body = (
        <>
          <Circle cx={12} cy={12} r={9} {...line} />
          <Path d="M12 7v5l3 2" {...line} />
        </>
      );
      break;
    case 'plug':
      body = <Path d="M9 2.5v4.5M15 2.5v4.5M6 7h12v4a6 6 0 0 1-12 0zM12 17v4.5" {...line} />;
      break;
    case 'palette':
      body = (
        <>
          <Path d="M12 3a9 9 0 1 0 0 18c1.2 0 1.8-1 1.4-2-.4-1 .3-2.2 1.4-2.2H17a4 4 0 0 0 4-4C21 7 17 3 12 3z" {...line} />
          <Circle cx={7.8} cy={11} r={1} fill={color} />
          <Circle cx={10.5} cy={7.4} r={1} fill={color} />
          <Circle cx={15} cy={7.6} r={1} fill={color} />
        </>
      );
      break;
    case 'info':
      body = (
        <>
          <Circle cx={12} cy={12} r={9} {...line} />
          <Path d="M12 11v6" {...line} />
          <Circle cx={12} cy={7.6} r={0.9} fill={color} />
        </>
      );
      break;
    case 'trash':
      body = <Path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" {...line} />;
      break;
    case 'pencil':
      body = <Path d="M4 20l1-4L16.5 4.5a2.1 2.1 0 0 1 3 3L8 19z" {...line} />;
      break;
    case 'plus':
      body = <Path d="M12 5v14M5 12h14" {...line} />;
      break;
    case 'close':
      body = <Path d="M6 6l12 12M18 6 6 18" {...line} />;
      break;
  }
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessible={false} importantForAccessibility="no-hide-descendants">
      {body}
    </Svg>
  );
}
