import type { StyleProp, ViewStyle } from 'react-native';

import type { NifcIncident } from '@fireops/domain';
import type { FleetVehicle } from '@/lib/fleet-store';

export type AppleIncidentMapProps = {
  incidents: NifcIncident[];
  vehicles: FleetVehicle[];
  onIncidentDetails: (incident: NifcIncident) => void;
  onVehicleDetails: (vehicleId: string) => void;
  style: StyleProp<ViewStyle>;
};

// iOS resolves apple-incident-map.ios.tsx. Other platforms keep the SVG map.
export function AppleIncidentMap(_props: AppleIncidentMapProps) {
  return null;
}
