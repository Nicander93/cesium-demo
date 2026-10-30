import { describe, expect, it, vi } from 'vitest'
import { EffectCoordinator, type DestroyableEffect } from './effect-coordinator'
import { defaultLabState, readLabState, writeLabState } from './url-state'

function effect(destroy = vi.fn()): DestroyableEffect { return { destroy } }

describe('cloud atmosphere lab state', () => {
  it('persists independent solar time and keeps sunset links at the sunset default', () => {
    expect(readLabState('?weather=sunset').sunHour).toBe(18.5)
    for (const weather of ['sunny', 'sunset'] as const) {
      const state = { ...defaultLabState, weather, sunHour: 16.25 }
      expect(readLabState(writeLabState(state))).toEqual(state)
    }
    expect(readLabState('?sunHour=30').sunHour).toBe(20)
  })
  it('round-trips cloud morphology, transport, filtering and the oblique cloud-top view', () => {
    const state = { ...defaultLabState, cloudForm: 'layered' as const, cloudSampling: 'legacy' as const, cloudLighting: 'legacy' as const, view: 'cloudscape' as const }
    expect(readLabState(writeLabState(state))).toEqual(state)
    expect(readLabState('?cloudForm=unknown').cloudForm).toBe(defaultLabState.cloudForm)
  })
  it('round trips sampling/lighting comparisons and rejects unknown diagnostics', () => {
    const state = { ...defaultLabState, cloudSampling: 'filtered' as const, cloudLighting: 'diffuse' as const, communityDebug: 'alphaTemporal' as const }
    expect(readLabState(writeLabState(state))).toEqual(state)
    expect(readLabState('?cloudSampling=invalid&cloudLighting=invalid&cloudDebug=unknown')).toMatchObject({ cloudSampling: defaultLabState.cloudSampling, cloudLighting: defaultLabState.cloudLighting, communityDebug: null })
  })
  it('defaults to ground-first presentation and persists the full-cloud diagnostic override', () => {
    expect(defaultLabState.cloudPresentation).toBe('adaptive')
    const state = { ...defaultLabState, cloudPresentation: 'full' as const }
    expect(readLabState(writeLabState(state))).toEqual(state)
    expect(readLabState('?cloudPresentation=unsupported').cloudPresentation).toBe('adaptive')
  })
  it('preserves the configured cloud defaults for a bare URL and blank numeric fields', () => {
    expect(readLabState('')).toEqual(defaultLabState)
    expect(readLabState('?coverage=&base=&thickness=&exposure=')).toEqual(defaultLabState)
  })

  it('clamps numeric URL values and ignores unknown enum options', () => {
    const state = readLabState('?provider=remote&coverage=2&base=-4&thickness=9000&exposure=NaN&animated=1')
    expect(state.provider).toBe(defaultLabState.provider)
    expect(state.coverage).toBe(1)
    expect(state.cloudBaseM).toBe(500)
    expect(state.cloudThicknessM).toBe(8000)
    expect(state.exposure).toBe(defaultLabState.exposure)
    expect(state.animated).toBe(true)
  })

  it('round-trips the local provider and its deterministic view selection', () => {
    const state = { ...defaultLabState, provider: 'local' as const, view: 'above' as const, cloudBaseM: 3000, cloudThicknessM: 2000 }
    expect(readLabState(writeLabState(state))).toEqual(state)
  })

  it('round trips reproducible settings', () => {
    const original = { ...defaultLabState, provider: 'community' as const, quality: 'balanced' as const, view: 'orbit' as const, weather: 'overcast' as const, coverage: 0.67, animated: true }
    expect(readLabState(writeLabState(original))).toEqual(original)
  })

  it('round trips and clamps the community ray step experiment', () => {
    const state = { ...defaultLabState, provider: 'community' as const, communityMaxStepM: 150 }
    expect(readLabState(writeLabState(state))).toEqual(state)
    expect(readLabState('?communityStep=20').communityMaxStepM).toBe(80)
    expect(readLabState('?communityStep=5000').communityMaxStepM).toBe(1000)
  })

  it('keeps shape mipmaps as an explicit opt-in cloud experiment', () => {
    expect(defaultLabState.shapeMipmaps).toBe(false)
    const state = { ...defaultLabState, provider: 'community' as const, shapeMipmaps: true }
    expect(readLabState(writeLabState(state))).toEqual(state)
    expect(readLabState('?shapeMipmaps=true').shapeMipmaps).toBe(false)
  })

  it('round trips and clamps the community detail scale experiment', () => {
    const state = { ...defaultLabState, provider: 'community' as const, communityDetailScale: 0.4 }
    expect(readLabState(writeLabState(state))).toEqual(state)
    expect(readLabState('?detailScale=-1').communityDetailScale).toBe(0)
    expect(readLabState('?detailScale=9').communityDetailScale).toBe(1.5)
  })

  it('round trips and clamps the community shape scale experiment', () => {
    expect(defaultLabState.communityShapeScale).toBe(1)
    const state = { ...defaultLabState, provider: 'community' as const, communityShapeScale: 0.5 }
    expect(readLabState(writeLabState(state))).toEqual(state)
    expect(readLabState('?shapeScale=-1').communityShapeScale).toBe(0)
    expect(readLabState('?shapeScale=9').communityShapeScale).toBe(1.5)
  })

  it('allows only known community cloud debug views from a shared URL', () => {
    const state = { ...defaultLabState, provider: 'community' as const, communityDebug: 'weather' as const }
    expect(readLabState(writeLabState(state))).toEqual(state)
    expect(readLabState('?cloudDebug=sampleCount').communityDebug).toBe('sampleCount')
    expect(readLabState('?cloudDebug=classify').communityDebug).toBe('classify')
    expect(readLabState('?cloudDebug=alpha').communityDebug).toBe('alpha')
    expect(readLabState('?cloudDebug=fixedJitter').communityDebug).toBe('fixedJitter')
    for (const communityDebug of ['fixedLightJitter', 'fixedViewJitter', 'opticalStep', 'fullTemporal', 'raw'] as const) {
      const diagnosticState = { ...defaultLabState, communityDebug }
      expect(readLabState(writeLabState(diagnosticState))).toEqual(diagnosticState)
    }
    expect(readLabState('?cloudDebug=arbitrary').communityDebug).toBeNull()
  })
})

