export interface Placed { column: number; top: number; height: number }

/**
 * Put each item in the shortest column, in order. Heights are known before render,
 * so the grid never shifts. (CSS `columns` is not used: it breaks reading order.)
 */
export function placeMasonry(heights: number[], columns: number, gap: number): { items: Placed[]; height: number } {
  const cols = new Array<number>(Math.max(1, columns)).fill(0);
  const items = heights.map((height) => {
    let column = 0;
    for (let i = 1; i < cols.length; i++) if ((cols[i] ?? 0) < (cols[column] ?? 0) - 0.5) column = i;
    const top = cols[column] ?? 0;
    cols[column] = top + height + gap;
    return { column, top, height };
  });
  return { items, height: Math.max(0, Math.max(...cols) - gap) };
}

/** Column count for a viewport width (section 5.2 of the spec). */
export function columnsFor(width: number): number {
  if (width >= 1400) return 4;
  if (width >= 1024) return 3;
  if (width >= 640) return 2;
  return 1;
}
