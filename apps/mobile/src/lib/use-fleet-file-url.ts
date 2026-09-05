import { useEffect, useState } from "react";

import { openFleetFile } from "@/lib/fleet-files";
import type { FleetVehicleFile } from "@/lib/fleet-store";

export function useFleetFileUrl(file: FleetVehicleFile | null | undefined) {
  const [result, setResult] = useState<{ path: string; url: string } | null>(null);

  useEffect(() => {
    let active = true;
    if (!file?.path) return;
    const path = file.path;

    void openFleetFile(file)
      .then((url) => {
        if (active) setResult({ path, url });
      })
      .catch(() => {
        if (active) setResult(null);
      });

    return () => {
      active = false;
    };
  }, [file]);

  if (!result || result.path !== file?.path) return null;
  return result.url;
}
