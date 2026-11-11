import { resolveInput } from "@/lib/data/resolve";
import { handle, param } from "@/lib/data/route-helpers";

export async function GET(req: Request) {
  return handle(req, async () => ({ candidates: await resolveInput(param(req, "q") ?? "", req.headers.get("x-openfigi-key") ?? undefined) }), 3600);
}
