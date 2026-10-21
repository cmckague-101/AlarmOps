import {describe, expect, it, vi} from 'vitest';
import {setWorkerUrl} from 'maplibre-gl';
import './OperationsMap';

vi.mock('maplibre-gl', () => ({
  Map: vi.fn(),
  NavigationControl: vi.fn(),
  setWorkerUrl: vi.fn(),
}));

vi.mock('maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url', () => ({
  default: '/assets/maplibre-gl-worker-test.js',
}));

describe('operations map worker', () => {
  it('configures the Vite-emitted worker URL before any map is created', () => {
    expect(setWorkerUrl).toHaveBeenCalledExactlyOnceWith('/assets/maplibre-gl-worker-test.js');
  });
});
