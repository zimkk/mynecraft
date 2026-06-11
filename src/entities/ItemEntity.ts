import * as THREE from 'three';
import { ItemStack, itemDef } from '../items/ItemRegistry';
import { ChunkManager } from '../world/ChunkManager';
import { isSolid, Block } from '../world/BlockRegistry';
import { ATLAS_COLS, ATLAS_ROWS } from '../rendering/TextureAtlas';

const SIZE = 0.28;
const GRAVITY = -22;
const DESPAWN_S = 120;
const FRICTION = 6;

/** Remap a BoxGeometry's UVs so every face samples one atlas tile. */
function tileBoxGeometry(tile: number): THREE.BoxGeometry {
  const geo = new THREE.BoxGeometry(SIZE, SIZE, SIZE);
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
  const tw = 1 / ATLAS_COLS;
  const th = 1 / ATLAS_ROWS;
  const u0 = (tile % ATLAS_COLS) * tw;
  const v0 = 1 - th - Math.floor(tile / ATLAS_COLS) * th;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, u0 + uv.getX(i) * tw, v0 + uv.getY(i) * th);
  }
  return geo;
}

/**
 * A dropped item in the world: falls with gravity, rests on top of blocks,
 * spins and bobs, merges into the player's inventory on contact, and
 * despawns after a timeout.
 */
export class ItemEntity {
  readonly stack: ItemStack;
  readonly mesh: THREE.Mesh;
  readonly position: THREE.Vector3;
  readonly velocity: THREE.Vector3;
  age = 0;
  /** Brief delay before pickup so a just-dropped item doesn't snap back. */
  pickupDelay = 0.5;
  dead = false;

  constructor(stack: ItemStack, position: THREE.Vector3, material: THREE.Material) {
    this.stack = stack;
    this.position = position.clone();
    this.velocity = new THREE.Vector3(
      (Math.random() - 0.5) * 3,
      3 + Math.random() * 2,
      (Math.random() - 0.5) * 3,
    );
    const icon = itemDef(stack.id)?.icon ?? 0;
    this.mesh = new THREE.Mesh(tileBoxGeometry(icon), material);
  }

  update(dt: number, world: ChunkManager): void {
    this.age += dt;
    this.pickupDelay = Math.max(0, this.pickupDelay - dt);
    if (this.age > DESPAWN_S) {
      this.dead = true;
      return;
    }

    this.velocity.y += GRAVITY * dt;
    // Horizontal drag so drops settle instead of sliding forever.
    this.velocity.x -= this.velocity.x * Math.min(1, FRICTION * dt);
    this.velocity.z -= this.velocity.z * Math.min(1, FRICTION * dt);

    const p = this.position;
    p.x += this.velocity.x * dt;
    p.z += this.velocity.z * dt;
    p.y += this.velocity.y * dt;

    // Ground collision: sample the cell the entity center is in; if solid,
    // rest on top of the block below.
    const half = SIZE / 2;
    const blockAt = (y: number) => world.getBlock(Math.floor(p.x), Math.floor(y), Math.floor(p.z));
    const below = blockAt(p.y - half);
    if (isSolid(below) && below !== Block.Water) {
      const top = Math.floor(p.y - half) + 1;
      if (p.y - half < top) {
        p.y = top + half;
        this.velocity.y = 0;
      }
    }
    if (p.y < -16) this.dead = true;

    // Spin + bob.
    this.mesh.rotation.y = this.age * 1.8;
    this.mesh.position.set(p.x, p.y + Math.sin(this.age * 2.5) * 0.04, p.z);
  }
}
