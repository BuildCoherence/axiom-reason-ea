"use client";

// The ONLY module that imports `three`: load it only via
// `dynamic(() => import("./graph-island"), { ssr: false })`, or the renderer
// folds into every route's payload.

import {
  useEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  BufferGeometry,
  Color,
  ConeGeometry,
  Float32BufferAttribute,
  Group,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  InstancedMesh,
  LineBasicMaterial,
  LineDashedMaterial,
  LineSegments,
  LinearSRGBColorSpace,
  MOUSE,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Quaternion,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  TOUCH,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Material,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";

import type { GraphEdgeKind } from "@/lib/graph-kind-legend";

import {
  applyGraphOrbitConfig,
  clampGraphPanTarget,
  graphCameraDolly,
  graphCameraLimits,
  graphOrbitConfig,
  graphOrbitKeyCommand,
  GRAPH_INSPECT_LIMITS,
  GRAPH_MAX_FRAME_DT_S,
  type GraphCameraMode,
} from "./graph-camera";
import {
  graphNodeOverlayPosition,
  graphPointerNdc,
  isGraphTap,
  pickGraphNode,
  resolveGraphCanvasTap,
  type GraphCanvasTap,
  type GraphProjectionInputs,
} from "./graph-picking";
import {
  clampGraphDevicePixelRatio,
  graphArcPointAt,
  graphEdgeOpacities,
  graphSceneDrawCalls,
  writeGraphArrowEmphasis,
  GRAPH_DIM_ALPHA,
  GRAPH_EDGE_DIM_FACTOR,
  GRAPH_HIGHLIGHT_OPACITY,
  GRAPH_MAX_DRAW_CALLS,
  GRAPH_NEGATES_DASH_SIZE,
  GRAPH_NEGATES_GAP_SIZE,
  GRAPH_PARTICLES_PER_EDGE,
  type GraphHighlightModel,
  type GraphRgb,
  type GraphSceneColors,
  type GraphSceneModel,
  type GraphSurface,
} from "./graph-scene-model";
import {
  createGraphArrivalGate,
  graphArrivalBurstScale,
  graphArrivalEdgeOpacity,
  graphArrivalTotalMs,
  graphArrivalRevealedCount,
  type GraphArrivalGate,
  type GraphArrivalSkipReason,
} from "./graph-arrival";
import {
  createGraphRenderScheduler,
  type GraphRenderScheduler,
} from "./graph-render-scheduler";
import {
  attachGraphContextLifecycle,
  createGraphContextLifecycle,
  releaseGraphContext,
  type GraphCanvasRung,
} from "./graph-webgl";

export type GraphIslandProps = {
  model: GraphSceneModel;
  highlight: GraphHighlightModel | null;
  colors: GraphSceneColors;
  /** Which surface this scene is drawn on; it decides the edge alphas and
   *  nothing else. Required: a default is how the two last diverged silently. */
  surface: GraphSurface;
  /** Suppresses the idle auto-rotate entirely. */
  reducedMotion: boolean;
  /** Drives the DPR ceiling: 1.5 on mobile, 2 elsewhere. */
  isMobile: boolean;
  /** Names the canvas for assistive technology. */
  ariaLabel: string;
  /** Emitted-node index of the current selection; drives the camera mode and the
   *  overlay label when nothing is hovered. */
  selectedIndex?: number | null;
  /** The hovered/selected node's label; `null` hides the overlay. */
  nodeLabel?: (index: number) => string | null;
  /** A canvas tap resolved against the hit test; a miss clears the selection and
   *  the URL. */
  onCanvasTap?: (tap: GraphCanvasTap) => void;
  onFirstFrame?: () => void;
  onRungChange?: (rung: GraphCanvasRung) => void;
  /** The arrival's band cut-points, from the Graph Manifest; empty or absent
   *  means no arrival. */
  bandCutPoints?: readonly number[];
  /** True when the URL named a selection on arrival: the reveal is skipped. */
  deepLink?: boolean;
  /** Fired once when the arrival is skipped, with the reason. */
  onArrivalSkipped?: (reason: GraphArrivalSkipReason) => void;
  /** The poster beat this canvas to the screen. */
  posterShown?: boolean;

  /** Emitted-node indices matching the live search, or null when the box is
   *  empty; non-matches dim rather than hide. */
  searchMatchIndices?: ReadonlySet<number> | null;
  /** Indices adjacent to the selection (inclusive of it), or null; everything
   *  outside dims. Computed by the caller — the island holds no edge index. */
  egoIndices?: ReadonlySet<number> | null;
  /** Whether this selection moves the camera to the node; the shell sets it on
   *  every selection path. */
  flyToSelection?: boolean;
  /** The wire's edge endpoint columns, for the particle flow: they turn the
   *  highlight's edge indices into the two nodes an edge runs between. */
  wireEdges?: { src: Uint32Array; dst: Uint32Array } | null;
};

/** Framing distance for the normalised (±1) cloud at the field of view below. */
const CAMERA_DISTANCE = 3.2;
const CAMERA_FOV = 50;

/** Fat-line width in CSS pixels for the selection highlight. */
const HIGHLIGHT_LINE_WIDTH = 2.5;

// No derivatives (`fwidth`) and no tone mapping: the visual baselines require
// this scene to rasterise to the same bytes across CI runners.

const NODE_VERTEX_SHADER = /* glsl */ `
  attribute vec3 iOffset;
  attribute vec3 iColor;
  attribute float iSize;
  attribute float iFlags;
  attribute float iIndex;
  attribute float iDim;
  attribute vec2 iRingFrac;

  varying vec2 vQuad;
  varying vec3 vColor;
  varying float vFlags;
  varying float vRadiusPx;
  varying float vReveal;
  varying float vDim;
  varying vec2 vRingFrac;

  uniform vec2 uViewport;
  uniform float uRevealCount;
  uniform float uRevealSoftness;

  void main() {
    vQuad = position.xy * 2.0;
    vColor = iColor;
    vFlags = iFlags;
    vDim = iDim;
    vRingFrac = iRingFrac;

    // Emission orders nodes by rank and bands are INDEX cuts of that order, so
    // "revealed so far" is always a prefix — one uniform, no buffer rewrite.
    vReveal = clamp((uRevealCount - iIndex) / max(uRevealSoftness, 1.0), 0.0, 1.0);
    vec4 mv = modelViewMatrix * vec4(iOffset, 1.0);
    // Never scale to zero: a zero-area quad is degenerate and some drivers treat
    // that as undefined rather than as "draws nothing".
    float radius = iSize * mix(0.45, 1.0, vReveal);
    mv.xy += position.xy * radius * 2.0;

    // Depth of the sphere the fragment shader SHADES, not of the plane it shades
    // it on: the whole disc claims the near pole, one radius nearer than the
    // centre. Only z moves, so the drawn disc stays the one graph-picking
    // reverses. The pole is held to the near plane (a camera inside the sphere
    // has nothing in front of it) and never taken past the centre's own depth,
    // which is what still clips a quad the camera has reached.
    vec4 clip = projectionMatrix * mv;
    vec4 pole = projectionMatrix * vec4(0.0, 0.0, mv.z + radius, 1.0);
    float centreNdcZ = clip.w > 0.0 ? clip.z / clip.w : -1.0;
    float poleNdcZ = pole.w > 0.0 ? pole.z / pole.w : -1.0;
    gl_Position = vec4(
      clip.xy,
      min(centreNdcZ, max(poleNdcZ, -1.0)) * clip.w,
      clip.w
    );

    // Radius in DEVICE PIXELS, so the fragment edge is a constant ~1px band
    // rather than a constant fraction of the radius.
    vec4 edge = projectionMatrix * vec4(mv.x + iSize, mv.y, mv.z, mv.w);
    float ndcRadius = edge.w > 0.0 ? abs(edge.x / edge.w - clip.x / clip.w) : 0.0;
    vRadiusPx = max(ndcRadius * 0.5 * uViewport.x, 1.0);
  }
`;

const NODE_FRAGMENT_SHADER = /* glsl */ `
  precision mediump float;

  varying vec2 vQuad;
  varying vec3 vColor;
  varying float vFlags;
  varying float vRadiusPx;
  varying float vReveal;
  varying float vDim;
  varying vec2 vRingFrac;

  uniform float uRingFlag;
  uniform vec3 uRingAdopt;
  uniform vec3 uRingAcknowledged;
  uniform vec3 uRingReject;

  void main() {
    if (vDim <= 0.001) discard;
    float d = length(vQuad);
    // One pixel of edge at every node size: the band is the pixel-to-radius
    // ratio expressed in quad units.
    float band = clamp(1.0 / vRadiusPx, 0.004, 0.5);
    // Composed with the reveal and the dim BEFORE the discard: depth is written
    // by every fragment that survives it, so a fragment that paints nothing —
    // an unrevealed node mid-arrival — must not survive.
    float alpha = (1.0 - smoothstep(1.0 - band, 1.0, d)) * vReveal * vDim;
    if (alpha <= 0.002) discard;

    // Fixed light vector, no view-dependent term: the visual baselines need this
    // deterministic across rasterisers.
    float z = sqrt(max(1.0 - d * d, 0.0));
    vec3 normal = vec3(vQuad, z);
    vec3 light = normalize(vec3(-0.35, 0.45, 0.82));
    float lambert = clamp(dot(normal, light), 0.0, 1.0);
    // Kept well off zero so the darkest limb still carries its Kind Legend hue.
    float shade = 0.62 + 0.38 * lambert;
    vec3 color = vColor * shade;
    color += vec3(1.0) * pow(lambert, 32.0) * 0.10;

    // Bit 0 only (GLSL ES 1.0 has no integer bitwise ops, hence the modulo): the
    // scene model collapses every ring-worthy wire flag into this one bit.
    if (mod(floor(vFlags + 0.5), 2.0) > 0.5) {
      // The stance ring: Adopt, acknowledged-neutral, Reject, clockwise from
      // the TOP going clockwise.
      float ring = smoothstep(0.74, 0.79, d) * (1.0 - smoothstep(0.88, 0.93, d));
      float angle = atan(vQuad.x, vQuad.y);          // 0 at +Y, grows clockwise
      float turn = angle < 0.0 ? (angle + 6.2831853) / 6.2831853
                               : angle / 6.2831853;
      vec3 ringColor = turn <= vRingFrac.x ? uRingAdopt
                     : turn <= vRingFrac.y ? uRingAcknowledged
                     : uRingReject;
      color = mix(color, ringColor * shade, ring);
    }
    gl_FragColor = vec4(color, alpha);
  }
`;

/** The selection highlight, held separately: it lives as long as one selection,
 *  not as long as the scene model. */
export type GraphIslandHighlight = {
  object: LineSegments | LineSegments2;
  /** Non-null only on the `line-segments-2` path. */
  material: LineMaterial | null;
  disposables: { dispose: () => void }[];
};

/** The arrowheads' per-instance alpha channel. One `InstancedMesh` carries one
 *  scalar material opacity and instancing offers no per-instance alpha, so a
 *  selection that brightens SOME arrowheads has to ride an instanced attribute
 *  the cone program multiplies into its fragment alpha. */
export type GraphArrowEmphasis = {
  /** The attribute's backing store, rewritten in place. */
  values: Float32Array;
  attribute: InstancedBufferAttribute;
  /** Wire edge index per instance, from the scene model. */
  edgeIndices: readonly number[];
  /** The live highlight's edges; `null` when nothing is selected. */
  incident: ReadonlySet<number> | null;
  /** Whether `values` currently carries a lift. The landing hero never does, so
   *  its buffer is never re-uploaded. */
  lifted: boolean;
};

export type GraphIslandScene = {
  renderer: WebGLRenderer;
  scene: Scene;
  camera: PerspectiveCamera;
  root: Group;
  /** SCENE-LIFETIME resources only; the highlight's are held on `highlight`. */
  disposables: { dispose: () => void }[];
  /** MUTABLE: replaced in place by the selection effect; `null` when nothing is
   *  selected or the selection has no incident edges. */
  highlight: GraphIslandHighlight | null;
  nodeMesh: Mesh;
  /** Held so `uViewport` can be refreshed on resize with the renderer's size. */
  nodeMaterial: ShaderMaterial;
  /** Base edge layers with their AT-REST opacity, so a dim restores exactly, and
   *  their `kind`, so a recolour looks the hue up rather than trusting the order
   *  they were pushed in. Excludes the highlight, which stays bright. */
  edgeLayers: {
    line: LineSegments;
    kind: GraphEdgeKind;
    baseOpacity: number;
  }[];
  /** The arrowhead cones, dimmed with their own edge layer. */
  arrowMesh: InstancedMesh | null;
  /** The arrowheads' at-rest opacity, carried like `edgeLayers[].baseOpacity`:
   *  it is the built surface's, not whatever a module constant says. */
  arrowBaseOpacity: number;
  /** MUTABLE: the selection effect writes `incident`, `applyGraphEdgeOpacity`
   *  writes the values. `null` when the layer is empty. */
  arrowEmphasis: GraphArrowEmphasis | null;
  /** Particles flowing along the selected node's incident arcs; rebuilt per
   *  selection, `null` when nothing is selected. */
  particles: {
    points: InstancedMesh;
    /** Per-particle (edgeIndex, phase) so a frame is one matrix rewrite. */
    edgeIndices: Int32Array;
    phases: Float32Array;
    /** Mesh, geometry and material — all three: this set is rebuilt on every
     *  selection, so anything left out leaks per click rather than per page. */
    disposables: { dispose: () => void }[];
  } | null;
};

/** Build the selection highlight, or `null` when there is nothing to draw. */
function buildHighlightObject(
  highlight: GraphHighlightModel | null,
  colors: GraphSceneColors,
  width: number,
  height: number,
): GraphIslandHighlight | null {
  if (!highlight || highlight.segmentCount === 0) return null;

  if (highlight.renderer === "line-segments-2") {
    const geometry = new LineSegmentsGeometry();
    geometry.setPositions(highlight.positions);
    const material = new LineMaterial({
      // The entails hue, not a distinct one: recolouring the incident arcs reads
      // as a different EDGE KIND.
      color: toThreeColor(colors.entails).getHex(),
      linewidth: HIGHLIGHT_LINE_WIDTH,
      transparent: true,
      // Named, not left to three's default: the incident arrowheads are lifted
      // to this same number, and the two drifting apart is the mismatch itself.
      opacity: GRAPH_HIGHLIGHT_OPACITY,
      depthWrite: false,
    });
    material.resolution.set(width, height);
    const line = new LineSegments2(geometry, material);
    line.frustumCulled = false;
    return { object: line, material, disposables: [geometry, material] };
  }

  // Past the fat-line segment cap: same one draw call, ordinary lines.
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new Float32BufferAttribute(highlight.positions, 3),
  );
  const material = new LineBasicMaterial({
    color: toThreeColor(colors.entails),
    depthWrite: false,
  });
  const line = new LineSegments(geometry, material);
  line.frustumCulled = false;
  return { object: line, material: null, disposables: [geometry, material] };
}

