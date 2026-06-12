import * as THREE from 'three';

/**
 * Custom chunk shader: per-vertex baked light (skylight & torch light,
 * pre-multiplied by face shade) is combined in the fragment shader as
 * max(torch, sky × dayFactor) — so night dims the world live via a uniform
 * without re-meshing, while torch-lit areas stay bright. Includes linear fog.
 */
export interface ChunkUniforms {
  map: { value: THREE.Texture };
  dayFactor: { value: number };
  fogColor: { value: THREE.Color };
  fogNear: { value: number };
  fogFar: { value: number };
}

const VERT = /* glsl */ `
  attribute vec2 light; // x = sky*shade, y = block*shade (0..1)
  varying vec2 vUv;
  varying vec2 vLight;
  varying float vFogDepth;
  void main() {
    vUv = uv;
    vLight = light;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vFogDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAG = /* glsl */ `
  uniform sampler2D map;
  uniform float dayFactor;
  uniform vec3 fogColor;
  uniform float fogNear;
  uniform float fogFar;
  uniform float alphaCut;
  varying vec2 vUv;
  varying vec2 vLight;
  varying float vFogDepth;
  void main() {
    vec4 tex = texture2D(map, vUv);
    if (tex.a < alphaCut) discard;
    // Torch light is day-independent; skylight follows the sun. Small floor
    // keeps pitch-black areas barely readable.
    float brightness = max(vLight.y, vLight.x * dayFactor);
    brightness = max(brightness, 0.035);
    vec3 color = tex.rgb * brightness;
    float fogAmount = smoothstep(fogNear, fogFar, vFogDepth);
    gl_FragColor = vec4(mix(color, fogColor, fogAmount), tex.a);
  }
`;

export function makeChunkMaterials(atlas: THREE.Texture): {
  opaque: THREE.ShaderMaterial;
  transparent: THREE.ShaderMaterial;
  uniforms: ChunkUniforms;
} {
  const uniforms: ChunkUniforms = {
    map: { value: atlas },
    dayFactor: { value: 1 },
    fogColor: { value: new THREE.Color(0x87ceeb) },
    fogNear: { value: 50 },
    fogFar: { value: 150 },
  };

  const opaque = new THREE.ShaderMaterial({
    uniforms: { ...uniforms, alphaCut: { value: 0.5 } },
    vertexShader: VERT,
    fragmentShader: FRAG,
  });

  const transparent = new THREE.ShaderMaterial({
    uniforms: { ...uniforms, alphaCut: { value: 0.01 } },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  return { opaque, transparent, uniforms };
}
