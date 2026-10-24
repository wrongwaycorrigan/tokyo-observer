import * as THREE from 'three';
import { SHARED } from './shading.js';

export const SKYSCRAPERS = [
  { name: 'Azabudai Hills Mori JP Tower', lat: 35.660851, lon: 139.740659, h: 325, w: 64, d: 64, rot: 64, style: 'tapered', color: '#d8d4cc', note: '325m, Azabudai. Tallest building in Japan.' },
  { name: 'Toranomon Hills Station Tower', lat: 35.66754, lon: 139.746907, h: 266, w: 60, d: 70, rot: 66, color: '#9fb2c8', note: '266m, Toranomon.' },
  { name: 'Midtown Tower', lat: 35.66612, lon: 139.73129, h: 248, w: 58, d: 74, rot: 50, color: '#8ea4bc', note: '248m, Tokyo Midtown, Roppongi.' },
  { name: 'Toranomon Hills Mori Tower', lat: 35.666841, lon: 139.749152, h: 247, w: 65, d: 80, rot: 66, style: 'tapered', color: '#a8b8cc', note: '247m, Toranomon.' },
  { name: 'Tokyo Metropolitan Government Building', lat: 35.689779, lon: 139.691645, h: 243, w: 110, d: 50, rot: 0, style: 'twin', color: '#c8c0b4', note: '243m twin towers, Nishi-Shinjuku. Free observation decks on the 45th floor.' },
  { name: 'Sunshine 60', lat: 35.729516, lon: 139.717955, h: 240, w: 70, d: 40, rot: 0, color: '#c8c4bc', note: '240m, Ikebukuro.' },
  { name: 'NTT Docomo Yoyogi Building', lat: 35.68439, lon: 139.703122, h: 240, w: 40, d: 40, rot: 11, style: 'stepped', spire: 32, color: '#b8b4ac', note: '272m with its spire, Sendagaya. Tokyo’s clock tower skyscraper.' },
  { name: 'Roppongi Hills Mori Tower', lat: 35.660456, lon: 139.729275, h: 238, w: 80, d: 80, rot: 29, color: '#7e94ae', note: '238m, Roppongi Hills. Tokyo City View on the 52nd floor.' },
  { name: 'Shinjuku Park Tower', lat: 35.685225, lon: 139.691021, h: 235, w: 60, d: 45, rot: 56, style: 'stepped', color: '#bdb6ac', note: '235m, Nishi-Shinjuku. Park Hyatt Tokyo on the top floors.' },
  { name: 'Tokyo Opera City Tower', lat: 35.682891, lon: 139.686895, h: 234, w: 55, d: 50, rot: 38, color: '#b0b8c4', note: '234m, Hatsudai.' },
  { name: 'Shibuya Scramble Square', lat: 35.658369, lon: 139.702221, h: 230, w: 60, d: 60, rot: 22, color: '#9cb0c4', note: '230m, Shibuya. SHIBUYA SKY rooftop deck.' },
  { name: 'Tokyu Kabukicho Tower', lat: 35.695873, lon: 139.700635, h: 225, w: 60, d: 45, rot: 74, color: '#a0a8c0', note: '225m, Kabukicho, Shinjuku.' },
  { name: "St. Luke's Tower", lat: 35.666989, lon: 139.778639, h: 220, w: 50, d: 50, rot: 26, color: '#d0ccc4', note: '220m, Akashicho, Chuo.' },
  { name: 'Tokiwabashi Tower', lat: 35.684249, lon: 139.770642, h: 212, w: 70, d: 50, rot: 73, color: '#a8b0bc', note: '212m, Tokyo Torch, Otemachi.' },
  { name: 'The Tower Yokohama Kitanaka', lat: 35.451231, lon: 139.635844, h: 212, w: 48, d: 40, rot: 57, color: '#c0c0c4', note: '212m, Kitanaka, Yokohama.' },
  { name: 'Dentsu Building', lat: 35.664249, lon: 139.762275, h: 210, w: 100, d: 45, rot: 24, color: '#a4b4c8', note: '210m, Shiodome.' },
  { name: 'GranTokyo South Tower', lat: 35.678642, lon: 139.767362, h: 207, w: 70, d: 45, rot: 63, color: '#b4bcc8', note: '207m, Tokyo Station Yaesu side.' },
  { name: 'Proud Tower Tachikawa', lat: 35.69842, lon: 139.41198, h: 128, w: 36, d: 30, rot: 0, color: '#c8c4bc', note: '128m, 32 floors. Tallest building in Tachikawa.' },
  { name: 'Lions Stage Tachikawa Rafina Tower', lat: 35.69663, lon: 139.41875, h: 75, w: 34, d: 28, rot: 0, color: '#b8b4ac', note: '21 floors, south of Tachikawa Station.' },
  { name: 'Mode Gakuen Cocoon Tower', lat: 35.691595, lon: 139.69698, h: 204, w: 45, d: 35, rot: 4, style: 'tapered', color: '#8aa0b8', note: '204m, Nishi-Shinjuku. A vocational school in a cocoon.' },
];

export const LANDMARK_BEACONS = {
  skytree: [[0, 634, 0], [9, 497, 9], [-9, 497, -9]],
  tokyoTower: [[0, 333, 0], [6, 255, -6], [-6, 255, 6]],
  landmarkTower: [[-15, 300, -15], [15, 300, 15], [15, 300, -15], [-15, 300, 15]],
};

const VERTEX = /* glsl */ `
  attribute float aPhase;
  attribute float aPeriod;
  uniform float uTime;
  uniform float uNight;
  varying float vGlow;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float pulse = 0.5 - 0.5 * cos(6.2831853 * (uTime / aPeriod + aPhase));
    pulse = pulse * pulse * (3.0 - 2.0 * pulse);
    vGlow = pulse * mix(0.18, 1.0, uNight);
    float dist = length(mv.xyz);
    gl_PointSize = vGlow > 0.12 ? (dist < 12000.0 ? 3.0 : 2.0) : 0.0;
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAGMENT = /* glsl */ `
  varying float vGlow;
  void main() {
    gl_FragColor = vec4(mix(vec3(0.16, 0.01, 0.02), vec3(1.0, 0.23, 0.16), vGlow), 1.0);
  }
`;

let material = null;

export function makeBeacons(points, seed) {
  material ??= new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: { uTime: SHARED.uTime, uNight: SHARED.uNight },
    transparent: true,
    depthWrite: false,
  });
  const rand = (n) => {
    const x = Math.sin(seed * 127.1 + n * 311.7) * 43758.5453;
    return x - Math.floor(x);
  };
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(points.flat(), 3));
  g.setAttribute('aPhase', new THREE.Float32BufferAttribute(points.map((_, i) => rand(i)), 1));
  g.setAttribute('aPeriod', new THREE.Float32BufferAttribute(points.map((_, i) => 1.8 + rand(i + 50) * 1.4), 1));
  const beacons = new THREE.Points(g, material);
  beacons.frustumCulled = false;
  beacons.renderOrder = 2;
  return beacons;
}
