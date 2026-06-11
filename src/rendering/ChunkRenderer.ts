import * as THREE from 'three';
import { Chunk, CHUNK_SIZE } from '../world/Chunk';
import { ChunkManager, chunkKey } from '../world/ChunkManager';
import { meshChunk } from './ChunkMesher';

interface ChunkMeshes {
  opaque: THREE.Mesh | null;
  transparent: THREE.Mesh | null;
}

/**
 * Owns the Three.js meshes for every loaded chunk. Call `update()` once per
 * frame; it re-meshes any chunk flagged dirty.
 */
export class ChunkRenderer {
  private readonly scene: THREE.Scene;
  private readonly world: ChunkManager;
  private readonly meshes = new Map<string, ChunkMeshes>();
  readonly opaqueMaterial: THREE.MeshLambertMaterial;
  readonly transparentMaterial: THREE.MeshLambertMaterial;

  constructor(scene: THREE.Scene, world: ChunkManager, atlas: THREE.Texture) {
    this.scene = scene;
    this.world = world;
    this.opaqueMaterial = new THREE.MeshLambertMaterial({
      map: atlas,
      vertexColors: true,
    });
    this.transparentMaterial = new THREE.MeshLambertMaterial({
      map: atlas,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
  }

  /** Re-mesh dirty chunks. Budgeted so a burst of edits can't hitch a frame badly. */
  update(maxRemeshesPerFrame = 8): void {
    let done = 0;
    for (const chunk of this.world.chunks.values()) {
      if (!chunk.dirty) continue;
      this.buildChunkMesh(chunk);
      chunk.dirty = false;
      if (++done >= maxRemeshesPerFrame) break;
    }
  }

  buildChunkMesh(chunk: Chunk): void {
    const key = chunkKey(chunk.cx, chunk.cz);
    this.disposeMeshes(key);

    const data = meshChunk(chunk, this.world);
    const entry: ChunkMeshes = { opaque: null, transparent: null };
    const offsetX = chunk.cx * CHUNK_SIZE;
    const offsetZ = chunk.cz * CHUNK_SIZE;

    if (data.opaque) {
      entry.opaque = new THREE.Mesh(data.opaque, this.opaqueMaterial);
      entry.opaque.position.set(offsetX, 0, offsetZ);
      this.scene.add(entry.opaque);
    }
    if (data.transparent) {
      entry.transparent = new THREE.Mesh(data.transparent, this.transparentMaterial);
      entry.transparent.position.set(offsetX, 0, offsetZ);
      this.scene.add(entry.transparent);
    }
    this.meshes.set(key, entry);
  }

  removeChunkMesh(cx: number, cz: number): void {
    this.disposeMeshes(chunkKey(cx, cz));
  }

  get loadedMeshCount(): number {
    return this.meshes.size;
  }

  /** Total triangles across all chunk meshes (for the debug overlay). */
  get triangleCount(): number {
    let tris = 0;
    for (const m of this.meshes.values()) {
      if (m.opaque?.geometry.index) tris += m.opaque.geometry.index.count / 3;
      if (m.transparent?.geometry.index) tris += m.transparent.geometry.index.count / 3;
    }
    return tris;
  }

  private disposeMeshes(key: string): void {
    const old = this.meshes.get(key);
    if (!old) return;
    for (const mesh of [old.opaque, old.transparent]) {
      if (!mesh) continue;
      this.scene.remove(mesh);
      mesh.geometry.dispose();
    }
    this.meshes.delete(key);
  }
}
