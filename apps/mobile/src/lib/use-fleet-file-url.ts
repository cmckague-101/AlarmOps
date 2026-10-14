import { useEffect, useState } from "react";

import { openFleetFile } from "@/lib/fleet-files";
import type { FleetVehicleFile } from "@/lib/fleet-store";

export function useFleetFileUrl(file: FleetVehicleFile | null | undefined) {
  const [result, setResult] = useState<{ path: string; url: string } | null>(null);
  const path = file?.path;

  useEffect(() => {
    let active = true;
    if (!path) return;

    void openFleetFile({ path })
      .then((url) => {
        if (active) setResult({ path, url });
      })
      .catch(() => {
        if (active) setResult(null);
      });

    return () => {
      active = false;
    };
  }, [path]);

  if (!result || result.path !== path) return null;
  return result.url;
}
