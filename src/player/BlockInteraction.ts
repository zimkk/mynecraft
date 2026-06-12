import * as THREE from 'three';
import { Player } from './Player';
import { raycastVoxel, RayHit } from './Raycast';
import { ChunkManager } from '../world/ChunkManager';
import { ChunkStreamer } from '../world/ChunkStreamer';
import { Block, Tile, blockDef, isSolid } from '../world/BlockRegistry';
import { ATLAS_COLS, ATLAS_ROWS } from '../rendering/TextureAtlas';
import { Input } from '../core/Input';
import { EntityManager } from '../entities/EntityManager';
import { Inventory } from '../items/Inventory';
import { Hotbar } from '../ui/Hotbar';
import { itemDef, makeStack } from '../items/ItemRegistry';

const REACH = 5.5;
const PLACE_REPEAT_DELAY = 0.24;

/** Box with all faces UV-mapped to one atlas tile (crack overlay stages). */
function crackGeometry(tile: number): THREE.BoxGeometry {
  const geo = new THREE.BoxGeometry(1.01, 1.01, 1.01);
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
 * Block targeting and editing. Breaking takes time based on block hardness,
 * tool class match, tool tier speed, and harvest level (Minecraft rules:
 * right tool ≈ hardness×1.5/speed, wrong tool ≈ hardness×5; insufficient
 * harvest level mines slowly AND drops nothing). A cracking overlay shows
 * progress; tools lose durability per block and break at zero.
 */
export class BlockInteraction {
  target: RayHit | null = null;
  /** Wired from main: creative mode = instant break, no durability/consumption. */
  isCreative: () => boolean = () => false;
  /** Right-clicking an interactive block — return true if handled. */
  onUseBlock?: (id: Block, x: number, y: number, z: number) => boolean;
  /** Feedback hooks (sound/particles in Phase 19). */
  onBlockBroken?: (id: Block, x: number, y: number, z: number) => void;
  onToolBroke?: () => void;

  private readonly highlight: THREE.LineSegments;
  private readonly crackMesh: THREE.Mesh;
  private readonly crackGeos: THREE.BoxGeometry[];
  private readonly world: ChunkManager;
  private readonly streamer: ChunkStreamer;
  private readonly player: Player;
  private readonly entities: EntityManager;
  private readonly inventory: Inventory;
  private readonly hotbar: Hotbar;
  private placeCooldown = 0;
  private creativeBreakCooldown = 0;
  private breakProgress = 0;
  private breakKey: string | null = null;

  constructor(
    scene: THREE.Scene,
    world: ChunkManager,
    streamer: ChunkStreamer,
    player: Player,
    entities: EntityManager,
    inventory: Inventory,
    hotbar: Hotbar,
    atlas: THREE.Texture,
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

    this.crackGeos = [0, 1, 2, 3].map((s) => crackGeometry(Tile.CrackBase + s));
    this.crackMesh = new THREE.Mesh(
      this.crackGeos[0],
      new THREE.MeshBasicMaterial({
        map: atlas,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
      }),
    );
    this.crackMesh.visible = false;
    scene.add(this.crackMesh);
  }

  update(dt: number, input: Input): void {
    this.placeCooldown -= dt;
    this.creativeBreakCooldown -= dt;

    this.target = raycastVoxel(this.world, this.player.eyePosition, this.player.lookDirection, REACH);

    if (this.target) {
      this.highlight.visible = true;
      this.highlight.position.set(this.target.x + 0.5, this.target.y + 0.5, this.target.z + 0.5);
    } else {
      this.highlight.visible = false;
    }

    if (!input.isLocked) {
      this.resetBreaking();
      return;
    }

    // ---- Breaking ----
    if (this.target && input.buttonDown(0)) {
      if (this.isCreative()) {
        if (input.buttonJustPressed(0) || this.creativeBreakCooldown <= 0) {
          this.streamer.setBlock(this.target.x, this.target.y, this.target.z, Block.Air);
          this.onBlockBroken?.(this.target.id, this.target.x, this.target.y, this.target.z);
          this.creativeBreakCooldown = PLACE_REPEAT_DELAY;
        }
        this.resetBreaking();
      } else {
        this.mineTick(dt, this.target);
      }
    } else {
      this.resetBreaking();
    }

    // ---- Right click: use interactive blocks first; otherwise place ----
    if (this.target && input.buttonDown(2) && (input.buttonJustPressed(2) || this.placeCooldown <= 0)) {
      const used =
        input.buttonJustPressed(2) &&
        this.onUseBlock?.(this.target.id, this.target.x, this.target.y, this.target.z);
      if (!used) this.placeBlock(this.target);
      this.placeCooldown = PLACE_REPEAT_DELAY;
    }
  }

  /** One frame of survival mining on the targeted block. */
  private mineTick(dt: number, target: RayHit): void {
    const key = `${target.x},${target.y},${target.z}`;
    if (key !== this.breakKey) {
      this.breakKey = key;
      this.breakProgress = 0;
    }

    const def = blockDef(target.id);
    const held = this.hotbar.selectedStack;
    const tool = held ? itemDef(held.id)?.tool : undefined;
    const classMatch = def.toolClass !== undefined && tool?.class === def.toolClass;
    const speed = classMatch && tool ? tool.speed : 1;
    const canHarvest =
      !def.requiresTool || (classMatch && (tool?.harvestLevel ?? -1) >= def.minHarvest);

    const baseTime = Math.max(0.05, def.hardness * (canHarvest ? 1.5 : 5));
    this.breakProgress += (dt * speed) / baseTime;

    // Crack overlay.
    const stage = Math.min(3, Math.floor(this.breakProgress * 4));
    this.crackMesh.visible = this.breakProgress > 0.02;
    this.crackMesh.geometry = this.crackGeos[stage];
    this.crackMesh.position.set(target.x + 0.5, target.y + 0.5, target.z + 0.5);

    if (this.breakProgress >= 1) {
      this.finishBreak(target, canHarvest, held !== null && tool !== undefined);
    }
  }

  private finishBreak(target: RayHit, canHarvest: boolean, usedTool: boolean): void {
    const def = blockDef(target.id);
    this.streamer.setBlock(target.x, target.y, target.z, Block.Air);
    this.onBlockBroken?.(target.id, target.x, target.y, target.z);

    if (canHarvest && def.drops && itemDef(def.drops)) {
      this.entities.dropItem(
        makeStack(def.drops, 1),
        new THREE.Vector3(target.x + 0.5, target.y + 0.5, target.z + 0.5),
      );
    }
    if (canHarvest && def.randomDrop && Math.random() < def.randomDrop.chance && itemDef(def.randomDrop.id)) {
      this.entities.dropItem(
        makeStack(def.randomDrop.id, 1),
        new THREE.Vector3(target.x + 0.5, target.y + 0.5, target.z + 0.5),
      );
    }

    // Durability: one point per block (only blocks with real hardness).
    if (usedTool && def.hardness > 0.05) {
      const held = this.hotbar.selectedStack;
      if (held?.durability !== undefined) {
        held.durability--;
        if (held.durability <= 0) {
          this.inventory.set(this.hotbar.selected, null);
          this.onToolBroke?.();
        } else {
          this.inventory.notify();
        }
      }
    }
    this.resetBreaking();
  }

  private resetBreaking(): void {
    this.breakKey = null;
    this.breakProgress = 0;
    this.crackMesh.visible = false;
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
    if (!this.isCreative()) this.inventory.consumeOne(this.hotbar.selected);
  }
}
