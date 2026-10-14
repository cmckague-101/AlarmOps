import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchIncidents } from './OperationsPage';

afterEach(() => vi.unstubAllGlobals());

describe('fetchIncidents', () => {
  it('advances by source rows and removes incidents repeated across pages', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        exceededTransferLimit: true,
        features: [
          { attributes: { OBJECTID: 1, IncidentName: 'First' }, geometry: { x: -120, y: 40 } },
          { attributes: { OBJECTID: 2, IncidentName: 'Invalid' } },
        ],
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        exceededTransferLimit: false,
        features: [
          { attributes: { OBJECTID: 1, IncidentName: 'First' }, geometry: { x: -120, y: 40 } },
          { attributes: { OBJECTID: 3, IncidentName: 'Third' }, geometry: { x: -121, y: 41 } },
        ],
      })));
    vi.stubGlobal('fetch', fetchMock);

    const incidents = await fetchIncidents(new AbortController().signal);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(new URL(fetchMock.mock.calls[1][0]).searchParams.get('resultOffset')).toBe('2');
    expect(incidents.map((incident) => incident.id)).toEqual(['1', '3']);
  });
});
