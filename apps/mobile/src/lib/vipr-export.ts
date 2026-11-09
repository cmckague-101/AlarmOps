import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Share } from 'react-native';
import { normalizeVehicle, type Vehicle } from '@fireops/domain';

import type { FleetVehicle } from './fleet-store';

/** The stored fleet record as a domain Vehicle, for the shared VIPR mapping. */
export function viprVehicle(vehicle: FleetVehicle): Vehicle {
  const source = vehicle.source as Partial<Vehicle>;
  const year = Number(vehicle.year);
  return normalizeVehicle({
    ...source,
    id: vehicle.id,
    unit: vehicle.name,
    type: vehicle.type,
    year: Number.isFinite(year) ? year : 0,
    make: vehicle.make ?? '',
    model: vehicle.model ?? '',
    vin: vehicle.vin ?? '',
    plate: vehicle.plate ?? '',
    status: vehicle.status as Vehicle['status'],
    createdAt: typeof source.createdAt === 'string' ? source.createdAt : '',
  });
}

/** Opens the share sheet with the bid package as plain text (Copy, Mail, Notes…). */
export async function shareViprBidPackageText(text: string) {
  await Share.share({ message: text, title: 'VIPR bid package' });
}

/** Writes the bid package to a .txt file and opens the share sheet (Save to Files, AirDrop…). */
export async function saveViprBidPackageFile(text: string, fileName: string) {
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is unavailable on this device.');
  const directory = new Directory(Paths.cache, 'vipr-exports');
  directory.create({ intermediates: true, idempotent: true });
  const target = new File(directory, fileName);
  if (target.exists) target.delete();
  target.create();
  target.write(text);
  await Sharing.shareAsync(target.uri, { mimeType: 'text/plain', UTI: 'public.plain-text', dialogTitle: 'Save VIPR bid package' });
  return target.uri;
}
