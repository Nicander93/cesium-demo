/** A periodic spectrum of crossing ripples, shared by both renderers. */
export function createWaveNormalUrl(): string {
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const context = canvas.getContext('2d')
  if (!context) throw new Error('无法创建水波纹理')
  const data = context.createImageData(size, size)
  const spectrum = Array.from({ length: 24 }, (_, i) => {
    const angle = i * 2.3999632297
    const frequency = 2 + (i % 8) * 2
    const kx = Math.round(Math.cos(angle) * frequency)
    const ky = Math.round(Math.sin(angle) * frequency)
    return { kx, ky, phase: i * 1.734, slope: 0.07 / Math.sqrt(i + 1) }
  })
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x / size) * Math.PI * 2
      const v = (y / size) * Math.PI * 2
      let dx = 0,
        dy = 0
      for (const wave of spectrum) {
        const gradient =
          wave.slope * Math.cos(u * wave.kx + v * wave.ky + wave.phase)
        const frequency = Math.hypot(wave.kx, wave.ky)
        dx += (gradient * wave.kx) / frequency
        dy += (gradient * wave.ky) / frequency
      }
      const length = Math.hypot(dx, dy, 1)
      const index = (y * size + x) * 4
      data.data[index] = Math.round(((dx / length) * 0.5 + 0.5) * 255)
      data.data[index + 1] = Math.round(((dy / length) * 0.5 + 0.5) * 255)
      data.data[index + 2] = Math.round(((1 / length) * 0.5 + 0.5) * 255)
      data.data[index + 3] = 255
    }
  }
  context.putImageData(data, 0, 0)
  return canvas.toDataURL('image/png')
}
