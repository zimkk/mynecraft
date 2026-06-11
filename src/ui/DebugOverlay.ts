import { Game } from '../core/Game';
import { Player } from '../player/Player';
import { ChunkStreamer } from '../world/ChunkStreamer';
import { ChunkRenderer } from '../rendering/ChunkRenderer';
import { BlockInteraction } from '../player/BlockInteraction';
import { blockDef } from '../world/BlockRegistry';
import { CHUNK_SIZE } from '../world/Chunk';
import { Input } from '../core/Input';

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
  }

  update(
    input: Input,
    game: Game,
    player: Player,
    streamer: ChunkStreamer,
    renderer: ChunkRenderer,
    interaction: BlockInteraction,
  ): void {
    if (input.justPressed('F3')) {
      this.visible = !this.visible;
      this.el.style.display = this.visible ? 'block' : 'none';
    }
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
      `Edits: ${streamer.edits.size}`,
    ].join('<br>');
  }
}
