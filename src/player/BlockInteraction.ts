import * as THREE from 'three';
import { Player } from './Player';
import { raycastVoxel, RayHit } from './Raycast';
import { ChunkManager } from '../world/ChunkManager';
import { ChunkStreamer } from '../world/ChunkStreamer';
import { Block, isSolid } from '../world/BlockRegistry';
import { Input } from '../core/Input';

const REACH = 5.5;
const REPEAT_DELAY = 0.24; // seconds between repeated break/place while held

/**
 * Targets a block via voxel raycast, draws a wireframe highlight on it, and
 * handles break (LMB) / place (RMB) with hold-to-repeat.
 */
export class BlockInteraction {
  target: RayHit | null = null;
  private readonly highlight: THREE.LineSegments;
  private readonly world: ChunkManager;
  private readonly streamer: ChunkStreamer;
  private readonly player: Player;
  private breakCooldown = 0;
  private placeCooldown = 0;

  constructor(scene: THREE.Scene, world: ChunkManager, streamer: ChunkStreamer, player: Player) {
    this.world = world;
    this.streamer = streamer;
    this.player = player;

    const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.002, 1.002, 1.002));
    this.highlight = new THREE.LineSegments(
      edges,
      new THREE.LineBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.7 }),
    );
    this.highlight.visible = false;
    scene.add(this.highlight);
  }

  update(dt: number, input: Input, selectedBlock: Block): void {
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

    // Break: instant on click, repeats while held.
    if (this.target && input.buttonDown(0) && (input.buttonJustPressed(0) || this.breakCooldown <= 0)) {
      this.streamer.setBlock(this.target.x, this.target.y, this.target.z, Block.Air);
      this.breakCooldown = REPEAT_DELAY;
    }

    // Place into the cell adjacent to the hit face.
    if (this.target && input.buttonDown(2) && (input.buttonJustPressed(2) || this.placeCooldown <= 0)) {
      const px = this.target.x + this.target.nx;
      const py = this.target.y + this.target.ny;
      const pz = this.target.z + this.target.nz;
      const occupant = this.world.getBlock(px, py, pz);
      const free = !isSolid(occupant); // can replace air/water
      if (free && !this.player.intersectsBlock(px, py, pz)) {
        this.streamer.setBlock(px, py, pz, selectedBlock);
        this.placeCooldown = REPEAT_DELAY;
      }
    }
  }
}
