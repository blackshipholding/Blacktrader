// Optionale Ausformulierung der Begründung mit eigenem LLM-Key des Nutzers.
// Der Key wird nur durchgereicht und nirgends gespeichert.
import { NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/data/ratelimit";

const SYSTEM = `Du bist Blacktrader, der Chefanalyst der Black Ship Holding. Persönlichkeit: äußerst ehrgeizig, selbstbewusst, unabhängig, diszipliniert, intelligent, charismatisch, willensstark, mit natürlicher Führungsmentalität. Du denkst eigenständig, hinterfragst konventionelle Denkweisen und sagst deine Meinung direkt, ehrlich und kompromisslos. Hohe Ansprüche. Rational und intuitiv zugleich, ruhig unter Druck. Du folgst nie blind der Masse.
Regeln: Selbstbewusst im Ton, aber ehrlich in der Sache. Unsichere Setups klar als unsicher benennen – lieber "kein Trade" als ein schwaches Signal. Erfinde KEINE Zahlen, Kurse, News oder Fakten: verwende ausschließlich die gelieferten Analysedaten. Behalte Signal, Einstieg, Stop, Ziele und Invalidierung exakt bei. Schreibe auf Deutsch in einfacher Alltagssprache, sehr knapp: Zeile 1 im Format „Einstieg bei X · Stop bei Y · Ziel Z“ (oder „Kein Einstieg“), danach 1–2 kurze Sätze Begründung, z. B. „Einstieg in die Aktie, da sie einen lokalen Boden ausgebildet hat.“ Keine Fachbegriffe-Listen. Keine Anlageberatung.`;

export async function POST(req: Request) {
  if (!checkRateLimit(req)) return NextResponse.json({ error: "Zu viele Anfragen" }, { status: 429 });
  const key = req.headers.get("x-llm-key");
  if (!key) return NextResponse.json({ error: "Kein LLM-API-Key hinterlegt" }, { status: 400 });
  const body = (await req.json()) as { provider: "anthropic" | "openai"; model?: string; facts: string };
  if (!body.facts || body.facts.length > 20000) return NextResponse.json({ error: "Ungültige Eingabe" }, { status: 400 });
  try {
    if (body.provider === "openai") {
      const r = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: body.model || "gpt-4o-mini",
          messages: [
            { role: "system", content: SYSTEM },
            { role: "user", content: `Formuliere die Begründung aus diesen Analysedaten:\n\n${body.facts}` },
          ],
        }),
      });
      const j = await r.json();
      if (!r.ok) return NextResponse.json({ error: j?.error?.message ?? `HTTP ${r.status}` }, { status: 502 });
      return NextResponse.json({ text: j.choices?.[0]?.message?.content ?? "" });
    }
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: body.model || "claude-sonnet-5-5",
        max_tokens: 400,
        system: SYSTEM,
        messages: [{ role: "user", content: `Formuliere die Begründung aus diesen Analysedaten:\n\n${body.facts}` }],
      }),
    });
    const j = await r.json();
    if (!r.ok) return NextResponse.json({ error: j?.error?.message ?? `HTTP ${r.status}` }, { status: 502 });
    const text = (j.content ?? []).filter((c: { type: string }) => c.type === "text").map((c: { text: string }) => c.text).join("\n");
    return NextResponse.json({ text });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
