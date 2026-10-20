export type MapFrame = [number, number, number, number];
export const NATIONAL_FRAME: MapFrame = [0, 0, 900, 560];

export function constrainMapFrame([x, y, width, height]: MapFrame): MapFrame {
  return [Math.max(0, Math.min(900 - width, x)), Math.max(0, Math.min(560 - height, y)), width, height];
}

export function zoomMapFrame(frame: MapFrame, factor: number, anchor?: [number, number]): MapFrame {
  const [x, y, width, height] = frame;
  const [cx, cy] = anchor ?? [x + width / 2, y + height / 2];
  const nextWidth = Math.max(900 / 16, Math.min(900, width * factor));
  const ratio = nextWidth / width;
  return constrainMapFrame([cx - (cx - x) * ratio, cy - (cy - y) * ratio, nextWidth, height * ratio]);
}