function toThreeColor(rgb: readonly [number, number, number]): Color {
  // The renderer's OUTPUT space is linear too, so these values reach the
  // framebuffer unchanged and match the DOM legend swatch.
  return new Color().setRGB(rgb[0], rgb[1], rgb[2], LinearSRGBColorSpace);
}

/** Write a Kind Legend hue onto whatever material an object holds: three types
 *  `material` as `Material | Material[]`, and `Material` declares no `color`. */
function writeMaterialColor(
  material: Material | Material[],
  rgb: GraphRgb,
): void {
  for (const one of Array.isArray(material) ? material : [material]) {
    (one as unknown as { color?: Color }).color?.copy(toThreeColor(rgb));
  }
}

function buildNodeMesh(model: GraphSceneModel, colors: GraphSceneColors): Mesh {
  const geometry = new InstancedBufferGeometry();
  // Corners in [-0.5, 0.5] so the vertex shader's `position.xy * 2.0` lands in
  // [-1, 1] for the disc test.
  geometry.setAttribute(
    "position",
    new Float32BufferAttribute(
      [-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0],
      3,
    ),
  );
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.setAttribute(
    "iOffset",
    new InstancedBufferAttribute(model.nodes.offsets, 3),
  );
  geometry.setAttribute(
    "iColor",
    new InstancedBufferAttribute(model.nodes.colors, 3),
  );
  geometry.setAttribute(
    "iSize",
    new InstancedBufferAttribute(model.nodes.sizes, 1),
  );
  geometry.setAttribute(
    "iFlags",
    new InstancedBufferAttribute(model.nodes.flags, 1),
  );
  // Rewritten in place on selection / search: the array is the scene model's, so
  // a selection never rebuilds the scene.
  geometry.setAttribute(
    "iDim",
    new InstancedBufferAttribute(model.nodes.dims, 1),
  );
  geometry.setAttribute(
    "iRingFrac",
    new InstancedBufferAttribute(model.nodes.ringFractions, 2),
  );
  // The instance's position in the EMITTED order, which is what the arrival's
  // prefix reveal compares against.
  const indices = new Float32Array(model.nodes.count);
  for (let i = 0; i < indices.length; i++) indices[i] = i;
  geometry.setAttribute("iIndex", new InstancedBufferAttribute(indices, 1));
  geometry.instanceCount = model.nodes.count;

  const material = new ShaderMaterial({
    vertexShader: NODE_VERTEX_SHADER,
    fragmentShader: NODE_FRAGMENT_SHADER,
    // `uViewport` carries the DRAWING BUFFER size in device pixels; a stale
    // value fails quietly, so it is refreshed wherever the renderer is resized.
    uniforms: {
      uRingFlag: { value: 1 },
      uRingAdopt: { value: toThreeColor(colors.settled) },
      uRingAcknowledged: { value: toThreeColor(colors.proposition) },
      uRingReject: { value: toThreeColor(colors["false-proposition"]) },
      uViewport: { value: new Vector2(1, 1) },
      // Default to everything revealed: a default of 0 blanks the canvas on
      // every rung that skips the arrival.
      uRevealCount: { value: Number.MAX_SAFE_INTEGER },
      uRevealSoftness: { value: 48 },
    },
    transparent: true,
    // Depth IS written: without it far discs draw through near ones and what
    // looks topmost is not what the hit test picks.
    depthWrite: true,
  });

  const mesh = new Mesh(geometry, material);
  // Instanced geometry's bounding sphere describes the UNIT QUAD, not the cloud,
  // so three would cull the entire mesh once the origin left the frustum.
  mesh.frustumCulled = false;
  return mesh;
}

