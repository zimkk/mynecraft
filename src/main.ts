import * as THREE from 'three';
import { Game } from './core/Game';

const app = document.getElementById('app')!;
const game = new Game(app);

// Lights
const sun = new THREE.DirectionalLight(0xffffff, 2.0);
sun.position.set(5, 10, 3);
game.scene.add(sun);
game.scene.add(new THREE.AmbientLight(0xffffff, 0.5));

// Phase 1 test cube
const cube = new THREE.Mesh(
  new THREE.BoxGeometry(1, 1, 1),
  new THREE.MeshLambertMaterial({ color: 0x55aa44 }),
);
cube.position.set(0, 1, 0);
game.scene.add(cube);

game.onUpdate((dt) => {
  cube.rotation.y += dt * 0.8;
  cube.rotation.x += dt * 0.3;
});

const fpsEl = document.getElementById('fps')!;
game.onRender(() => {
  fpsEl.textContent = `FPS: ${game.fps}`;
});

game.camera.lookAt(cube.position);
game.start();
