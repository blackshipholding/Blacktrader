// Stop bei flatex in Euro: Ändert sich der Wechselkurs (Dollar-Werte) oder zieht Blacktrader den Stop nach, weicht der
// richtige Euro-Stop vom eingetragenen ab. Ab 0,5 % Abweichung: Erinnerung „Stop bei flatex anpassen“.
import { eurPerUnit } from "../fx";
import type { Trade } from "../store/store";
import { tradeCurrency } from "./eur";

export const STOP_DRIFT = 0.005;

export interface StopHint {
  /** Stop jetzt in Euro (richtig) */
  nowEur: number;
  /** bei flatex eingetragen (zuletzt bestätigt) */
  setEur: number;
  /** Anpassen nötig */
  adjust: boolean;
}

export function brokerStop(t: Trade): StopHint | null {
  if (t.status !== "open" || !(t.stop > 0) || t.strategy === "core") return null;
  const fx = eurPerUnit(tradeCurrency(t));
  if (fx == null) return null;
  const nowEur = t.stop * fx;
  const setEur = t.brokerStopEur ?? t.stop * (t.fxEntry ?? fx);
  return { nowEur, setEur, adjust: Math.abs(nowEur - setEur) / setEur > STOP_DRIFT };
}