function buildEdgeLines(
  layer: GraphSceneModel["entails"],
  color: Color,
  opacity: number,
  dashed: boolean,
): LineSegments | null {
  if (layer.segmentCount === 0) return null;
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new Float32BufferAttribute(layer.positions, 3),
  );
  if (dashed) {
    // `lineDistance` comes from the scene model, NOT three's
    // `computeLineDistances()`, which restarts the distance per segment pair and
    // renders an arc of short chords solid.
    geometry.setAttribute(
      "lineDistance",
      new Float32BufferAttribute(layer.distances, 1),
    );
  }
  const material = dashed
    ? new LineDashedMaterial({
        color,
        transparent: true,
        opacity,
        depthWrite: false,
        dashSize: GRAPH_NEGATES_DASH_SIZE,
        gapSize: GRAPH_NEGATES_GAP_SIZE,
      })
    : new LineBasicMaterial({
        color,
        transparent: true,
        opacity,
        depthWrite: false,
      });
  return new LineSegments(geometry, material);
}

// `attribute` and `varying` survive verbatim: three's WebGL2 prefix defines them
// as `in`/`out`, and `gl_FragColor` as its own output.
const ARROW_VERTEX_PARS = /* glsl */ `
  attribute float iEmphasis;
  varying float vEmphasis;
`;

const ARROW_FRAGMENT_PARS = /* glsl */ `
  varying float vEmphasis;
`;

/** Watched by `test/e2e/graph.spec.ts`, which fails on any `graph-island:`
 *  console line. */
const ARROW_EMPHASIS_MISS_WARNING =
  "graph-island: arrowhead emphasis was not injected";

let arrowEmphasisMissReported = false;

/** Instanced arrowhead cones for the entails layer, plus the per-instance alpha
 *  channel a selection lifts — see `GraphArrowEmphasis`. */
function buildArrowMesh(
  arrows: GraphSceneModel["arrows"],
  color: Color,
  opacity: number,
): { mesh: InstancedMesh; emphasis: GraphArrowEmphasis } | null {
  if (arrows.count === 0) return null;
  const geometry = new ConeGeometry(0.3, 1, 6);
  // ConeGeometry centers on its midpoint with the apex at +0.5; shift so the
  // origin is the BASE center and +Y is the point direction.
  geometry.translate(0, 0.5, 0);
  const emphasisValues = new Float32Array(arrows.count).fill(1);
  const emphasisAttribute = new InstancedBufferAttribute(emphasisValues, 1);
  geometry.setAttribute("iEmphasis", emphasisAttribute);
  // Transparent — the cones carry the entails layer's opacity, and the flag is
  // set at construction because a later flip recompiles the program mid-arrival.
  const material = new MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
  });
  // three's own chunks, patched rather than replaced: a hand-written cone
  // program would fork the depth, blending and colour-space handling this
  // material already gets right.
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>${ARROW_VERTEX_PARS}`)
      .replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\n  vEmphasis = iEmphasis;",
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>${ARROW_FRAGMENT_PARS}`)
      .replace(
        "#include <opaque_fragment>",
        "#include <opaque_fragment>\n  gl_FragColor.a *= vEmphasis;",
      );
    // Backstop for a renamed chunk upstream: `replace` misses silently, and what
    // that looks like on screen is the dim-arrowhead bug back again. NOT
    // dev-gated: `next build` inlines NODE_ENV and would strip the warn out of
    // the very production bundle the e2e gate drives, leaving that gate vacuous.
    // Once per context, so a program recompile cannot spam a real user's console.
    if (
      !arrowEmphasisMissReported &&
      !shader.fragmentShader.includes("gl_FragColor.a *= vEmphasis;")
    ) {
      arrowEmphasisMissReported = true;
      console.warn(ARROW_EMPHASIS_MISS_WARNING);
    }
  };
  const mesh = new InstancedMesh(geometry, material, arrows.count);
  const up = new Vector3(0, 1, 0);
  const dir = new Vector3();
  const q = new Quaternion();
  const m = new Matrix4();
  const pos = new Vector3();
  const scl = new Vector3();
  for (let i = 0; i < arrows.count; i++) {
    dir.set(
      arrows.directions[i * 3],
      arrows.directions[i * 3 + 1],
      arrows.directions[i * 3 + 2],
    );
    q.setFromUnitVectors(up, dir);
    pos.set(
      arrows.positions[i * 3],
      arrows.positions[i * 3 + 1],
      arrows.positions[i * 3 + 2],
    );
    const len = arrows.lengths[i];
    scl.set(len, len, len);
    m.compose(pos, q, scl);
    mesh.setMatrixAt(i, m);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.frustumCulled = false;
  return {
    mesh,
    emphasis: {
      values: emphasisValues,
      attribute: emphasisAttribute,
      edgeIndices: arrows.edgeIndices,
      incident: null,
      lifted: false,
    },
  };
}

/** Build the whole GPU-side scene; exported because the determinism harness must
 *  drive THIS function rather than a reconstruction of it. */
