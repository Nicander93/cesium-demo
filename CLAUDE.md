# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

This is a Cesium 3D GIS demo application built with Vue 3, TypeScript, and Vite. It showcases various Cesium rendering techniques including masks, water effects, 3D primitives, post-processing effects, and more.

## Common Commands

```bash
# Development
npm run dev              # Start dev server (vite)

# Build
npm run build            # Production build
npm run preview          # Preview production build

# Testing
npm test                 # Run vitest tests
npm run test:ui          # Run tests with UI
npm run test:coverage    # Run tests with coverage report
```

## Architecture

### Cesium Integration

- **Cesium Version**: 1.132.0
- **Plugin**: Uses `vite-plugin-cesium` for seamless Cesium integration
- **Build Path**: Cesium is pre-built in `./src/cesium` (not rebuilt on dev)
- **Ion Access Token**: Configured in `src/main.ts:6`

### Type System

- Uses TypeScript with strict mode enabled
- Cesium types from `@types/cesium` package
- Path aliases configured:
  - `@/*` → `./src/*`
  - `cesium` → `./src/cesium/index.js`

### Core Utility: LayerUtil

Located in `src/utils/cesium-util/cesiumUtils.ts`, this is a comprehensive utility class for creating Cesium layers and entities:

```typescript
import { LayerUtil } from '@/utils/cesium-util/cesiumUtils'

// Create various layer types
const geojsonLayer = await LayerUtil.createLayer({ type: 'geojson', url: '...' })
const primitive = LayerUtil.createLayer({ type: 'primitive', primitiveType: 'polygon', ... })
const entity = LayerUtil.createLayer({ type: 'entity', ... })

// Supports: geojson, kml, czml, wms, wmts, xyz, bing, arcgis, 3dtiles, entity, primitive
```

**Key design patterns:**
- Unified `createLayer()` method handles all layer types via discriminated union
- Accepts both Cesium native types and simplified config
- Automatic position conversion (number arrays → Cartesian3)
- Color parsing from CSS strings

### View Organization

Each Cesium demo feature is a separate route under `src/views/`:

- **mask/** - Shader-based masking techniques
- **mask1/** - Advanced masking (Entity/Primitive/PostProcess/Texture approaches)
  - `mask-types.ts` - Type definitions for masking systems
- **water/** - Water surface effects
- **volume-rendering/** - 3D volumetric rendering
- **tile-local-flatten/** - 3D tileset flattening
- **model-editor/** - Interactive 3D model editing
- **draw-util/** - Drawing tools with `drawUtil.ts`, `tooltip.ts`, `drawDropDown.ts`
- **cesium-event-handler/** - Custom Cesium event handling
- Post-processing demos (fog, snow, etc.)
- ShaderToy integration demos

### Router

Routes defined in `src/router/index.ts` with metadata (title, description, icon). Uses Vue Router 4 with lazy-loaded components.

### Assets

- Cesium assets located in `src/cesium/Assets/` (textures, images, IAU2006 data)
- GeoJSON files alongside their views (e.g., `src/views/mask1/polygon.geojson`)
- Vite configured to include `**/*.geojson` as assets

## Testing

- Framework: Vitest with jsdom environment
- Test files: `**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}` under `src/`
- Coverage provider: v8 (text, json, html reporters)
- Example test: `src/__spec___/LayerUtil.spec.ts`

## Important Notes

- Cesium Ion token is hardcoded in `src/main.ts` - for production, move to environment variables
- The app uses `base: '/cesium-demo/'` in vite.config.ts for deployment subpath
- Many views demonstrate specific rendering techniques - examine individual view folders for implementation details
- For new Cesium features, follow the existing pattern: create a view folder, add route, implement with LayerUtil where applicable
