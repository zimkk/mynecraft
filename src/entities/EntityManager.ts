import * as THREE from 'three';
import { ItemEntity } from './ItemEntity';
import { ItemStack } from '../items/ItemRegistry';
import { Inventory } from '../items/Inventory';
import { ChunkManager } from '../world/ChunkManager';

const PICKUP_RADIUS = 1.5;
const MAX_ITEM_ENTITIES = 200;

/** Owns all non-player entities (dropped items now; mobs in Phase 18). */
export class EntityManager {
  readonly items: ItemEntity[] = [];
  private readonly scene: THREE.Scene;
  private readonly world: ChunkManager;
  private readonly itemMaterial: THREE.MeshLambertMaterial;
  /** Set by the UI to flash pickup feedback. */
  onPickup?: (stack: ItemStack) => void;

  constructor(scene: THREE.Scene, world: ChunkManager, atlas: THREE.Texture) {
    this.scene = scene;
    this.world = world;
    this.itemMaterial = new THREE.MeshLambertMaterial({ map: atlas });
  }

  dropItem(stack: ItemStack, position: THREE.Vector3): ItemEntity {
    if (this.items.length >= MAX_ITEM_ENTITIES) {
      const oldest = this.items.shift()!;
      this.scene.remove(oldest.mesh);
    }
    const entity = new ItemEntity(stack, position, this.itemMaterial);
    this.items.push(entity);
    this.scene.add(entity.mesh);
    return entity;
  }

  update(dt: number, playerFeet: THREE.Vector3, inventory: Inventory): void {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const item = this.items[i];
      item.update(dt, this.world);

      // Pickup: near the player's body center and the inventory has room.
      if (!item.dead && item.pickupDelay === 0) {
        const dx = item.position.x - playerFeet.x;
        const dy = item.position.y - (playerFeet.y + 0.9);
        const dz = item.position.z - playerFeet.z;
        if (dx * dx + dy * dy + dz * dz < PICKUP_RADIUS * PICKUP_RADIUS) {
          const leftover = inventory.add(item.stack);
          if (leftover === 0) {
            item.dead = true;
            this.onPickup?.(item.stack);
          } else {
            item.stack.count = leftover;
          }
        }
      }

      if (item.dead) {
        this.scene.remove(item.mesh);
        item.mesh.geometry.dispose();
        this.items.splice(i, 1);
      }
    }
  }

  get itemCount(): number {
    return this.items.length;
  }
}
