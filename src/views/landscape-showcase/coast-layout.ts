/** Small layout constants for the synthetic coastal presentation scene. */
export const COAST_BUILDING_ROWS = [130, 255, 380, 505] as const
export const COAST_BUILDINGS_PER_ROW = 13

/** Curved north-south shoreline in local ENU metres. */
export function coastShoreX(y: number): number {
  return 26 * Math.sin(y / 510) + 0.00019 * y * y - 18
}

export interface CoastPalmPlacement {
  x: number
  y: number
  height: number
  crown: number
  heading: number
  prototype: number
  /** ENU ground elevation used by the original Primitive placements. */
  groundHeight: number
}

export const COAST_PALM_ROW_COUNT = 3
export const COAST_PALMS_PER_ROW = 41
export const COAST_PALM_PROTOTYPE_COUNT = 6
export const COAST_PALM_INSTANCE_COUNT =
  COAST_PALM_ROW_COUNT * COAST_PALMS_PER_ROW

/** Reproduces the original 3 x 41 coastal palms, including road-crossing offsets. */
export function createCoastPalmPlacements(): CoastPalmPlacement[] {
  const beachWidth = 40
  const roadWidth = 25
  const groundHeight = 7
  const placements: CoastPalmPlacement[] = []
  for (let row = 0; row < COAST_PALM_ROW_COUNT; row++) {
    for (let index = 0; index < COAST_PALMS_PER_ROW; index++) {
      let y = -1000 + index * 50 + (row % 2) * 18
      if (
        [-700, -450, -200, 50, 300, 550, 800].some(
          (cross) => Math.abs(y - cross) < 22,
        )
      )
        y += 25
      const x = coastShoreX(y) - beachWidth - 31 - roadWidth / 2 - 15 - row * 14
      placements.push({
        x,
        y,
        height: 13 + ((index * 7 + row * 3) % 6),
        crown: (3.7 + ((index + row) % 4) * 0.3) / 4,
        heading: (index * 2.399 + row) % Math.PI,
        prototype: (index + row * 2) % COAST_PALM_PROTOTYPE_COUNT,
        groundHeight,
      })
    }
  }
  return placements
}
