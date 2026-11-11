// KESt wie bei einer österreichischen Bank: 27,5 % sofort auf jeden Gewinn, Verluste kommen in einen Verlusttopf des
// Kalenderjahres. Ein Verlust holt bereits bezahlte KESt zurück; was übrig bleibt, wird mit späteren Gewinnen im selben
// Jahr verrechnet. Zum Jahreswechsel verfällt der Topf (kein Vortrag ins nächste Jahr). Spesen sind nicht abzugsfähig.
export class KestYear {
  private year: number | null = null;
  private paid = 0;
  private lossPot = 0;
  constructor(private rate = 0.275) {}

  /** Bucht einen Gewinn/Verlust g (in €) im Jahr `year`; Ergebnis: Steuer (+ bezahlt, − zurück) */
  settle(g: number, year: number): number {
    if (year !== this.year) {
      this.year = year;
      this.paid = 0;
      this.lossPot = 0;
    }
    if (g > 0) {
      const off = Math.min(g, this.lossPot);
      this.lossPot -= off;
      const k = (g - off) * this.rate;
      this.paid += k;
      return k;
    }
    if (g < 0) {
      const loss = -g;
      const back = Math.min(this.paid, loss * this.rate);
      this.paid -= back;
      this.lossPot += loss - back / this.rate;
      return -back;
    }
    return 0;
  }
}
