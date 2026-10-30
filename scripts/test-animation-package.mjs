import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
)
const packageRoot = path.join(repoRoot, 'packages', 'cesium-animation')
const outputRoot = path.join(repoRoot, 'test-results', 'animation-package')
const consumerRoot = path.join(outputRoot, 'consumer')
const reportPath = path.join(outputRoot, 'report.json')
const packageName = '@gis-animation/cesium'
const expectedRuntimeExports = [
  'createAnimation',
  'createCameraTrack',
  'createFlowArrow',
  'createFountain',
  'createFlyLine',
  'createTimeline',
  'parseAnimationDefinition',
]

function run(command, args, cwd, shell = false) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    shell,
    maxBuffer: 16 * 1024 * 1024,
  })
  if (result.error) throw result.error
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

function runChecked(command, args, cwd, shell = false) {
  const result = run(command, args, cwd, shell)
  if (result.status !== 0) {
    throw new Error(
      command +
        ' ' +
        args.join(' ') +
        ' failed (' +
        result.status +
        ')\n' +
        (result.stderr || result.stdout),
    )
  }
  return result
}

function npm(args, cwd) {
  const command = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  return runChecked(command, args, cwd, command === 'npm.cmd')
}

async function writeConsumerFiles() {
  await fs.mkdir(consumerRoot, { recursive: true })
  await fs.writeFile(
    path.join(consumerRoot, 'package.json'),
    JSON.stringify(
      {
        name: 'cesium-animation-package-consumer',
        private: true,
        type: 'module',
      },
      null,
      2,
    ) + '\n',
  )
  await fs.writeFile(
    path.join(consumerRoot, 'tsconfig.json'),
    JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          strict: true,
          noEmit: true,
          skipLibCheck: false,
          types: [],
        },
        files: ['consumer.ts'],
      },
      null,
      2,
    ) + '\n',
  )
  const consumerLines = [
    "import type { Viewer } from 'cesium'",
    'import {',
    '  createAnimation,',
    '  createCameraTrack,',
    '  createFlowArrow,',
    '  createFlyLine,',
    '  createFountain,',
    '  createTimeline,',
    '  parseAnimationDefinition,',
    '  type AnimationDefinition,',
    '  type AnimationInstance,',
    '  type AnimationTrackDefinition,',
    '  type CameraKeyframe,',
    '  type CameraTrackOptions,',
    '  type EffectHandle,',
    '  type FlowArrowOptions,',
    '  type FlyLineOptions,',
    '  type FountainOptions,',
    '  type GeoPoint,',
    '  type SeekReport,',
    '  type TimelineHandle,',
    '  type TimelineOptions,',
    '  type TrackSpec,',
    "} from '@gis-animation/cesium'",
    '',
    'declare const viewer: Viewer',
    'const point: GeoPoint = { lon: 106.63, lat: 26.647, height: 100 }',
    'const cameraKeyframe: CameraKeyframe = {',
    '  time: 0, position: point, heading: 0, pitch: -45, roll: 0, easing: "smoothstep",',
    '}',
    'const cameraOptions: CameraTrackOptions = {',
    '  keyframes: [cameraKeyframe, { ...cameraKeyframe, time: 2 }],',
    '}',
    'const flyOptions: FlyLineOptions = { positions: [point, { ...point, lon: point.lon + 0.01 }] }',
    'const arrowOptions: FlowArrowOptions = { ...flyOptions, spacing: 10 }',
    'const fountainOptions: FountainOptions = { position: point, emissionRate: 90 }',
    '',
    'const fly: EffectHandle<FlyLineOptions> = createFlyLine(viewer, flyOptions)',
    'const arrow = createFlowArrow(viewer, arrowOptions)',
    'const fountain = createFountain(viewer, fountainOptions)',
    'const camera = createCameraTrack(viewer, cameraOptions)',
    'const timelineOptions: TimelineOptions = { duration: 10, driver: "external" }',
    'const timeline: TimelineHandle = createTimeline(viewer, timelineOptions)',
    'const track: TrackSpec<FlyLineOptions> = { id: "fly", effect: fly, at: 0, duration: 2, fill: "hold" }',
    'timeline.add(track)',
    'const report: SeekReport = timeline.setTime(1)',
    '',
    'const flyTrack: AnimationTrackDefinition = {',
    '  id: "definition-fly", kind: "fly-line", at: 0, duration: 4, options: flyOptions,',
    '}',
    'const cameraTrack: AnimationTrackDefinition = {',
    '  id: "definition-camera", kind: "camera", at: 4, duration: 4, options: cameraOptions,',
    '}',
    'const definition: AnimationDefinition = {',
    '  schemaVersion: 1, duration: 10, loop: "none", tracks: [flyTrack, cameraTrack],',
    '}',
    'const parsed = parseAnimationDefinition(definition)',
    'const instance: AnimationInstance = createAnimation(viewer, parsed, { driver: "external" })',
    'instance.timeline.setTime(1)',
    'void [arrow, fountain, camera, report, timeline, instance]',
    '',
  ]
  await fs.writeFile(
    path.join(consumerRoot, 'consumer.ts'),
    consumerLines.join('\n'),
  )
}