export function createGraphIslandScene(
  canvas: HTMLCanvasElement,
  props: GraphIslandProps,
  width: number,
  height: number,
): GraphIslandScene {
  const renderer = new WebGLRenderer({
    canvas,
    antialias: false, // the disc is analytically anti-aliased; MSAA buys nothing
    alpha: true, // the poster stays visible underneath during the crossfade
    powerPreference: "high-performance",
    // Required for any downstream still capture: without it the drawing buffer
    // is cleared before a read-back can happen.
    preserveDrawingBuffer: true,
  });
  // Linear OUTPUT space: the Kind Legend's colours are already the sRGB values
  // the DOM renders, so any conversion makes the canvas and the swatch disagree.
  renderer.outputColorSpace = LinearSRGBColorSpace;
  renderer.setPixelRatio(
    clampGraphDevicePixelRatio(
      typeof window === "undefined" ? 1 : window.devicePixelRatio,
      props.isMobile,
    ),
  );
  renderer.setSize(width, height, false);

  const scene = new Scene();
  const root = new Group();
  scene.add(root);

  const camera = new PerspectiveCamera(CAMERA_FOV, width / height, 0.01, 100);
  camera.position.set(0, 0, CAMERA_DISTANCE);
  camera.lookAt(0, 0, 0);

  const disposables: { dispose: () => void }[] = [];
  const track = (object: Mesh | LineSegments) => {
    disposables.push(object.geometry);
    if (Array.isArray(object.material)) disposables.push(...object.material);
    else disposables.push(object.material);
  };

  const nodes = buildNodeMesh(props.model, props.colors);
  root.add(nodes);
  track(nodes);
  const nodeMaterial = nodes.material as ShaderMaterial;
  renderer.getDrawingBufferSize(
    nodeMaterial.uniforms.uViewport.value as Vector2,
  );

  const edgeLayers: GraphIslandScene["edgeLayers"] = [];
  const addEdgeLayer = (
    line: LineSegments | null,
    kind: GraphEdgeKind,
    baseOpacity: number,
  ) => {
    if (!line) return;
    root.add(line);
    track(line);
    edgeLayers.push({ line, kind, baseOpacity });
  };

  const opacities = graphEdgeOpacities(props.surface);

  // Entails renders FIRST: furthest back in blend order.
  addEdgeLayer(
    buildEdgeLines(
      props.model.entails,
      toThreeColor(props.colors.entails),
      opacities.entails,
      false,
    ),
    props.model.entails.kind,
    opacities.entails,
  );

  const arrows = buildArrowMesh(
    props.model.arrows,
    toThreeColor(props.colors.entails),
    opacities.arrow,
  );
  if (arrows) {
    root.add(arrows.mesh);
    track(arrows.mesh);
    arrows.emphasis.incident = highlightEdgeSet(props.highlight);
    applyGraphArrowEmphasis({
      arrowMesh: arrows.mesh,
      arrowEmphasis: arrows.emphasis,
    });
  }

  addEdgeLayer(
    buildEdgeLines(
      props.model.negates,
      toThreeColor(props.colors.negates),
      opacities.negates,
      true,
    ),
    props.model.negates.kind,
    opacities.negates,
  );

  // Tracked apart from `disposables`: the component swaps the highlight without
  // touching anything else.
  const highlight = buildHighlightObject(
    props.highlight,
    props.colors,
    width,
    height,
  );
  if (highlight) root.add(highlight.object);

  return {
    renderer,
    scene,
    camera,
    root,
    disposables,
    highlight,
    nodeMesh: nodes,
    nodeMaterial,
    edgeLayers,
    arrowMesh: arrows?.mesh ?? null,
    arrowBaseOpacity: opacities.arrow,
    arrowEmphasis: arrows?.emphasis ?? null,
    particles: null,
  };
}

/** The wire edges a highlight draws, as a set for the arrowhead lookup. */
function highlightEdgeSet(
  highlight: GraphHighlightModel | null,
): ReadonlySet<number> | null {
  return highlight ? new Set(highlight.edgeIndices) : null;
}

/** Re-derive the arrowheads' per-instance lift from the opacity their material
 *  currently carries; the incident set is held on the scene. */
export function applyGraphArrowEmphasis(
  scene: Pick<GraphIslandScene, "arrowMesh" | "arrowEmphasis">,
): void {
  const emphasis = scene.arrowEmphasis;
  if (!emphasis || !scene.arrowMesh) return;
  // Nothing to lift and nothing to clear — the landing hero's every call, so its
  // arrowhead buffer is uploaded once and never again.
  if (!emphasis.incident && !emphasis.lifted) return;
  emphasis.lifted = writeGraphArrowEmphasis(
    emphasis.values,
    emphasis.edgeIndices,
    emphasis.incident,
    (scene.arrowMesh.material as { opacity: number }).opacity,
  );
  emphasis.attribute.needsUpdate = true;
}

/** The ONE writer of every edge layer's opacity, arrowheads included, for both
 *  surfaces that draw this scene; `multiplier` is 0..1 and each layer's at-rest
 *  opacity is held on the scene. */
export function applyGraphEdgeOpacity(
  scene: Pick<
    GraphIslandScene,
    "edgeLayers" | "arrowMesh" | "arrowBaseOpacity" | "arrowEmphasis"
  >,
  multiplier: number,
): void {
  for (const { line, baseOpacity } of scene.edgeLayers) {
    (line.material as { opacity: number }).opacity = baseOpacity * multiplier;
  }
  if (scene.arrowMesh) {
    (scene.arrowMesh.material as { opacity: number }).opacity =
      scene.arrowBaseOpacity * multiplier;
    // The incident lift is a RATIO against the opacity just written, so it is
    // re-derived here rather than held across a dim that invalidates it.
    applyGraphArrowEmphasis(scene);
  }
}

/** A colour-blind fingerprint of a scene model: `buildGraphSceneModel` allocates
 *  fresh arrays every call, so keying a scene build on the model object makes a
 *  theme toggle tear down the WebGL context. Key on this instead. */
export function graphSceneShapeKey(model: GraphSceneModel): string {
  const { center, scale } = model.basis;
  return [
    center[0],
    center[1],
    center[2],
    scale,
    model.nodes.count,
    model.entails.segmentCount,
    model.negates.segmentCount,
    model.arrows.count,
  ].join(":");
}

/** The ONE writer of every colour on a built scene, for both surfaces.
 *  PRECONDITION: `model` differs from the one the scene was built with only in
 *  `nodes.colors` — i.e. `graphSceneShapeKey` agrees. */
export function applyGraphSceneColors(
  scene: Pick<
    GraphIslandScene,
    "nodeMesh" | "nodeMaterial" | "edgeLayers" | "arrowMesh" | "highlight"
  >,
  model: GraphSceneModel,
  colors: GraphSceneColors,
): void {
  // Copy INTO the live attribute: re-pointing would mean a new
  // `InstancedBufferAttribute`, and three keeps the uploaded predecessor until
  // the geometry is disposed.
  const iColor = scene.nodeMesh.geometry.getAttribute("iColor");
  (iColor.array as Float32Array).set(model.nodes.colors);
  iColor.needsUpdate = true;

  // Mutated in place: the uniform holds the `Color` itself.
  (scene.nodeMaterial.uniforms.uRingAdopt.value as Color).copy(
    toThreeColor(colors.settled),
  );
  (scene.nodeMaterial.uniforms.uRingAcknowledged.value as Color).copy(
    toThreeColor(colors.proposition),
  );
  (scene.nodeMaterial.uniforms.uRingReject.value as Color).copy(
    toThreeColor(colors["false-proposition"]),
  );

  for (const { line, kind } of scene.edgeLayers) {
    writeMaterialColor(line.material, colors[kind]);
  }
  if (scene.arrowMesh) {
    writeMaterialColor(scene.arrowMesh.material, colors.entails);
  }
  if (scene.highlight) {
    // The same row `buildHighlightObject` used, or a theme switch repaints the
    // selection as a different edge kind.
    writeMaterialColor(scene.highlight.object.material, colors.entails);
  }
}

/** Particle speed, as a fraction of an arc per second. */
const GRAPH_PARTICLE_SPEED = 0.35;
/** Sphere radius in normalised world units; well under a node's, or a bead
 *  travelling past one reads as a second node. */
const GRAPH_PARTICLE_RADIUS = 0.00175;
/** Camera tween duration for a selection. */
const GRAPH_FLY_MS = 900;
/** Breathing room around the ego sphere. */
const GRAPH_FLY_MARGIN = 1.18;
/** Floor on the framed radius: an isolated node's ego sphere has zero radius,
 *  which would fly the camera into it. */
const GRAPH_FLY_MIN_RADIUS = 0.03;
/** Clear air in CSS pixels between the hovered disc — ring included — and its
 *  label. Added to the node's MEASURED screen radius, never used alone. */
const GRAPH_LABEL_GAP_PX = 6;

/** Write the emphasis channel: either input dims, and a node outside both dims
 *  once — `GRAPH_DIM_ALPHA` is a floor, so the channels compose as OR, not as a
 *  product. */
export function writeGraphDims(
  dims: Float32Array,
  searchMatches: ReadonlySet<number> | null | undefined,
  ego: ReadonlySet<number> | null | undefined,
): void {
  for (let i = 0; i < dims.length; i++) {
    const dimmedBySearch = !!searchMatches && !searchMatches.has(i);
    const dimmedByEgo = !!ego && !ego.has(i);
    dims[i] = dimmedBySearch || dimmedByEgo ? GRAPH_DIM_ALPHA : 1;
  }
}

/** The island. The GPU-side scene is built in ONE effect keyed on the scene
 *  model alone: `props.highlight` must never be a dependency of it, or every
 *  selection drops and re-creates the WebGL context, which browsers cap at
 *  ~16 live. */