describe('effect coordinator', () => {
  it('serializes creation and destroys stale results before the next provider starts', async () => {
    const coordinator = new EffectCoordinator<DestroyableEffect>()
    let release: (() => void) | undefined
    const events: string[] = []
    const first = coordinator.switchTo(async () => {
      events.push('first:start')
      await new Promise<void>((resolve) => { release = resolve })
      events.push('first:end')
      return { destroy: () => events.push('first:destroy') }
    })
    expect(events).toEqual([])
    await Promise.resolve()
    expect(events).toEqual(['first:start'])
    const second = coordinator.switchTo(async () => {
      events.push('second:start')
      return { destroy: () => events.push('second:destroy') }
    })
    release?.()
    expect(await first).toBe(false)
    expect(await second).toBe(true)
    expect(events).toEqual(['first:start', 'first:end', 'first:destroy', 'second:start'])
    await coordinator.dispose()
    await coordinator.dispose()
    expect(events.at(-1)).toBe('second:destroy')
  })

  it('does not start an obsolete queued create and leaves no active effect after failure', async () => {
    const coordinator = new EffectCoordinator<DestroyableEffect>()
    const obsolete = vi.fn(async () => effect())
    const failed = coordinator.switchTo(async () => { throw new Error('init failed') })
    const latest = coordinator.switchTo(async () => effect())
    expect(await failed).toBe(false)
    expect(obsolete).not.toHaveBeenCalled()
    expect(await latest).toBe(true)
    await expect(coordinator.switchTo(async () => { throw new Error('replace failed') })).rejects.toThrow('replace failed')
    expect(coordinator.current).toBeUndefined()
    await coordinator.dispose()
  })
})


