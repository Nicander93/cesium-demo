#!/usr/bin/env node
/**
 * Convert the selected static glTF interior into a normalized, ENU-oriented GLB
 * and export its actual triangle soup for the walking Octree. Node.js only.
 * Usage: node scripts/analyze-interior.mjs <input.gltf> <output-dir>
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [inputArg, outputArg, configArg] = process.argv.slice(2);
const config = configArg ? JSON.parse(fs.readFileSync(path.resolve(configArg), 'utf8')) : {};
if (!inputArg || !outputArg) throw new Error('Usage: node scripts/analyze-interior.mjs <input.gltf> <output-dir>');
const inputPath = path.resolve(inputArg);
const outputDir = path.resolve(outputArg);
const doc = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
const binPath = path.resolve(path.dirname(inputPath), decodeURIComponent(doc.buffers[0].uri));
const bin = fs.readFileSync(binPath);
const f32 = new Float32Array(bin.buffer, bin.byteOffset, Math.floor(bin.byteLength / 4));
const u32 = new Uint32Array(bin.buffer, bin.byteOffset, Math.floor(bin.byteLength / 4));
const compBytes = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const compRead = { 5120: 'getInt8', 5121: 'getUint8', 5122: 'getInt16', 5123: 'getUint16', 5125: 'getUint32', 5126: 'getFloat32' };
const comps = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
const align4 = n => (n + 3) & ~3;
const identity = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function mul(a, b) {
  const o = Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}
function localMatrix(n) {
  if (n.matrix) return n.matrix;
  const [x, y, z, w] = n.rotation || [0, 0, 0, 1];
  const [sx, sy, sz] = n.scale || [1, 1, 1];
  const [tx, ty, tz] = n.translation || [0, 0, 0];
  return [
    (1 - 2 * (y * y + z * z)) * sx, (2 * (x * y + z * w)) * sx, (2 * (x * z - y * w)) * sx, 0,
    (2 * (x * y - z * w)) * sy, (1 - 2 * (x * x + z * z)) * sy, (2 * (y * z + x * w)) * sy, 0,
    (2 * (x * z + y * w)) * sz, (2 * (y * z - x * w)) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    tx, ty, tz, 1,
  ];
}
function point(m, p) {
  const [x, y, z] = p;
  return [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
}
function boundsOf(points) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const p of points) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]); }
  return { min: lo, max: hi };
}
function readAccessor(index) {
  const a = doc.accessors[index];
  if (a.sparse) throw new Error(`Sparse accessor ${index} is unsupported`);
  const view = doc.bufferViews[a.bufferView];
  const count = comps[a.type], bytes = compBytes[a.componentType];
  const stride = view.byteStride || count * bytes;
  const start = (view.byteOffset || 0) + (a.byteOffset || 0);
  const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const values = new Array(a.count);
  for (let i = 0; i < a.count; i++) {
    const v = [];
    for (let c = 0; c < count; c++) {
      const offset = start + i * stride + c * bytes;
      v.push(dv[compRead[a.componentType]](offset, true));
    }
    values[i] = v;
  }
  return values;
}
const roots = doc.scenes?.[doc.scene || 0]?.nodes || doc.nodes.map((_, i) => i).filter(i => !doc.nodes.some(n => n.children?.includes(i)));
const allNodes = [];
function visit(index, parent, out) {
  const n = doc.nodes[index], world = mul(parent, localMatrix(n));
  out.push({ index, node: n, world });
  for (const child of n.children || []) visit(child, world, out);
}
for (const root of roots) visit(root, identity(), allNodes);
const statics = allNodes.filter(x => x.node.mesh !== undefined);
let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
for (const { node, world } of statics) for (const primitive of doc.meshes[node.mesh].primitives) {
  const pos = readAccessor(primitive.attributes.POSITION);
  for (const p of pos) { const q = point(world, p); for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], q[k]); max[k] = Math.max(max[k], q[k]); } }
}
const centerX = (min[0] + max[0]) / 2, centerZ = (min[2] + max[2]) / 2;
// Source uses Y-up and meter-scale coordinates. Keep the GLB Y-up for Cesium's
// glTF-to-ENU handling; only rebase center and floor. The collider separately
// maps the same normalized source coordinates into ENU [x, -z, y].
const floorY = config.floorY ?? min[1];
if (!Number.isFinite(floorY)) throw new Error('floorY must be a finite source Y coordinate');
const rootTransform = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -centerX, -floorY, -centerZ, 1];
const toEnu = p => [p[0] - centerX, -(p[2] - centerZ), p[1] - floorY];
const positions = [], floorCandidates = [], objectSummaries = [];
const glassFiltered = [];
for (const { node, world } of statics) {
  const mesh = doc.meshes[node.mesh];
  let objectMin = [Infinity, Infinity, Infinity], objectMax = [-Infinity, -Infinity, -Infinity], tris = 0;
  for (const primitive of mesh.primitives) {
    if (primitive.mode !== undefined && primitive.mode !== 4) throw new Error(`Non-triangle primitive ${node.name || node.mesh} mode=${primitive.mode}`);
    const materialName = doc.materials?.[primitive.material]?.name || '';
    if (!config.includeGlassCollision && /glass|windowpane/i.test(materialName)) { glassFiltered.push({ node: node.name || '', material: materialName }); continue; }
    const points = readAccessor(primitive.attributes.POSITION).map(p => point(world, p));
    for (const p of points) for (let k = 0; k < 3; k++) { objectMin[k] = Math.min(objectMin[k], p[k]); objectMax[k] = Math.max(objectMax[k], p[k]); }
    let ix;
    if (primitive.indices !== undefined) ix = readAccessor(primitive.indices).map(a => a[0]);
    else ix = points.map((_, i) => i);
    if (primitive.mode === 5 || primitive.mode === 6) throw new Error('Triangle strip/fan primitive unsupported');
    for (let i = 0; i + 2 < ix.length; i += 3) {
      const a = points[ix[i]], b = points[ix[i + 1]], c = points[ix[i + 2]];
      if (!a || !b || !c) throw new Error('Invalid primitive index');
      const ea = toEnu(a), eb = toEnu(b), ec = toEnu(c);
      positions.push(...ea, ...eb, ...ec); tris++;
      const ux = eb[0] - ea[0], uy = eb[1] - ea[1], uz = eb[2] - ea[2];
      const vx = ec[0] - ea[0], vy = ec[1] - ea[1], vz = ec[2] - ea[2];
      const nz = ux * vy - uy * vx;
      if (Math.abs(nz) > 0 && Math.abs(nz) / Math.hypot(ux, uy, uz) / Math.hypot(vx, vy, vz) > 0.995 && ea[2] < 0.04 && eb[2] < 0.04 && ec[2] < 0.04) {
        floorCandidates.push({ center: [(ea[0] + eb[0] + ec[0]) / 3, (ea[1] + eb[1] + ec[1]) / 3, (ea[2] + eb[2] + ec[2]) / 3], area: Math.abs(nz) / 2, name: node.name || '' });
      }
    }
  }
  if (tris) objectSummaries.push({ name: node.name || `mesh-${node.mesh}`, triangles: tris, bounds: boundsOf([[objectMin[0], objectMin[1], objectMin[2]], [objectMin[0], objectMin[1], objectMax[2]], [objectMin[0], objectMax[1], objectMin[2]], [objectMin[0], objectMax[1], objectMax[2]], [objectMax[0], objectMin[1], objectMin[2]], [objectMax[0], objectMin[1], objectMax[2]], [objectMax[0], objectMax[1], objectMin[2]], [objectMax[0], objectMax[1], objectMax[2]]].map(toEnu)) });
}
fs.mkdirSync(outputDir, { recursive: true });
const collisionPath = path.join(outputDir, 'collision.bin');
fs.writeFileSync(collisionPath, Buffer.from(new Float32Array(positions).buffer));
// A glTF root node carries the exact same normalization/ENU transform used by the collider.
const outputDoc = structuredClone(doc);
outputDoc.nodes.push({ name: 'interior-normalized-Y-up', matrix: rootTransform, children: roots });
outputDoc.scenes = [{ name: config.name ?? 'living-room-normalized-Y-up', nodes: [outputDoc.nodes.length - 1] }];
outputDoc.scene = 0;
const outBin = Buffer.from(bin);
outputDoc.buffers = [{ byteLength: outBin.length }];
const jsonBytes0 = Buffer.from(JSON.stringify(outputDoc));
const jsonBytes = Buffer.alloc(align4(jsonBytes0.length), 0x20); jsonBytes0.copy(jsonBytes);
const binBytes = Buffer.alloc(align4(outBin.length)); outBin.copy(binBytes);
const total = 12 + 8 + jsonBytes.length + 8 + binBytes.length;
const glb = Buffer.alloc(total);
glb.write('glTF', 0); glb.writeUInt32LE(2, 4); glb.writeUInt32LE(total, 8);
glb.writeUInt32LE(jsonBytes.length, 12); glb.writeUInt32LE(0x4e4f534a, 16); jsonBytes.copy(glb, 20);
const binHeader = 20 + jsonBytes.length; glb.writeUInt32LE(binBytes.length, binHeader); glb.writeUInt32LE(0x004e4942, binHeader + 4); binBytes.copy(glb, binHeader + 8);
fs.writeFileSync(path.join(outputDir, 'model.glb'), glb);
const enuBounds = boundsOf([[min[0], min[1], min[2]], [min[0], min[1], max[2]], [min[0], max[1], min[2]], [min[0], max[1], max[2]], [max[0], min[1], min[2]], [max[0], min[1], max[2]], [max[0], max[1], min[2]], [max[0], max[1], max[2]]].map(toEnu));
// Find a likely source camera, transforming its eye and viewing direction.
const cam = allNodes.find(x => /camera/i.test(x.node.name || ''));
let sourceCamera;
if (cam) {
  const eye = point(cam.world, [0, 0, 0]);
  const dirEnd = point(cam.world, [0, 0, -1]);
  const e = toEnu(eye), d = toEnu(dirEnd).map((v, i) => v - e[i]);
  sourceCamera = { eye: e, foot: [e[0], e[1], Math.max(0, e[2] - 1.65)], heading: Math.atan2(d[0], d[1]), pitch: Math.atan2(d[2], Math.hypot(d[0], d[1])) };
}
floorCandidates.sort((a, b) => b.area - a.area);
const manifest = {
  schemaVersion: 1, name: config.name ?? 'Benedikt Bitterli Living Room', author: config.author ?? 'Wig42',
  sourceUrl: config.sourceUrl ?? 'https://github.com/ErfanMo77/gltf-research-scenes/tree/1f47d4c63bcad7582150d68300308b0c913bda6c/scenes/living-room',
  license: 'CC-BY-3.0', model: 'model.glb', collision: 'collision.bin',
  triangleCount: positions.length / 9, collisionFormat: 'Float32 triangle soup; 9 little-endian float32 values per triangle (a,b,c), ENU meters; excluded materials listed below',
  bounds: enuBounds,
  normalization: { sourceUp: '+Y', sourceFloorY: floorY, sourceCenterXZ: [centerX, centerZ], glbYUpMap: '[x-centerX, y-floorY, z-centerZ] (Cesium then applies its standard glTF Y-up to ENU conversion)', collisionEnuMap: '[x-centerX, -(z-centerZ), y-floorY]' },
  excludedMaterials: [...new Set(glassFiltered.map(x => x.material))],
  suggestedFloors: floorCandidates.slice(0, 20), sourceCamera,
  geometry: { meshNodes: statics.length, sourceMeshes: doc.meshes.length, materials: doc.materials.length, images: doc.images?.length || 0, objects: objectSummaries.sort((a, b) => b.triangles - a.triangles) },
  spawns: config.spawns ?? floorCandidates.slice(0, 1).map(f => ({ id: 'inside', label: `Floor-triangle candidate near ${f.name}`, position: [f.center[0], f.center[1], 0], heading: Math.atan2(-f.center[1], -f.center[0]), pitch: 0 })),
};
fs.writeFileSync(path.join(outputDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify({ outputDir, triangleCount: manifest.triangleCount, bounds: manifest.bounds, floorCandidates: floorCandidates.length, sourceCamera, objects: manifest.geometry.objects.filter(o => /Floor|Wall|Sofa|Table/i.test(o.name)).slice(0, 10) }, null, 2));