export default function GraphIsland(props: GraphIslandProps) {
  // THE HOST, NOT THE CANVAS: the scene effect creates its own `<canvas>` here
  // and removes it on cleanup. A canvas whose context was dropped with
  // `WEBGL_lose_context` hands that dead context back to the next
  // `getContext()`, and three then throws during construction.
  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const schedulerRef = useRef<GraphRenderScheduler | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  /** The live scene, for the effects that mutate it without owning it. */
  const objectsRef = useRef<GraphIslandScene | null>(null);
  /** The highlight model the CURRENT scene was built with, so the selection
   *  effect does not rebuild the one the builder already applied. */
  const highlightAppliedRef = useRef<GraphHighlightModel | null>(null);
  /** Held as a ref because it closes over the current scene's objects. */
  const applyCameraModeRef = useRef<(() => void) | null>(null);
  /** The ONE writer of every edge layer's opacity: the arrival's fade and the
   *  ego dim multiply into one number, and they are driven from different places
   *  (the render loop and the emphasis effect), so neither may write directly. */
  const applyEdgeOpacityRef = useRef<((emphasising: boolean) => void) | null>(
    null,
  );
  /** A ref, not a closure: an input event can land before the scene effect
   *  finishes, which a direct closure would answer with a TDZ throw. */
  const skipArrivalRef = useRef<(() => void) | null>(null);
  /** Called by the highlight effect: the flow follows the selection's arcs. */
  const rebuildParticlesRef = useRef<(() => void) | null>(null);
  // The camera survives scene rebuilds: stashed on teardown, restored on the
  // next build, because a theme change rebuilds the scene model.
  const cameraStateRef = useRef<{ position: Vector3; target: Vector3 } | null>(
    null,
  );
  /** Visit-scoped, not scene-scoped: a theme toggle rebuilds the scene, and
   *  neither a spent arrival nor a dismissed drift may come back with it. */
  const arrivalGateRef = useRef<GraphArrivalGate | null>(null);
  const autoRotateDismissedRef = useRef(false);
  // Props the render loop reads without wanting to rebuild the scene.
  const latest = useRef(props);
  latest.current = props;

  useEffect(() => {
    const host = canvasHostRef.current;
    const wrapper = wrapperRef.current;
    if (!host || !wrapper) return;

    // Fresh element, this build only — see `canvasHostRef`.
    const canvas = document.createElement("canvas");
    canvas.className = "block h-full w-full";
    host.appendChild(canvas);

    const width = Math.max(1, wrapper.clientWidth);
    const height = Math.max(1, wrapper.clientHeight);
    // Re-assert the emphasis channel BEFORE the buffer is uploaded:
    // `buildGraphSceneModel` hands back `dims` filled with 1.0, and the emphasis
    // effect below does not re-run for a model change.
    writeGraphDims(
      latest.current.model.nodes.dims,
      latest.current.searchMatchIndices,
      latest.current.egoIndices,
    );
    const objects = createGraphIslandScene(
      canvas,
      latest.current,
      width,
      height,
    );
    objectsRef.current = objects;
    // The builder already applied the current highlight; record WHICH one, so
    // the selection effect does not rebuild an identical object.
    highlightAppliedRef.current = latest.current.highlight;

    const drawCalls = graphSceneDrawCalls(
      latest.current.model,
      latest.current.highlight,
    );
    if (
      process.env.NODE_ENV !== "production" &&
      drawCalls.length > GRAPH_MAX_DRAW_CALLS
    ) {
      // Backstop for an object added HERE without a draw-call plan entry; an
      // object built later (the particles) is invisible to a check that runs
      // once at scene build, so the plan must describe it.
      console.warn(
        `graph-island: ${drawCalls.length} draw calls, budget ${GRAPH_MAX_DRAW_CALLS}`,
      );
    }

    let firstFrameSent = false;
    let lastAutoRotateMs = 0;

    // The controls' DOM element is the canvas, not the wrapper: three sets
    // `touch-action: none` on whatever it is given, and the wrapper also owns
    // the keyboard and the overlay label.
    const controls = new OrbitControls(objects.camera, canvas);
    controlsRef.current = controls;
    // Captured BEFORE any restore, so the reset key returns to the arrival
    // framing rather than to wherever the last selection left things.
    controls.saveState();

    const saved = cameraStateRef.current;
    if (saved) {
      objects.camera.position.copy(saved.position);
      controls.target.copy(saved.target);
    }

    /** The camera flight: it asks for its OWN next frame while it runs and stops
     *  asking when it lands, so the idle frame budget is unchanged. */
    let flight: {
      fromPos: Vector3;
      toPos: Vector3;
      fromTarget: Vector3;
      toTarget: Vector3;
      startedAt: number;
    } | null = null;
    const startCameraFlight = (target: Vector3, destination: Vector3) => {
      if (latest.current.reducedMotion) {
        objects.camera.position.copy(destination);
        controls.target.copy(target);
        controls.update();
        schedulerRef.current?.invalidate();
        return;
      }
      flight = {
        fromPos: objects.camera.position.clone(),
        toPos: destination,
        fromTarget: controls.target.clone(),
        toTarget: target,
        startedAt: performance.now(),
      };
      schedulerRef.current?.invalidate();
    };
    /** Advances the flight; returns true while it still needs frames. */
    const stepCameraFlight = (now: number): boolean => {
      if (!flight) return false;
      const t = Math.min(1, (now - flight.startedAt) / GRAPH_FLY_MS);
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      objects.camera.position.lerpVectors(flight.fromPos, flight.toPos, e);
      controls.target.lerpVectors(flight.fromTarget, flight.toTarget, e);
      controls.update();
      if (t >= 1) {
        flight = null;
        return false;
      }
      return true;
    };
    /** Cancels the flight: the visitor's input wins over an animation. */
    const cancelCameraFlight = () => {
      flight = null;
    };

    /** Globe before a selection, Inspect after. */
    const applyCameraMode = () => {
      const selected = latest.current.selectedIndex ?? null;
      const mode: GraphCameraMode = selected === null ? "globe" : "inspect";
      applyGraphOrbitConfig(
        controls,
        graphOrbitConfig({
          mode,
          reducedMotion: latest.current.reducedMotion,
          // Carried across the rebuild that created THESE controls, or a theme
          // toggle hands a visitor who dragged the globe `autoRotate` back on.
          autoRotateDismissed: autoRotateDismissedRef.current,
        }),
        TOUCH,
      );
      // A selection ends the drift on the SCHEDULER too, and on the mount:
      // `controls.autoRotate = false` stops the camera but not the scheduler's
      // drift window, and a selection made outside the canvas (search hit, panel
      // pivot, back/forward) reaches `noteInteraction` no other way.
      if (mode === "inspect") {
        autoRotateDismissedRef.current = true;
        schedulerRef.current?.noteInteraction();
      }
      // The target is TWEENED to a selection, never snapped: an instant recentre
      // moves the graph under the pointer, so the next click lands on the node
      // just selected instead of the one aimed at.
      if (selected === null) controls.target.set(0, 0, 0);
      // Applies the new clamp to the current distance, among other things.
      controls.update();

      if (
        selected !== null &&
        latest.current.flyToSelection &&
        selected < latest.current.model.nodes.count
      ) {
        const offsets = latest.current.model.nodes.offsets;
        const node = new Vector3(
          offsets[selected * 3],
          offsets[selected * 3 + 1],
          offsets[selected * 3 + 2],
        );

        // Frame the ego set's bounding sphere, not the node: half the vertical
        // FOV subtends the radius, and the horizontal FOV is the binding one on
        // a wide viewport, hence the aspect term.
        const ego = latest.current.egoIndices;
        const centre = node.clone();
        let radius = 0;
        if (ego && ego.size > 1) {
          centre.set(0, 0, 0);
          for (const i of ego) {
            centre.x += offsets[i * 3];
            centre.y += offsets[i * 3 + 1];
            centre.z += offsets[i * 3 + 2];
          }
          centre.divideScalar(ego.size);
          for (const i of ego) {
            const dx = offsets[i * 3] - centre.x;
            const dy = offsets[i * 3 + 1] - centre.y;
            const dz = offsets[i * 3 + 2] - centre.z;
            radius = Math.max(radius, Math.hypot(dx, dy, dz));
          }
        }
        // Include the node's own disc so a lone node is not a zero-radius sphere.
        radius = Math.max(
          radius + latest.current.model.nodes.sizes[selected] * 2,
          GRAPH_FLY_MIN_RADIUS,
        );
        const vFov = (CAMERA_FOV * Math.PI) / 180;
        const aspect = objects.camera.aspect || 1;
        const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
        const fit = radius / Math.tan(Math.min(vFov, hFov) / 2);
        const distance = Math.min(
          Math.max(fit * GRAPH_FLY_MARGIN, GRAPH_INSPECT_LIMITS.minDistance),
          GRAPH_INSPECT_LIMITS.maxDistance,
        );

        // Approach along the ray from the ORIGIN through the centre, so the
        // camera ends outside the cloud looking in; falls back to the current
        // view direction when the centre is on the origin and that ray is
        // undefined.
        const outward = centre.clone();
        if (outward.lengthSq() < 1e-8) {
          outward.copy(objects.camera.position).sub(controls.target);
        }
        outward.normalize();
        const destination = centre
          .clone()
          .add(outward.multiplyScalar(distance));
        startCameraFlight(centre, destination);
      }
    };
    applyCameraMode();
    applyCameraModeRef.current = applyCameraMode;

    /** The visitor took the camera: auto-rotate is over on the scheduler, on the
     *  controls (which would otherwise slip one rotation step into the next
     *  `update()`), and on the MOUNT, the only one that survives a rebuild. */
    const takeControl = () => {
      autoRotateDismissedRef.current = true;
      controls.autoRotate = false;
      cancelCameraFlight();
      skipArrivalRef.current?.();
      schedulerRef.current?.noteInteraction();
    };
    // Explicit rather than three's defaults, which bind pan to the MIDDLE button
    // and leave right-drag as the browser context menu.
    controls.mouseButtons = {
      LEFT: MOUSE.ROTATE,
      MIDDLE: MOUSE.DOLLY,
      RIGHT: MOUSE.PAN,
    };
    // …and the context menu must not fire on the gesture that now pans.
    const suppressContextMenu = (event: Event) => event.preventDefault();
    canvas.addEventListener("contextmenu", suppressContextMenu);

    controls.addEventListener("start", takeControl);
    controls.addEventListener("change", () => {
      // Applied on every controls change rather than only on pan — see
      // `clampGraphPanTarget`.
      const clamped = clampGraphPanTarget(
        controls.target.x,
        controls.target.y,
        controls.target.z,
      );
      if (
        clamped.x !== controls.target.x ||
        clamped.y !== controls.target.y ||
        clamped.z !== controls.target.z
      ) {
        controls.target.set(clamped.x, clamped.y, clamped.z);
      }
      schedulerRef.current?.invalidate();
    });

    const modelView = new Matrix4();
    const projectionInputs = (): GraphProjectionInputs => {
      // Refreshed rather than trusted: a pointer event can arrive between a
      // camera change and the frame that would have updated the matrices.
      objects.camera.updateMatrixWorld();
      objects.root.updateMatrixWorld();
      modelView.multiplyMatrices(
        objects.camera.matrixWorldInverse,
        objects.root.matrixWorld,
      );
      return {
        nodes: latest.current.model.nodes,
        modelView: modelView.elements,
        projection: objects.camera.projectionMatrix.elements,
        viewport: {
          width: Math.max(1, wrapper.clientWidth),
          height: Math.max(1, wrapper.clientHeight),
        },
      };
    };

    // Scoped to the SELECTION's incident arcs and nowhere else: over the whole
    // graph this is a permanent animation over thousands of edges, which is the
    // render-on-demand budget gone.
    let particleStart = 0;
    const particleMatrix = new Matrix4();
    const disposeParticles = () => {
      const existing = objects.particles;
      if (!existing) return;
      objects.root.remove(existing.points);
      for (const d of existing.disposables) d.dispose();
      objects.particles = null;
    };
    const buildParticles = () => {
      disposeParticles();
      const highlight = latest.current.highlight;
      if (!highlight || latest.current.reducedMotion) {
        wrapper.dataset.graphParticles = !highlight
          ? "no-highlight"
          : "reduced-motion";
        return;
      }
      const edges = highlight.edgeIndices;
      if (edges.length === 0) {
        wrapper.dataset.graphParticles = "no-edges";
        return;
      }
      const count = edges.length * GRAPH_PARTICLES_PER_EDGE;
      const edgeIndices = new Int32Array(count);
      const phases = new Float32Array(count);
      for (let e = 0; e < edges.length; e++) {
        for (let p = 0; p < GRAPH_PARTICLES_PER_EDGE; p++) {
          const i = e * GRAPH_PARTICLES_PER_EDGE + p;
          edgeIndices[i] = edges[e];
          phases[i] = p / GRAPH_PARTICLES_PER_EDGE;
        }
      }
      // Instanced spheres, not `THREE.Points` (`gl_PointSize` is clamped by the
      // rasteriser, the same reason nodes are instanced quads) and never red:
      // red is NEGATION on this canvas.
      const geometry = new SphereGeometry(GRAPH_PARTICLE_RADIUS, 8, 6);
      const material = new MeshBasicMaterial({
        color: toThreeColor(latest.current.colors.proof),
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
      });
      const points = new InstancedMesh(geometry, material, count);
      points.frustumCulled = false;
      points.renderOrder = 10;
      objects.root.add(points);
      objects.particles = {
        points,
        edgeIndices,
        phases,
        disposables: [geometry, material, points],
      };
      particleStart = performance.now();
      // A test seam: without it "no visible flow" cannot be told from "built
      // nothing" or "built but not stepping".
      wrapper.dataset.graphParticles = String(count);
    };
    rebuildParticlesRef.current = buildParticles;

    /** Advances the flow; returns true while it still needs frames. */
    const stepParticles = (now: number): boolean => {
      const state = objects.particles;
      if (!state) return false;
      const scene = latest.current.model;
      const wire = latest.current.wireEdges;
      if (!wire) {
        wrapper.dataset.graphParticles = "no-wire";
        return false;
      }
      const t = ((now - particleStart) / 1000) * GRAPH_PARTICLE_SPEED;
      const offsets = scene.nodes.offsets;
      for (let i = 0; i < state.edgeIndices.length; i++) {
        const e = state.edgeIndices[i];
        const s = wire.src[e];
        const d = wire.dst[e];
        if (s === undefined || d === undefined) continue;
        // Along THE DRAWN ARC — the same curve the edge layer samples, so a
        // particle never leaves its own line.
        const at = (t + state.phases[i]) % 1;
        const p = graphArcPointAt(
          offsets[s * 3],
          offsets[s * 3 + 1],
          offsets[s * 3 + 2],
          offsets[d * 3],
          offsets[d * 3 + 1],
          offsets[d * 3 + 2],
          at,
        );
        particleMatrix.makeTranslation(p[0], p[1], p[2]);
        state.points.setMatrixAt(i, particleMatrix);
      }
      state.points.instanceMatrix.needsUpdate = true;
      wrapper.dataset.graphParticleT = t.toFixed(2);
      return true;
    };

    buildParticles();

    // Positioned by PICKING'S OWN projection, so the label cannot name a node
    // other than the one a click at that point resolves to. `aria-hidden`: a
    // pointer-following tooltip is not a surface a screen-reader user can drive
    // — the HUD's search box is.
    let hoveredIndex: number | null = null;
    const drawOverlayLabel = () => {
      const overlay = overlayRef.current;
      if (!overlay) return;
      const index = hoveredIndex ?? latest.current.selectedIndex ?? null;
      const text =
        index === null ? null : (latest.current.nodeLabel?.(index) ?? null);
      const position =
        index === null || !text
          ? null
          : graphNodeOverlayPosition(projectionInputs(), index);
      if (!position) {
        overlay.hidden = true;
        return;
      }
      overlay.hidden = false;
      overlay.textContent = text;
      // The percentages resolve against the LABEL's own box, so it centres on
      // the node at any text length or font size. Lifted by the MEASURED screen
      // radius plus the gap — `topPx` is the node's CENTRE, so a flat lift would
      // cover the disc and the adoption ring painted around its edge.
      const liftPx = position.radiusPx + GRAPH_LABEL_GAP_PX;
      overlay.style.transform = `translate3d(calc(${position.leftPx}px - 50%), calc(${position.topPx}px - 100% - ${liftPx.toFixed(1)}px), 0)`;
    };

    // The burst scales `objects.root`, the group every layer hangs off: edge
    // geometry is CPU-built world positions, so only a transform on their shared
    // parent moves nodes and arcs together.
    const restoreRootScale = () => objects.root.scale.setScalar(1);

    // Through the gate, which is SPENT by the first build of this mount: every
    // build after it gets an empty plan and renders settled on frame one.
    const arrivalGate = (arrivalGateRef.current ??= createGraphArrivalGate());
    const arrival = arrivalGate.open({
      deepLink: !!latest.current.deepLink,
      reducedMotion: latest.current.reducedMotion,
      canvasLive: true,
      // Read at scene-build time, not captured at mount: the shell's answer
      // changes while the geometry is still in flight.
      posterShown: !!latest.current.posterShown,
      bandCutPoints: latest.current.bandCutPoints ?? [],
      nodeCount: latest.current.model.nodes.count,
    });
    const arrivalSteps = arrival.steps;
    // TOTAL, not the node timeline: the edges finish last, and an arrival that
    // ended with the node reveal would freeze them half-faded.
    const arrivalDurationMs = graphArrivalTotalMs(arrivalSteps);

    // Starts at 0 ONLY when there is an arrival to play; otherwise the edges
    // must be fully drawn from the first frame.
    let arrivalEdgeOpacity = arrivalSteps.length === 0 ? 1 : 0;

    /** Write every edge layer's opacity from BOTH inputs, through the shared
     *  writer. */
    const applyEdgeOpacity = (emphasising: boolean) => {
      const emphasis = emphasising ? GRAPH_EDGE_DIM_FACTOR : 1;
      applyGraphEdgeOpacity(objects, emphasis * arrivalEdgeOpacity);
    };
    /** The emphasis half, read from props: the render loop has no argument to
     *  carry it in. */
    const emphasisingNow = () =>
      !!latest.current.egoIndices || !!latest.current.searchMatchIndices;
    applyEdgeOpacityRef.current = applyEdgeOpacity;
    applyEdgeOpacity(emphasisingNow());
    let arrivalStartMs = 0;
    let arrivalDone = arrivalSteps.length === 0;
    if (arrival.skipped !== null) {
      latest.current.onArrivalSkipped?.(arrival.skipped);
    }

    /** Any pointer or key input jumps to the final state. */
    const skipArrival = () => {
      if (arrivalDone) return;
      arrivalDone = true;
      objects.nodeMaterial.uniforms.uRevealCount.value =
        Number.MAX_SAFE_INTEGER;
      arrivalEdgeOpacity = 1;
      applyEdgeOpacity(emphasisingNow());
      restoreRootScale();
      latest.current.onArrivalSkipped?.("input");
      schedulerRef.current?.invalidate();
    };
    skipArrivalRef.current = arrivalDone ? null : skipArrival;

    const render = (timeMs: number) => {
      const scheduler = schedulerRef.current;
      if (!arrivalDone) {
        if (arrivalStartMs === 0) arrivalStartMs = timeMs;
        const elapsed = timeMs - arrivalStartMs;
        objects.nodeMaterial.uniforms.uRevealCount.value =
          graphArrivalRevealedCount(
            arrivalSteps,
            elapsed,
            latest.current.model.nodes.count,
          );
        objects.root.scale.setScalar(
          graphArrivalBurstScale(arrivalSteps, elapsed),
        );
        arrivalEdgeOpacity = graphArrivalEdgeOpacity(arrivalSteps, elapsed);
        applyEdgeOpacity(emphasisingNow());
        if (elapsed >= arrivalDurationMs) {
          arrivalDone = true;
          objects.nodeMaterial.uniforms.uRevealCount.value =
            Number.MAX_SAFE_INTEGER;
          arrivalEdgeOpacity = 1;
          applyEdgeOpacity(emphasisingNow());
          restoreRootScale();
        } else {
          // The arrival asks for its own next frame rather than the scheduler
          // holding a window open, so idle rAF is zero for exactly as long as
          // the sequence and not one frame longer.
          scheduler?.invalidate();
        }
      }
      // The flight and the flow are self-terminating for the same reason: each
      // asks for its own next frame only while it is running.
      let animating = false;
      if (stepCameraFlight(timeMs)) animating = true;
      if (stepParticles(timeMs)) animating = true;
      if (animating) scheduler?.invalidate();

      const rotating = !!scheduler?.isAutoRotating();
      if (rotating) {
        // Advanced by ELAPSED TIME, never frame count, so 60 Hz and 120 Hz
        // panels agree; `update()` is called here and only here, which is what
        // makes idle rAF zero. Clamped because rAF stops on a hidden tab and the
        // first resumed frame would otherwise apply minutes of drift in one step.
        const deltaSec =
          lastAutoRotateMs === 0
            ? 0
            : Math.min(
                GRAPH_MAX_FRAME_DT_S,
                (timeMs - lastAutoRotateMs) / 1000,
              );
        lastAutoRotateMs = timeMs;
        controls.update(deltaSec);
      } else {
        // Take auto-rotate off the controls too, or the next `update()` any
        // other path triggers adds one more step.
        controls.autoRotate = false;
      }
      objects.renderer.render(objects.scene, objects.camera);
      drawOverlayLabel();
      // `data-graph-quiesced` means no frame is queued: nothing TRANSIENT is
      // running. It deliberately EXCLUDES the idle drift, which runs until the
      // visitor takes control — so quiesced does not imply a deterministic
      // raster, and a visual baseline must stop the drift itself
      // (`prefers-reduced-motion: reduce`; `data-graph-rotating` says whether it
      // worked).
      const quiesced = !!scheduler && scheduler.pendingFrames() === 0;
      wrapper.dataset.graphQuiesced = quiesced ? "true" : "false";
      wrapper.dataset.graphRotating = rotating ? "true" : "false";
      if (!firstFrameSent) {
        firstFrameSent = true;
        latest.current.onFirstFrame?.();
      }
    };

    const scheduler = createGraphRenderScheduler({
      render,
      requestFrame: (cb) => window.requestAnimationFrame(cb),
      cancelFrame: (handle) => window.cancelAnimationFrame(handle),
      now: () => performance.now(),
      // A deep link suppresses the drift, and a visitor who already took the
      // camera keeps it: `controls.update(dt)` walks the camera around the
      // target every frame, so a running drift fights the fly-to and the
      // deep-linked node never settles in frame.
      autoRotate:
        !latest.current.reducedMotion &&
        !latest.current.deepLink &&
        !autoRotateDismissedRef.current,
    });
    schedulerRef.current = scheduler;

    const lifecycle = createGraphContextLifecycle({
      reupload: () => {
        // Every GPU object is gone after a restore; the scene model is plain
        // typed arrays, so marking the attributes dirty re-forces the upload.
        objects.root.traverse((object) => {
          const geometry = (object as unknown as { geometry?: BufferGeometry })
            .geometry;
          if (!geometry) return;
          for (const attribute of Object.values(geometry.attributes)) {
            (attribute as { needsUpdate: boolean }).needsUpdate = true;
          }
        });
        scheduler.invalidate();
      },
      onRungChange: (rung) => latest.current.onRungChange?.(rung),
    });
    const detachLifecycle = attachGraphContextLifecycle(canvas, lifecycle);

    const resize = () => {
      const w = Math.max(1, wrapper.clientWidth);
      const h = Math.max(1, wrapper.clientHeight);
      objects.renderer.setPixelRatio(
        clampGraphDevicePixelRatio(
          window.devicePixelRatio,
          latest.current.isMobile,
        ),
      );
      objects.renderer.setSize(w, h, false);
      // Wherever the renderer's size is set, `uViewport` follows.
      objects.renderer.getDrawingBufferSize(
        objects.nodeMaterial.uniforms.uViewport.value as Vector2,
      );
      objects.camera.aspect = w / h;
      objects.camera.updateProjectionMatrix();
      // `LineMaterial` computes fat-line width in clip space from this. Read
      // through `objects.highlight` rather than captured once: the selection
      // effect replaces that slot without rebuilding this closure.
      objects.highlight?.material?.resolution.set(w, h);
      scheduler.invalidate();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(wrapper);

    // NOT `click`: `OrbitControls` captures the pointer for the whole orbit
    // gesture, so every drag also ends in a `click` at the release point.
    let pressed: { id: number; x: number; y: number; timeMs: number } | null =
      null;

    const pick = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect();
      const inputs = projectionInputs();
      // Dimmed nodes are deliberately still targets: dimming is emphasis, not
      // deletion. Anything the shader DISCARDS would need a guard here.
      return pickGraphNode(inputs, graphPointerNdc(clientX, clientY, rect));
    };

    const onPointerDown = (event: PointerEvent) => {
      pressed = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        timeMs: event.timeStamp,
      };
    };

    const onPointerUp = (event: PointerEvent) => {
      const start = pressed;
      pressed = null;
      if (!start || start.id !== event.pointerId) return;
      if (
        !isGraphTap(start, {
          x: event.clientX,
          y: event.clientY,
          timeMs: event.timeStamp,
        })
      ) {
        return;
      }
      // A miss clears the selection and the URL: the drawer cannot do it, since
      // `modal={false}` means vaul renders no overlay to receive the tap.
      latest.current.onCanvasTap?.(
        resolveGraphCanvasTap(
          pick(event.clientX, event.clientY),
          typeof window === "undefined" ? "" : window.location.search,
        ),
      );
    };

    const onPointerMove = (event: PointerEvent) => {
      // Hover is a mouse affordance; on touch the tap is what selects.
      if (event.pointerType !== "mouse" || pressed) return;
      const next = pick(event.clientX, event.clientY)?.index ?? null;
      if (next === hoveredIndex) return;
      hoveredIndex = next;
      scheduler.invalidate();
    };

    const onPointerLeave = () => {
      pressed = null;
      if (hoveredIndex === null) return;
      hoveredIndex = null;
      scheduler.invalidate();
    };

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerleave", onPointerLeave);
    canvas.addEventListener("pointercancel", onPointerLeave);

    scheduler.start();

    return () => {
      // A scene torn down before its first frame never played its arrival, so
      // the gate goes back: React's development double-mount would otherwise
      // spend the visit's one arrival before a pixel of it existed.
      if (!firstFrameSent) arrivalGate.rescind();
      observer.disconnect();
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      canvas.removeEventListener("pointercancel", onPointerLeave);
      canvas.removeEventListener("contextmenu", suppressContextMenu);
      // Hand the camera to the next build: a new Generation or a theme switch
      // rebuilds the scene, and neither may teleport the visitor.
      cameraStateRef.current = {
        position: objects.camera.position.clone(),
        target: controls.target.clone(),
      };
      controls.dispose();
      controlsRef.current = null;
      applyCameraModeRef.current = null;
      applyEdgeOpacityRef.current = null;
      skipArrivalRef.current = null;
      rebuildParticlesRef.current = null;
      // Highlight lifetime, not scene lifetime: released explicitly rather than
      // via `disposables`.
      disposeParticles();
      detachLifecycle();
      scheduler.dispose();
      schedulerRef.current = null;
      for (const disposable of objects.disposables) disposable.dispose();
      // The highlight's resources are NOT in `disposables`.
      for (const disposable of objects.highlight?.disposables ?? []) {
        disposable.dispose();
      }
      objects.highlight = null;
      objectsRef.current = null;
      highlightAppliedRef.current = null;
      // Order matters: `dispose()` frees three's own caches, then the context
      // itself is dropped synchronously rather than waiting for GC.
      releaseGraphContext(objects.renderer.getContext());
      objects.renderer.dispose();
      // The element goes with the context it owned: a canvas that lost its
      // context can never hold one again.
      canvas.remove();
    };
    // The scene model is the ONLY rebuild trigger; `props.highlight` is
    // deliberately absent — see the component's header.
  }, [props.model]);

  // The selection highlight adds and removes ONE object on the existing root: a
  // selection is a change to what is drawn, not to what is drawing.
  useEffect(() => {
    const objects = objectsRef.current;
    // No scene yet (no WebGL, or this render preceded the scene effect on
    // mount); the scene effect applies the current highlight when it builds.
    if (objects === null) return;
    // Already applied by the scene build in this same commit; rebuilding would
    // briefly leave two highlight objects in the draw-call plan.
    if (highlightAppliedRef.current === props.highlight) return;

    const previous = objects.highlight;
    if (previous !== null) {
      objects.root.remove(previous.object);
      for (const disposable of previous.disposables) disposable.dispose();
    }
    const size = objects.renderer.getSize(new Vector2());
    const next = buildHighlightObject(
      props.highlight,
      props.colors,
      Math.max(1, size.x),
      Math.max(1, size.y),
    );
    if (next !== null) objects.root.add(next.object);
    objects.highlight = next;
    highlightAppliedRef.current = props.highlight;
    // The arrowheads on those same arcs follow the highlight, not the base edge
    // layer they are drawn with: one InstancedMesh, so the lift is per-instance.
    if (objects.arrowEmphasis) {
      objects.arrowEmphasis.incident = highlightEdgeSet(props.highlight);
      applyGraphArrowEmphasis(objects);
    }
    // The flow rides the same arcs the highlight draws, so it is rebuilt here
    // and nowhere else.
    rebuildParticlesRef.current?.();
    schedulerRef.current?.invalidate();
  }, [props.highlight, props.colors]);

  // The camera MODE follows the selection, not the highlight: an ISOLATED node
  // produces no highlight layer at all, so keying off the highlight would leave
  // globe mode on for exactly the nodes hardest to find again.
  useEffect(() => {
    applyCameraModeRef.current?.();
    schedulerRef.current?.invalidate();
  }, [props.selectedIndex]);

  // Emphasis: one attribute rewrite, no scene rebuild. Deliberately NOT keyed on
  // `props.model` — a selection or a query must never rebuild the scene.
  useEffect(() => {
    const objects = objectsRef.current;
    if (!objects) return;
    const dims = latest.current.model.nodes.dims;
    writeGraphDims(dims, props.searchMatchIndices, props.egoIndices);
    const attribute = objects.nodeMesh.geometry.getAttribute("iDim");
    attribute.needsUpdate = true;

    // The base edge layers dim as ONE uniform each; the incident arcs are
    // redrawn bright by the highlight on top, so no per-edge attribute is needed.
    const emphasising = !!props.egoIndices || !!props.searchMatchIndices;
    applyEdgeOpacityRef.current?.(emphasising);
    schedulerRef.current?.invalidate();
  }, [props.searchMatchIndices, props.egoIndices]);

  /** The orbit keys `role="application"` promises. Unmapped keys must fall
   *  through without `preventDefault()`, or the element is a keyboard trap;
   *  three's own key handling is unused because its keys PAN. */
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const controls = controlsRef.current;
    if (!controls) return;
    const command = graphOrbitKeyCommand(event);
    if (!command) return;
    event.preventDefault();
    // Ends the drift on the controls, the scheduler and the MOUNT — the last so
    // a later scene rebuild does not hand it back.
    autoRotateDismissedRef.current = true;
    controls.autoRotate = false;
    skipArrivalRef.current?.();
    schedulerRef.current?.noteInteraction();

    switch (command.kind) {
      case "orbit":
        if (command.azimuth !== 0) controls.rotateLeft(command.azimuth);
        if (command.polar !== 0) controls.rotateUp(command.polar);
        break;
      case "dolly": {
        // Through the shared clamp, so the keyboard's reach is exactly the
        // wheel's and the pinch's.
        const offset = new Vector3().subVectors(
          controls.object.position,
          controls.target,
        );
        const distance = graphCameraDolly(
          offset.length(),
          command.direction,
          graphCameraLimits(props.selectedIndex == null ? "globe" : "inspect"),
        );
        controls.object.position
          .copy(controls.target)
          .add(offset.setLength(distance));
        controls.update();
        break;
      }
      case "reset":
        // Back to the arrival framing, then the current mode's target.
        controls.reset();
        applyCameraModeRef.current?.();
        break;
    }
  };

  return (
    // `role="application"` because this element owns the ORBIT KEYS, and it sits
    // INSIDE the WebGL-available branch, so its presence in the DOM is evidence
    // a canvas was created. There is deliberately no keyboard node cursor: the
    // HUD's search results are this page's keyboard route to a node.
    <div
      ref={wrapperRef}
      role="application"
      aria-label={props.ariaLabel}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className="absolute inset-0 h-full w-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div ref={canvasHostRef} className="block h-full w-full" />
      {/* The hovered/selected node's label, positioned imperatively from the
          render loop. */}
      <div
        ref={overlayRef}
        aria-hidden="true"
        hidden
        className="pointer-events-none absolute left-0 top-0 z-10 max-w-[14rem] truncate rounded-md border border-border bg-background/90 px-2 py-1 font-serif text-xs text-foreground shadow-sm"
      />
    </div>
  );
}
