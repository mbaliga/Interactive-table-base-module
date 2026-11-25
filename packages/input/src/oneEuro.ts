/** One-euro filter (Casiez et al. 2012). Low lag when moving fast, low jitter when still. */
export interface OneEuroParams { minCutoff: number; beta: number; dCutoff: number }

const alpha = (cutoff: number, dt: number) => {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
};

export class OneEuro {
  private x: number | null = null;
  private dx = 0;
  private t = 0;
  constructor(private p: OneEuroParams) {}

  /** t in milliseconds. */
  filter(value: number, t: number): number {
    if (this.x === null) { this.x = value; this.t = t; return value; }
    const dt = Math.max((t - this.t) / 1000, 1e-3);
    this.t = t;
    const rawD = (value - this.x) / dt;
    this.dx += alpha(this.p.dCutoff, dt) * (rawD - this.dx);
    const cutoff = this.p.minCutoff + this.p.beta * Math.abs(this.dx);
    this.x += alpha(cutoff, dt) * (value - this.x);
    return this.x;
  }
}
