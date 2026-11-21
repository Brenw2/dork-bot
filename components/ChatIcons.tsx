// TEMPORARY shim: delete me. The icons live in AppIcons.tsx (UI-KIT K2). Only Composer.tsx still imports these three
// names; it is being edited by the paste-photos PR, so its import moves to <Icon> after that merges, and this file goes.
// The old icons took a stroke in pixels; Icon takes it on the 24 grid, hence the * 24 / size.
import { Icon } from '@/components/AppIcons';

type IconProps = { size: number; color: string; stroke?: number };

export function ArrowUpIcon({ size, color, stroke = 2.6 }: IconProps) {
  return <Icon name="arrow-up" size={size} color={color} stroke={(stroke * 24) / size} />;
}

export function PlusIcon({ size, color, stroke = 2 }: IconProps) {
  return <Icon name="plus" size={size} color={color} stroke={(stroke * 24) / size} />;
}

export function StopIcon({ size = 10, color }: { size?: number; color: string }) {
  return <Icon name="stop" size={size} color={color} />;
}
