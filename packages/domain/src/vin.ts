// Motive matches vehicles by VIN, so a mistyped VIN silently breaks tracking.
// VINs are optional; when given they must be 17 letters/digits without I, O or Q.
export function vinError(value: string): string {
  const vin = value.trim().toUpperCase();
  if (!vin) return '';
  if (vin.length !== 17) return `VIN must be 17 characters (${vin.length} entered).`;
  if (/[IOQ]/.test(vin)) return 'VINs never use the letters I, O or Q. Check for 1 or 0.';
  if (!/^[A-Z0-9]+$/.test(vin)) return 'VIN can only contain letters and numbers.';
  return '';
}