async function main() {
  await fs.mkdir(outputRoot, { recursive: true })
  const packageManifest = JSON.parse(
    await fs.readFile(path.join(packageRoot, 'package.json'), 'utf8'),
  )
  for (const file of ['index.js', 'index.d.ts']) {
    await fs.access(path.join(packageRoot, 'dist', file)).catch(() => {
      throw new Error(
        'Missing dist/' + file + '; wait for the SDK build before packing',
      )
    })
  }

  const pack = npm(
    ['pack', '--json', '--pack-destination', outputRoot],
    packageRoot,
  )
  const packed = JSON.parse(pack.stdout)[0]
  assert.ok(packed?.filename, 'npm pack did not report its tarball filename')
  const tarballPath = path.join(outputRoot, packed.filename)
  await writeConsumerFiles()

  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const installArgs = [
    'install',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    '--save-exact',
    '--no-package-lock',
    '--offline',
    // Cesium 1.132 imports this deep path, which zip.js 2.24 no longer exports.
    tarballPath,
    'cesium@1.132.0',
    '@zip.js/zip.js@2.7.70',
  ]
  let installMode = 'offline'
  let install = run(
    npmCommand,
    installArgs,
    consumerRoot,
    npmCommand === 'npm.cmd',
  )
  if (install.status !== 0) {
    installMode = 'online-fallback'
    install = runChecked(
      npmCommand,
      installArgs.filter((arg) => arg !== '--offline'),
      consumerRoot,
      npmCommand === 'npm.cmd',
    )
  }

  const tscPath = path.join(
    repoRoot,
    'node_modules',
    'typescript',
    'bin',
    'tsc',
  )
  await fs.access(tscPath)
  runChecked(
    process.execPath,
    [tscPath, '--project', 'tsconfig.json'],
    consumerRoot,
  )

  const installedRoot = path.join(
    consumerRoot,
    'node_modules',
    '@gis-animation',
    'cesium',
  )
  const installedManifest = JSON.parse(
    await fs.readFile(path.join(installedRoot, 'package.json'), 'utf8'),
  )
  const publicPaths = Object.keys(installedManifest.exports ?? {}).sort()
  assert.deepEqual(
    publicPaths,
    ['.'],
    'Package exports must expose only the public root',
  )

  const sdkEntry = path.join(installedRoot, 'dist', 'index.js')
  const sdk = await import(pathToFileURL(sdkEntry).href)
  const publicExports = Object.keys(sdk).sort()
  assert.deepEqual(
    publicExports,
    [...expectedRuntimeExports].sort(),
    'Unexpected public ESM exports',
  )

  const distEntries = await fs.readdir(path.join(installedRoot, 'dist'), {
    withFileTypes: true,
  })
  const jsFiles = distEntries.filter(
    (entry) => entry.isFile() && entry.name.endsWith('.js'),
  )
  assert.ok(jsFiles.length > 0, 'Package contains no ESM JavaScript files')
  const jsContents = await Promise.all(
    jsFiles.map((entry) =>
      fs.readFile(path.join(installedRoot, 'dist', entry.name), 'utf8'),
    ),
  )
  const jsText = jsContents.join('\n')
  const externalCesium =
    jsText.includes("from 'cesium'") || jsText.includes('from "cesium"')
  assert.ok(externalCesium, 'Cesium must remain an external peer import')
  const jsBytes = jsContents.reduce(
    (size, content) => size + Buffer.byteLength(content),
    0,
  )
  assert.ok(
    jsBytes < 2_000_000,
    'JavaScript output is unexpectedly large and may contain Cesium',
  )
  for (const uiPackage of [
    'vue',
    'vue-router',
    'lil-gui',
    'react',
    'react-dom',
  ]) {
    assert.ok(
      !jsText.includes("from '" + uiPackage + "'") &&
        !jsText.includes('from "' + uiPackage + '"'),
      'SDK package must not import UI framework ' + uiPackage,
    )
  }
  assert.ok(
    !distEntries.some((entry) => entry.isFile() && entry.name.endsWith('.vue')),
    'SDK package must not include Vue SFC files',
  )

  const peerManifest = JSON.parse(
    await fs.readFile(
      path.join(consumerRoot, 'node_modules', 'cesium', 'package.json'),
      'utf8',
    ),
  )
  assert.equal(
    peerManifest.version,
    '1.132.0',
    'Installed Cesium peer must match 1.132.0',
  )
  const zipManifest = JSON.parse(
    await fs.readFile(
      path.join(
        consumerRoot,
        'node_modules',
        '@zip.js',
        'zip.js',
        'package.json',
      ),
      'utf8',
    ),
  )
  assert.equal(
    zipManifest.version,
    '2.7.70',
    'Cesium 1.132 requires a compatible zip.js deep path',
  )
  const report = {
    status: 'passed',
    package: packageName,
    version: packageManifest.version,
    tarballPath,
    publicExports,
    exportPaths: publicPaths,
    typecheck: { status: 'passed', compiler: tscPath },
    installedPeerVersion: peerManifest.version,
    cesiumZipCompatibility: {
      reason:
        'Cesium 1.132 imports @zip.js/zip.js/lib/zip-no-worker.js, which zip.js 2.24 does not export',
      fixedVersion: zipManifest.version,
    },
    checks: {
      installedRealTarball: true,
      cesiumExternalized: externalCesium,
      cesiumJavaScriptBytes: jsBytes,
      noUiImports: true,
      installMode,
    },
  }
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n')
  process.stdout.write(JSON.stringify(report, null, 2) + '\n')
}

main().catch(async (error) => {
  await fs.mkdir(outputRoot, { recursive: true })
  const report = { status: 'failed', error: String(error?.stack ?? error) }
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n')
  process.stderr.write(report.error + '\n')
  process.exitCode = 1
})
