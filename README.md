# three.js — vibegameengine fork

A fork of [three.js](https://github.com/mrdoob/three.js) **r182** that renders large WebGPU scenes for less CPU and fewer GPU commands, the way a modern engine renderer does: draws are recorded once and replayed, transforms live in one GPU buffer, culling runs on the GPU, and nothing that did not change is touched again.

**[See it side by side with stock r182 →](https://vibegameengine.github.io/three.js/)** — the same city of 12,801 meshes, the same code, each pane timed on its own.

| | stock r182 | this fork |
|---|---|---|
| City demo, 1600x900, Chrome 154, Windows | 30.1 FPS (33.2 ms) | 56.9 FPS (17.6 ms) |

It is the renderer of an engine we build on top of three.js. Everything here was written for real scenes of that engine and measured on them before it landed.

## Why

Stock three.js redoes the whole frame on the CPU: it walks the scene graph, recomputes every world matrix, frustum-culls every object, rebuilds and re-records every draw, and uploads every object's uniforms, every frame. On WebGPU each recorded command also has to be validated and translated by the browser's GPU process. With a few hundred objects none of this matters. With tens of thousands it is the whole frame, and the GPU sits idle waiting for it.

The fork moves that work to where engines keep it:

- **Draws are recorded once.** A draw becomes a render bundle and is replayed while nothing about it changes. A retained scene pass keeps the scene's draw list between frames and rebuilds it only when the scene's structure changes.
- **Transforms live in GPUScene.** Every object's world matrix (and last frame's, for motion vectors) sits in one storage buffer. Only the objects that moved are uploaded, and a compute pass scatters them into place. Shaders read the matrix from there instead of from per-object uniforms.
- **Culling runs on the GPU.** The retained pass culls against the frustum in a compute pass that writes the indirect draw arguments. A hidden or culled draw costs nothing on the CPU.
- **Only what changed is touched.** Transform and visibility journals tell readers which objects moved or changed visibility, so nobody scans the scene to find out. World matrices follow transform writes, and material uniforms refresh only when their sources signal a change.

## What's in it

Everything below is on `vibe`. A tick means it works with no code change; the rest is opt-in.

**Faster without changes**

- ✓ One command encoder and one queue submit a frame; consecutive compute calls share one compute pass.
- ✓ Draws recorded once into render bundles and replayed.
- ✓ World matrices recomputed only for objects whose transform changed (`Object3D` transform journal, `transformChangesSince`).
- ✓ Showing or hiding an object no longer rebuilds the scene's draw lists.
- ✓ `NodeBuilder` memoises node types per build stage: a heavy scene's shader generation went from 17.0 s to 6.2 s.
- ✓ `InstanceNode` velocity, from upstream r183 (#32586, #32615): instanced meshes report correct motion vectors, so TAA stops shimmering on static instances.
- ✓ A view's camera uniforms are shared by every draw that reads that camera.
- ✓ Skinning with more than four influences (`skinIndex1` / `skinWeight1` …).

**Opt-in**

| Feature | How |
|---|---|
| GPUScene | `renderer.gpuScene = new THREE.GpuScene()` before the first render |
| Retained scene pass | `const pass = renderer.createRetainedPass()`, then `renderer.renderRetained( scene, camera, pass )` every frame (needs GPUScene) |
| GPU instance culling | `InstancedMesh.instanceCulling` — a GPU-culled view draws indirect and reads its instance ids from a compacted list |
| LOD levels inside one mesh | `mesh.screenSizeLods = { geometries, screenSizes }`; the retained cull picks the level by screen size, and every pass uses the main view's level |
| GPU-only index and per-group indirect offsets | `geometry.drawIndex`, `group.indirectOffset` |
| Pulled vertices | `geometry.pulledVertices` supplies attribute and primitive nodes in place of vertex buffers |
| Raster bins | a retained main view draws every mesh of one material with a single indirect draw (`retainedPass.rasterBins`) |
| GPUScene data in shaders | `gpuSceneWorldOf( primitive )`, `gpuScenePreviousWorldOf( primitive )`, `gpuSceneCustomData` |

## Trade-offs

Read this before you switch.

- **Pinned to r182.** Upstream has moved on. Changes are merged from upstream by hand, and only when we need them.
- **WebGPU only.** Every gain is in the WebGPU backend. The WebGL fallback is not tested.
- **Use the sources, not `build/`.** The files in `build/` are stock r182 and contain none of this. Point your bundler at `src/` (see below).
- **The retained pass has rules.** It needs GPUScene. It does not take an `ArrayCamera`, nor a `BundleGroup` or `ClippingGroup` inside the scene. Enable GPUScene before the first render: materials built earlier keep their per-object matrix uniforms.
- **Behaviour differs in small ways.** A world matrix is recomputed only for an object whose `position`, `rotation`, `quaternion` or `scale` was written, whose `matrixWorldNeedsUpdate` was set, or whose ancestor moved. A frame-by-frame `updateMatrixWorld( true )` sweep still works but costs what it did in stock. An object that must be recomputed every frame regardless can set `updatesEveryFrame = true`. A frame is one queue submit, so work you submit yourself lands in the same submission.
- **Raster bins can cost more than they save.** They are off in our engine by default. They cut draw commands about in half, which wins while the frame waits on command submission. Once the frame is bound by the GPU, their vertex shader (no vertex reuse) costs more than it saves.
- **Experimental.** About eighty commits by one team, tested on Chrome on Windows with our scenes. Expect sharp edges outside them.

## Use it

Clone the `vibe` branch next to your project and alias three to its sources. With Vite:

```js
// vite.config.js
import { fileURLToPath } from 'node:url';

const three = ( file ) => fileURLToPath( new URL( `../three/src/${ file }`, import.meta.url ) );

export default {
	resolve: {
		alias: [
			{ find: /^three$/, replacement: three( 'Three.WebGPU.js' ) },
			{ find: /^three\/webgpu$/, replacement: three( 'Three.WebGPU.js' ) },
			{ find: /^three\/tsl$/, replacement: three( 'Three.TSL.js' ) },
			{ find: /^three\/addons\//, replacement: fileURLToPath( new URL( '../three/examples/jsm/', import.meta.url ) ) },
		],
	},
};
```

Without a bundler, an import map does the same: map `three/webgpu` to `src/Three.WebGPU.js` and `three/tsl` to `src/Three.TSL.js`. That is how [the demo](https://github.com/vibegameengine/three.js/tree/gh-pages) loads it.

Then turn on the opt-in parts:

```js
import * as THREE from 'three/webgpu';

const renderer = new THREE.WebGPURenderer();
await renderer.init();
renderer.gpuScene = new THREE.GpuScene();
const retained = renderer.createRetainedPass();

renderer.setAnimationLoop( () => {
	renderer.renderRetained( scene, camera, retained );
} );
```

## Upstream

This README is the fork's. Upstream's documentation, examples and community are at [threejs.org](https://threejs.org) and in [mrdoob/three.js](https://github.com/mrdoob/three.js). The fork is MIT, like three.js; see [LICENSE](LICENSE).
