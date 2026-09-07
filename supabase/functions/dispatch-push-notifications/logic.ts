export function chunks<T>(values: T[], size = 100) {
  if (!Number.isInteger(size) || size < 1) throw new Error('Chunk size must be a positive integer.');
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

export function retryDelayMinutes(attempts: number) {
  return Math.min(60, Math.max(1, 2 ** Math.max(0, attempts - 1)));
}

export function isInvalidTokenError(code: string | undefined) {
  return code === 'DeviceNotRegistered';
}
