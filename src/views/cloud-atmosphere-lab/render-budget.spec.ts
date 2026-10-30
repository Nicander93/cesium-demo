import { describe, expect, it } from 'vitest'
import { MAX_SCENE_PIXELS, sceneResolutionScale } from './render-budget'
import { buildCommunityCloudParameters, buildCommunityPerformanceBudget, buildCommunityRenderSettings, needsCommunityRebuild } from './provider-settings'
import { defaultLabState } from './url-state'

describe('interactive rendering budget', () => {
  it('bounds native and portrait drawing buffers without changing aspect ratio', () => {
    for (const [width,height] of [[1920,1080],[3840,2160],[1080,1920],[800,600]]) {
      const scale=sceneResolutionScale(width!,height!)
      expect(scale).toBeGreaterThan(0)
      expect(scale).toBeLessThanOrEqual(1)
      expect(width!*height!*scale*scale).toBeLessThanOrEqual(MAX_SCENE_PIXELS+0.001)
    }
    expect(sceneResolutionScale(0,0)).toBe(1)
  })
  it('uses the same pixel and march budget while moving and at rest', () => {
    for(const quality of ['balanced','reference'] as const){
      const state={...defaultLabState,quality}
      expect(buildCommunityRenderSettings(state)).toEqual(buildCommunityRenderSettings({...state,animated:true}))
      const budget=buildCommunityPerformanceBudget(state)
      expect(budget.maxIterationCount).toBeLessThanOrEqual(128)
      expect(budget.maxIterationCountToSun).toBeLessThanOrEqual(3)
      expect(buildCommunityCloudParameters(state)).toMatchObject(budget)
    }
  })
  it('retains density, shape and coverage when selecting an interaction budget', () => {
    const fast=buildCommunityCloudParameters({...defaultLabState,quality:'balanced'})
    const detailed=buildCommunityCloudParameters({...defaultLabState,quality:'reference'})
    for(const key of ['densityScales','shapeAmounts','shapeDetailAmounts','coverage','minLayerHeights','maxLayerHeights'] as const)expect(fast[key]).toEqual(detailed[key])
  })
  it('updates lighting and camera presets without reloading textures or rebuilding shaders', () => {
    expect(needsCommunityRebuild(defaultLabState,{...defaultLabState,exposure:1.2,sunHour:16,cloudShadows:false,animated:true,view:'inside'})).toBe(false)
    expect(needsCommunityRebuild(defaultLabState,{...defaultLabState,cloudThicknessM:2000})).toBe(true)
    expect(needsCommunityRebuild(defaultLabState,{...defaultLabState,quality:'reference'})).toBe(true)
  })
})
