import * as THREE from 'three';
import { Player } from './Player';
import { raycastVoxel, RayHit } from './Raycast';
import { ChunkManager } from '../world/ChunkManager';
import { ChunkStreamer } from '../world/ChunkStreamer';
import { Block, blockDef, isSolid } from '../world/BlockRegistry';
import { Input } from '../core/Input';
import { EntityManager } from '../entities/EntityManager';
import { Inventory } from '../items/Inventory';
import { Hotbar } from '../ui/Hotbar';
import { itemDef, makeStack } from '../items/ItemRegistry';

const REACH = 5.5;
const PLACE_REPEAT_DELAY = 0.24;

/**
 * Targets a block via voxel raycast, draws a wireframe highlight on it, and
 * handles break (LMB) / place (RMB). Breaking spawns a dropped-item entity;
 * placing consumes one item from the selected hotbar stack.
 */
export class BlockInteraction {
  target: RayHit | null = null;
  private readonly highlight: THREE.LineSegments;
  private readonly world: ChunkManager;
  private readonly streamer: ChunkStreamer;
  private readonly player: Player;
  private readonly entities: EntityManager;
  private readonly inventory: Inventory;
  private readonly hotbar: Hotbar;
  private breakCooldown = 0;
  private placeCooldown = 0;

  constructor(
    scene: THREE.Scene,
    world: ChunkManager,
    streamer: ChunkStreamer,
    player: Player,
    entities: EntityManager,
    inventory: Inventory,
    hotbar: Hotbar,
  ) {
    this.world = world;
    this.streamer = streamer;
    this.player = player;
    this.entities = entities;
    this.inventory = inventory;
    this.hotbar = hotbar;

    const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.002, 1.002, 1.002));
    this.highlight = new THREE.LineSegments(
      edges,
      new THREE.LineBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.7 }),
    );
    this.highlight.visible = false;
    scene.add(this.highlight);
  }

  update(dt: number, input: Input): void {
    this.breakCooldown -= dt;
    this.placeCooldown -= dt;

    this.target = raycastVoxel(this.world, this.player.eyePosition, this.player.lookDirection, REACH);

    if (this.target) {
      this.highlight.visible = true;
      this.highlight.position.set(this.target.x + 0.5, this.target.y + 0.5, this.target.z + 0.5);
    } else {
      this.highlight.visible = false;
    }

    if (!input.isLocked) return;

    // Break (instant for now; hardness/tools arrive in Phase 15).
    if (this.target && input.buttonDown(0) && (input.buttonJustPressed(0) || this.breakCooldown <= 0)) {
      this.breakBlock(this.target);
      this.breakCooldown = PLACE_REPEAT_DELAY;
    }

    // Place into the cell adjacent to the hit face, consuming from the hotbar.
    if (this.target && input.buttonDown(2) && (input.buttonJustPressed(2) || this.placeCooldown <= 0)) {
      this.placeBlock(this.target);
      this.placeCooldown = PLACE_REPEAT_DELAY;
    }
  }

  private breakBlock(target: RayHit): void {
    const def = blockDef(target.id);
    this.streamer.setBlock(target.x, target.y, target.z, Block.Air);
    if (def.drops && itemDef(def.drops)) {
      this.entities.dropItem(
        makeStack(def.drops, 1),
        new THREE.Vector3(target.x + 0.5, target.y + 0.5, target.z + 0.5),
      );
    }
  }

  private placeBlock(target: RayHit): void {
    const stack = this.hotbar.selectedStack;
    if (!stack) return;
    const def = itemDef(stack.id);
    if (!def || def.type !== 'block' || def.blockId === undefined) return;

    const px = target.x + target.nx;
    const py = target.y + target.ny;
    const pz = target.z + target.nz;
    const occupant = this.world.getBlock(px, py, pz);
    if (isSolid(occupant)) return; // can replace air/water only
    if (this.player.intersectsBlock(px, py, pz)) return;

    this.streamer.setBlock(px, py, pz, def.blockId);
    this.inventory.consumeOne(this.hotbar.selected);
  }
}
