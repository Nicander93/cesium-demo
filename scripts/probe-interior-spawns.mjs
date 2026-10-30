#!/usr/bin/env node
/** Probe static triangle collision with the exact staged first-person walker. */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';

const stageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = path.join(stageRoot, 'public/first-person-lab/interior');
const cesiumDemoRoot = process.argv[2] || 'D:/code/cesium-demo';
const tsEntry = path.join(stageRoot, 'src/views/first-person-lab/mesh-walking.ts');
const bundlePath = path.join(stageRoot, 'scripts/.mesh-walking-probe.mjs');
const projectRequire = createRequire(path.join(cesiumDemoRoot, 'package.json'));
let esbuild;
try { esbuild = projectRequire('esbuild'); }
catch { esbuild = projectRequire(path.join(cesiumDemoRoot, 'node_modules/.pnpm/esbuild@0.25.5/node_modules/esbuild')); }

await esbuild.build({
  entryPoints: [tsEntry], outfile: bundlePath, bundle: true, platform: 'node', format: 'esm',
  nodePaths: [path.join(cesiumDemoRoot, 'node_modules/.pnpm/three@0.180.0/node_modules')], logLevel: 'silent',
});
const walker = await import(`${pathToFileURL(bundlePath).href}?run=${Date.now()}`);
const collisionBytes = fs.readFileSync(path.join(outputDir, 'collision.bin'));
const positions = new Float32Array(collisionBytes.buffer, collisionBytes.byteOffset, collisionBytes.byteLength / 4);
const manifestPath = path.join(outputDir, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

const buildStart = performance.now();
const world = walker.createMeshWalkingWorld(positions);
const octreeBuildMs = performance.now() - buildStart;
console.error(`Octree ready: ${world.triangleCount} input triangles in ${octreeBuildMs.toFixed(1)} ms`);
const floorTarget = 0.003;
const [xmin, ymin] = manifest.bounds.min;
const [xmax, ymax] = manifest.bounds.max;
const valid = [];
let gridCount = 0, floorCount = 0, capsuleTestCount = 0, intersectCount = 0;
const floorTris = [];
for (let i = 0; i < positions.length; i += 9) {
  const a = [positions[i], positions[i + 1], positions[i + 2]];
  const b = [positions[i + 3], positions[i + 4], positions[i + 5]];
  const c = [positions[i + 6], positions[i + 7], positions[i + 8]];
  if ([a, b, c].every(p => Math.abs(p[2] - floorTarget) <= 0.025)) floorTris.push([a, b, c]);
}
function onFloor(x, y) {
  return floorTris.some(([a, b, c]) => {
    const v0x = c[0] - a[0], v0y = c[1] - a[1], v1x = b[0] - a[0], v1y = b[1] - a[1];
    const v2x = x - a[0], v2y = y - a[1];
    const dot00 = v0x * v0x + v0y * v0y, dot01 = v0x * v1x + v0y * v1y;
    const dot02 = v0x * v2x + v0y * v2y, dot11 = v1x * v1x + v1y * v1y, dot12 = v1x * v2x + v1y * v2y;
    const denominator = dot00 * dot11 - dot01 * dot01;
    if (Math.abs(denominator) < 1e-12) return false;
    const u = (dot11 * dot02 - dot01 * dot12) / denominator;
    const v = (dot00 * dot12 - dot01 * dot02) / denominator;
    return u >= -1e-5 && v >= -1e-5 && u + v <= 1 + 1e-5;
  });
}
let iy = 0;
for (let y = ymin + 0.3; y <= ymax - 0.3 + 1e-5; y += 0.2, iy++) {
  let ix = 0;
  for (let x = xmin + 0.3; x <= xmax - 0.3 + 1e-5; x += 0.2, ix++) {
    gridCount++;
    if (!onFloor(x, y)) continue;
    floorCount++;
    // The full grid is evaluated against the real floor triangles at 0.2 m.
    // Capsule checks are run at every third grid node to bound Octree query cost.
    if (ix % 3 !== 0 || iy % 3 !== 0) continue;
    capsuleTestCount++;
    let p;
    try { p = walker.spawnMeshPlayer(world, [x, y, 0], 0, 0); }
    catch (error) {
      if (String(error?.message).includes('相交')) intersectCount++;
      continue;
    }
    if (Math.abs(p.footHeight - floorTarget) > 0.025) continue;
    valid.push(p);
  }
}
console.error(`Grid scan: ${gridCount} points at 0.2 m, ${floorCount} floor candidates, ${valid.length} capsule-safe samples`);

const directions = Array.from({ length: 8 }, (_, i) => i * Math.PI / 4);
function probeDirection(start, heading, maxSteps = 6, stopDistance = 1.0) {
  const velocity = { x: Math.cos(heading) * 1.25, y: Math.sin(heading) * 1.25 };
  let p = { ...start }, elapsed = 0, blockedAt = null;
  for (let step = 0; step < maxSteps; step++) {
    const before = p;
    const next = walker.moveMeshPlayer(p, velocity, 0.2, world);
    elapsed += 0.2;
    const travelled = Math.hypot(next.x - before.x, next.y - before.y);
    p = next;
    if (travelled < 0.025) { blockedAt = { x: p.x, y: p.y, footHeight: p.footHeight, elapsedSeconds: elapsed }; break; }
    if (Math.hypot(p.x - start.x, p.y - start.y) >= stopDistance) break;
  }
  const distance = Math.hypot(p.x - start.x, p.y - start.y);
  return { start, velocity, seconds: elapsed, end: { x: p.x, y: p.y, footHeight: p.footHeight }, distance, blockedAt };
}

function estimateClearance(start) {
  let nearest = Infinity;
  for (const heading of directions) {
    const velocity = { x: Math.cos(heading) * 1.25, y: Math.sin(heading) * 1.25 };
    let p = { ...start }, distance = 0;
    for (let step = 0; step < 2; step++) {
      const next = walker.moveMeshPlayer(p, velocity, 0.2, world);
      const moved = Math.hypot(next.x - p.x, next.y - p.y);
      distance += moved;
      p = next;
      if (moved < 0.025) break;
    }
    nearest = Math.min(nearest, distance);
  }
  return Math.min(nearest, 0.5);
}

// Select capsule-safe starts spread across the room, then test actual walking
// trajectories only at those sampled starts.
const roomCenter = [(xmin + xmax) / 2, (ymin + ymax) / 2];
const clearance = new Map(valid.map(p => [p, estimateClearance(p)]));
const sampleStarts = [];
const samplePool = [...valid].sort((a, b) => clearance.get(b) - clearance.get(a));
if (samplePool.length) sampleStarts.push(samplePool[0]);
while (sampleStarts.length < Math.min(6, valid.length)) {
  let best, bestGap = -Infinity;
  for (const p of valid) {
    if (sampleStarts.includes(p)) continue;
    const gap = sampleStarts.length ? Math.min(...sampleStarts.map(q => Math.hypot(p.x - q.x, p.y - q.y))) : Infinity;
    const score = clearance.get(p) + Math.min(gap, 2) * 0.05;
    if (score > bestGap) { best = p; bestGap = score; }
  }
  if (!best) break;
  sampleStarts.push(best);
}
const routeCandidates = [];
for (const start of sampleStarts) {
  const toCenter = Math.atan2(roomCenter[1] - start.y, roomCenter[0] - start.x);
  const headings = [toCenter, 0, Math.PI / 2, Math.PI, -Math.PI / 2];
  let path;
  for (const heading of headings) {
    const candidatePath = probeDirection(start, heading);
    if (candidatePath.distance >= 1.0) { path = candidatePath; break; }
  }
  if (path) routeCandidates.push({ start, path, clearanceMeters: clearance.get(start) });
}
if (routeCandidates.length < 2) throw new Error(`Need 2 walkable spawn points; found ${routeCandidates.length} from ${valid.length} capsule-safe samples`);
routeCandidates.sort((a, b) => b.clearanceMeters - a.clearanceMeters || Math.hypot(a.start.x - roomCenter[0], a.start.y - roomCenter[1]) - Math.hypot(b.start.x - roomCenter[0], b.start.y - roomCenter[1]) || b.path.distance - a.path.distance);
const selected = [routeCandidates[0]];
const second = routeCandidates.filter(c => Math.hypot(c.start.x - selected[0].start.x, c.start.y - selected[0].start.y) >= 1.25).sort((a, b) => b.clearanceMeters - a.clearanceMeters || Math.hypot(a.start.x - roomCenter[0], a.start.y - roomCenter[1]) - Math.hypot(b.start.x - roomCenter[0], b.start.y - roomCenter[1]))[0];
if (!second) throw new Error('Could not find a separated second safe spawn');
selected.push(second);
const spawns = selected.map((candidate, index) => {
  const pathCheck = candidate.path;
  const blockProbes = [0, Math.PI / 2, Math.PI, -Math.PI / 2].map(heading => probeDirection(candidate.start, heading, 25, Infinity)).filter(p => p.blockedAt);
  blockProbes.sort((a, b) => a.distance - b.distance);
  const wallOrFurnitureBlock = blockProbes.length ? {
    heading: Math.atan2(blockProbes[0].velocity.x, blockProbes[0].velocity.y),
    velocity: blockProbes[0].velocity,
    start: blockProbes[0].start,
    point: blockProbes[0].blockedAt,
    distanceBeforeBlock: blockProbes[0].distance,
  } : null;
  return {
    spawn: {
      id: index === 0 ? 'entry' : 'inside',
      label: index === 0 ? 'Entry (mesh-probed)' : 'Inside (mesh-probed)',
      position: [candidate.start.x, candidate.start.y, candidate.start.footHeight],
      heading: Math.atan2(pathCheck.velocity.x, pathCheck.velocity.y), pitch: -0.14,
    },
    path: { ...pathCheck, directionHeading: Math.atan2(pathCheck.velocity.x, pathCheck.velocity.y), spawnClearanceMeters: candidate.clearanceMeters, wallOrFurnitureBlock },
  };
});

const report = {
  sourceModel: manifest.name,
  collisionTriangles: world.triangleCount,
  octreeBuildMs: Number(octreeBuildMs.toFixed(2)),
  grid: { stepMeters: 0.2, testedPoints: gridCount, floorCandidates: floorCount, capsuleTestedSamples: capsuleTestCount, capsuleSafeSamples: valid.length, capsuleIntersectionRejected: intersectCount, acceptedFloorBand: [floorTarget - 0.025, floorTarget + 0.025], capsuleSamplingStride: 3 },
  spawns,
  methodology: 'Uses staged createMeshWalkingWorld/spawnMeshPlayer/moveMeshPlayer; 0.23 m capsule radius, 1.72 m body height, actual collision.bin triangles. Scans x/y at 0.2 m spacing against actual floor triangles and checks capsule spawn every third node; clearance is the minimum of eight 0.5 m capsule movement probes, capped at 0.5 m. Six spatially distributed clear starts are route-probed toward room center/cardinal directions at 1.25 m/s in 0.2 s steps until 1 m travel or blockage. Separate cardinal probes record the first static mesh contact for each selected start.',
};
manifest.spawns = spawns.map(x => x.spawn);
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
const reportPath = path.join(outputDir, 'spawn-probe.json');
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
fs.rmSync(bundlePath, { force: true });
console.log(JSON.stringify(report, null, 2));
