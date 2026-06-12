import { Game } from '../core/Game';
import { Player } from '../player/Player';
import { ChunkStreamer } from '../world/ChunkStreamer';
import { ChunkRenderer } from '../rendering/ChunkRenderer';
import { BlockInteraction } from '../player/BlockInteraction';
import { blockDef } from '../world/BlockRegistry';
import { CHUNK_SIZE } from '../world/Chunk';

const CARDINALS = ['South (+Z)', 'South-West', 'West (-X)', 'North-West', 'North (-Z)', 'North-East', 'East (+X)', 'South-East'];

/** F3-toggled debug readout: position, chunk, facing, FPS, chunks, target. */
export class DebugOverlay {
  private readonly el: HTMLElement;
  visible = false;

  constructor(container: HTMLElement) {
    this.el = document.createElement('div');
    this.el.id = 'debug';
    this.el.className = 'hud';
    this.el.style.display = 'none';
    container.appendChild(this.el);

    // Own listener (not the per-tick Input buffer): the overlay updates in
    // the render loop, where one-shot input state may already be consumed.
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'F3') return;
      e.preventDefault();
      this.visible = !this.visible;
      this.el.style.display = this.visible ? 'block' : 'none';
    });
  }

  update(
    game: Game,
    player: Player,
    streamer: ChunkStreamer,
    renderer: ChunkRenderer,
    interaction: BlockInteraction,
    clock?: string,
  ): void {
    if (!this.visible) return;

    const p = player.position;
    // yaw 0 faces -Z (North in MC terms is -Z; we label by axis to stay honest).
    const yawDeg = ((-player.yaw * 180) / Math.PI % 360 + 360) % 360;
    const facing = CARDINALS[Math.round(yawDeg / 45) % 8];
    const t = interaction.target;

    this.el.innerHTML = [
      `FPS: ${game.fps}`,
      `XYZ: ${p.x.toFixed(2)} / ${p.y.toFixed(2)} / ${p.z.toFixed(2)}`,
      `Chunk: ${Math.floor(p.x / CHUNK_SIZE)}, ${Math.floor(p.z / CHUNK_SIZE)}`,
      `Facing: ${facing} (yaw ${yawDeg.toFixed(0)}°, pitch ${((player.pitch * 180) / Math.PI).toFixed(0)}°)`,
      `Chunks loaded: ${streamer.loadedChunkCount} | Triangles: ${renderer.triangleCount}`,
      `Mode: ${player.flying ? 'flying' : player.onGround ? 'walking' : 'airborne'}`,
      t ? `Target: ${blockDef(t.id).name} @ ${t.x}, ${t.y}, ${t.z}` : 'Target: —',
      `Edits: ${streamer.edits.size}${clock ? ` | Time: ${clock}` : ''}`,
    ].join('<br>');
  }
}
