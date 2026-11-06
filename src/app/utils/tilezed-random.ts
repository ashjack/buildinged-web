const STATE_SIZE = 624;
const SEED_OFFSET = 306;
const SEED_OFFSET_2 = 317;

/** The seeded 32-bit generator used by TileZed's QRandomGenerator. */
export class TilezedRandom {
  private readonly state = new Uint32Array(STATE_SIZE);
  private position = STATE_SIZE;

  constructor(seed: number) {
    this.state.fill(0x8b8b8b8b);

    for (let i = 0; i < STATE_SIZE; i++) {
      const previous = (i + STATE_SIZE - 1) % STATE_SIZE;
      const first = (i + SEED_OFFSET) % STATE_SIZE;
      const second = (i + SEED_OFFSET_2) % STATE_SIZE;
      const value = (this.state[i] ^ this.state[first] ^ this.state[previous]) >>> 0;
      const mixed = Math.imul(value ^ (value >>> 27), 1664525) >>> 0;
      const addition = i === 0 ? 1 : i === 1 ? 1 + (seed >>> 0) : i;
      const next = (mixed + addition) >>> 0;
      this.state[first] = (this.state[first] + mixed) >>> 0;
      this.state[second] = (this.state[second] + next) >>> 0;
      this.state[i] = next;
    }

    for (let i = 0; i < STATE_SIZE; i++) {
      const previous = (i + STATE_SIZE - 1) % STATE_SIZE;
      const first = (i + SEED_OFFSET) % STATE_SIZE;
      const second = (i + SEED_OFFSET_2) % STATE_SIZE;
      const value = (this.state[i] + this.state[first] + this.state[previous]) >>> 0;
      const mixed = Math.imul(value ^ (value >>> 27), 1566083941) >>> 0;
      const next = (mixed - i) >>> 0;
      this.state[first] ^= mixed;
      this.state[second] ^= next;
      this.state[i] = next;
    }

    if (!(this.state[0] & 0x80000000) && !this.state.slice(1).some(value => value !== 0)) {
      this.state[0] = 0x80000000;
    }
  }

  next(): number {
    if (this.position === STATE_SIZE) {
      for (let i = 0; i < STATE_SIZE; i++) {
        const joined = (this.state[i] & 0x80000000) | (this.state[(i + 1) % STATE_SIZE] & 0x7fffffff);
        this.state[i] = this.state[(i + 397) % STATE_SIZE] ^ (joined >>> 1) ^ ((joined & 1) ? 0x9908b0df : 0);
      }
      this.position = 0;
    }

    let value = this.state[this.position++];
    value ^= value >>> 11;
    value ^= (value << 7) & 0x9d2c5680;
    value ^= (value << 15) & 0xefc60000;
    value ^= value >>> 18;
    return value >>> 0;
  }
}

/** TileZed consumes the sequence column by column, although pixels are stored row by row. */
export function tilezedRandomGrid(width: number, height: number, seed: number): Uint32Array {
  const random = new TilezedRandom(seed);
  const grid = new Uint32Array(width * height);
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) grid[y * width + x] = random.next();
  }
  return grid;
}
