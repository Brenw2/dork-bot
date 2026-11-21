export declare const ZOOM_STEP: number;
export declare const ZOOM_MIN: number;
export declare const ZOOM_MAX: number;
export type ZoomAction = 'in' | 'out' | 'reset';
export declare function zoomAction(input: { type?: string; key?: string; control?: boolean; meta?: boolean; alt?: boolean } | null | undefined): ZoomAction | null;
export declare function nextZoom(level: number, action: ZoomAction): number;
