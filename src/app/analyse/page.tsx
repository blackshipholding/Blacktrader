import { Suspense } from "react";
import { AssetDetail } from "@/components/AssetDetail";

export default function AnalysePage() {
  return (
    <Suspense fallback={<div className="panel p-6 text-sm text-stone-400">Lade …</div>}>
      <AssetDetail />
    </Suspense>
  );
}
