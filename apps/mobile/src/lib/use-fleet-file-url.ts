import { useEffect, useState } from "react";

import { openFleetFile } from "@/lib/fleet-files";
import type { FleetVehicleFile } from "@/lib/fleet-store";
import {demoFleetImageUrl} from './demo-fleet-images';
import {useSession} from '@/providers/session-provider';

export function useFleetFileUrl(file: FleetVehicleFile | null | undefined) {
  const [result, setResult] = useState<{ path: string; url: string } | null>(null);
  const path = file?.path;
  const {demoMode}=useSession();
  const bundledUrl=demoMode?demoFleetImageUrl(path??undefined):null;

  useEffect(() => {
    let active = true;
    if (!path||bundledUrl) return;

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
  }, [path,bundledUrl]);

  if(bundledUrl)return bundledUrl;
  if (!result || result.path !== path) return null;
  return result.url;
}
