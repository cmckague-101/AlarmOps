import {useEffect, useRef, useState} from 'react';
import {Map, NavigationControl, setWorkerUrl, type GeoJSONSource, type MapLayerMouseEvent} from 'maplibre-gl';
import mapWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import type {FireResourceVehicle, NifcIncident} from '@fireops/domain';
import {incidentMapData, NATIONAL_BOUNDS, validMapCoordinates, vehicleMapData} from './operations-map-data';
import 'maplibre-gl/dist/maplibre-gl.css';
import './operations-map.css';

type Props = {
  incidents: NifcIncident[];
  vehicles: FireResourceVehicle[];
  selected: NifcIncident | null;
  focusedVehicleId: string | null;
  onSelect: (incident: NifcIncident) => void;
  onVehicleSelect?: (id: string) => void;
  onReset: () => void;
};
type Tip = {x: number; y: number; name: string; incident?: NifcIncident};

// OpenFreeMap's public vector style requires no API key. Map data stays with
// NIFC/Motive; only basemap tile requests are sent to the map provider.
const MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';

// MapLibre 6 otherwise resolves its worker relative to the bundled map chunk.
// Explicitly let Vite emit the worker and provide its hashed deployment URL.
setWorkerUrl(mapWorkerUrl);

export default function OperationsMap(props: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const [ready, setReady] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState('');
  const [tip, setTip] = useState<Tip | null>(null);

  useEffect(() => {
    if (!container.current) return;
    let map: Map;
    let disposed = false;
    setReady(false);
    setError('');
    setTip(null);
    try {
      map = new Map({
        container: container.current,
        style: MAP_STYLE,
        bounds: NATIONAL_BOUNDS,
        fitBoundsOptions: {padding: 35},
        maxZoom: 18,
        attributionControl: {compact: true},
      });
    } catch {
      setError('The interactive map could not start. Check that WebGL is enabled in your browser.');
      return;
    }
    mapRef.current = map;
    map.addControl(new NavigationControl(), 'top-left');
    map.getCanvas().setAttribute('aria-label', 'Wildfire operations map. Use arrow keys to pan and plus or minus to zoom. Search fires to open incident details.');
    map.on('error', event => {
      console.error('Operations map error:', event.error);
      if (!disposed) setError(`Map error: ${event.error.message || 'A map resource could not load.'}`);
    });
    const onContextLost = () => setError('Map graphics were interrupted. Retry to restore the map.');
    map.getCanvas().addEventListener('webglcontextlost', onContextLost);
    // Operational overlays must not wait for every remote basemap tile to load.
    map.once('style.load', () => {
      if (disposed) return;
      map.addSource('fires', {type: 'geojson', data: incidentMapData(latest.current.incidents), cluster: true, clusterMaxZoom: 8, clusterRadius: 45});
      map.addSource('fleet', {type: 'geojson', data: vehicleMapData(latest.current.vehicles)});
      map.addLayer({id: 'fire-clusters', type: 'circle', source: 'fires', filter: ['has', 'point_count'], paint: {
        'circle-color': '#b94b16', 'circle-radius': ['step', ['get', 'point_count'], 18, 25, 23, 100, 28],
        'circle-stroke-width': 2, 'circle-stroke-color': '#fff',
      }});
      map.addLayer({id: 'fire-cluster-count', type: 'symbol', source: 'fires', filter: ['has', 'point_count'], layout: {
        'text-field': ['get', 'point_count_abbreviated'], 'text-font': ['Noto Sans Bold'], 'text-size': 12,
      }, paint: {'text-color': '#fff'}});
      map.addLayer({id: 'fire-points', type: 'circle', source: 'fires', filter: ['!', ['has', 'point_count']], paint: {
        'circle-color': '#e86722',
        'circle-radius': ['interpolate', ['linear'], ['get', 'acres'], 0, 6, 10000, 10, 100000, 14],
        'circle-stroke-width': 2, 'circle-stroke-color': '#fff',
      }});
      map.addLayer({id: 'selected-fire', type: 'circle', source: 'fires', filter: ['==', ['get', 'id'], ''], paint: {
        'circle-radius': 17, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': '#972f0c', 'circle-stroke-width': 3,
      }});
      map.addLayer({id: 'fleet-points', type: 'circle', source: 'fleet', paint: {
        'circle-color': '#246349', 'circle-radius': 10, 'circle-stroke-width': 2, 'circle-stroke-color': '#fff',
      }});
      map.addLayer({id: 'fleet-labels', type: 'symbol', source: 'fleet', layout: {
        'text-field': ['get', 'unit'], 'text-font': ['Noto Sans Regular'], 'text-size': 12, 'text-offset': [0, 1.5], 'text-anchor': 'top',
      }, paint: {'text-color': '#163d2b', 'text-halo-color': '#fff', 'text-halo-width': 2}});

      map.on('click', 'fire-clusters', async event => {
        const feature = event.features?.[0];
        if (!feature || feature.geometry.type !== 'Point') return;
        try {
          const zoom = await (map.getSource('fires') as GeoJSONSource).getClusterExpansionZoom(Number(feature.properties.cluster_id));
          if (!disposed) map.easeTo({center: feature.geometry.coordinates as [number, number], zoom});
        } catch { /* Source can change while a cluster is expanding. */ }
      });
      map.on('click', 'fire-points', event => {
        const incident = latest.current.incidents.find(item => item.id === event.features?.[0]?.properties.id);
        if (incident) latest.current.onSelect(incident);
      });
      map.on('click', 'fleet-points', event => {
        const id = event.features?.[0]?.properties.id;
        if (typeof id === 'string') latest.current.onVehicleSelect?.(id);
      });
      const hover = (event: MapLayerMouseEvent) => {
        const feature = event.features?.[0];
        if (!feature) return;
        map.getCanvas().style.cursor = 'pointer';
        const incident = feature.source === 'fires' ? latest.current.incidents.find(item => item.id === feature.properties.id) : undefined;
        const vehicle = feature.source === 'fleet' ? latest.current.vehicles.find(item => item.id === feature.properties.id) : undefined;
        if (incident || vehicle) setTip({x: event.point.x, y: event.point.y, name: incident?.name ?? vehicle!.unit, incident});
      };
      for (const layer of ['fire-points', 'fleet-points', 'fire-clusters']) {
        map.on('mousemove', layer, hover);
        map.on('mouseleave', layer, () => {map.getCanvas().style.cursor = ''; setTip(null)});
      }
      map.on('movestart', () => setTip(null));
      setReady(true);
    });
    const observer = new ResizeObserver(() => map.resize());
    observer.observe(container.current);
    return () => {
      disposed = true;
      observer.disconnect();
      map.getCanvas().removeEventListener('webglcontextlost', onContextLost);
      map.remove();
      mapRef.current = null;
    };
  }, [attempt]);

  useEffect(() => {
    if (!ready) return;
    (mapRef.current?.getSource('fires') as GeoJSONSource | undefined)?.setData(incidentMapData(props.incidents));
    (mapRef.current?.getSource('fleet') as GeoJSONSource | undefined)?.setData(vehicleMapData(props.vehicles));
  }, [ready, props.incidents, props.vehicles]);

  const vehicle = props.vehicles.find(item => item.id === props.focusedVehicleId);
  const longitude = props.selected?.longitude ?? vehicle?.motive?.longitude;
  const latitude = props.selected?.latitude ?? vehicle?.motive?.latitude;
  useEffect(() => {
    if (!ready || !mapRef.current) return;
    mapRef.current.setFilter('selected-fire', ['==', ['get', 'id'], props.selected?.id ?? '']);
    if (validMapCoordinates(longitude, latitude)) {
      mapRef.current.flyTo({center: [longitude!, latitude!], zoom: 9, duration: 900});
    }
  }, [ready, props.selected?.id, props.focusedVehicleId, longitude, latitude]);

  return <>
    <div ref={container} className="operations-vector-map" />
    <button type="button" className="operations-map-reset" onClick={() => {
      props.onReset();
      setTip(null);
      mapRef.current?.fitBounds(NATIONAL_BOUNDS, {padding: 35, duration: 700});
    }}>Reset view</button>
    {tip && <div role="tooltip" className={`fire-tooltip${tip.x > (container.current?.clientWidth ?? 0) - 210 ? ' flip-x' : ''}${tip.y < 100 ? ' flip-y' : ''}`} style={{left: tip.x, top: tip.y}}>
      <b>{tip.name}</b>
      {tip.incident && <dl><div><dt>Acres</dt><dd>{tip.incident.acres?.toLocaleString('en-US') ?? 'Not reported'}</dd></div><div><dt>Contained</dt><dd>{tip.incident.contained === null ? 'Not reported' : `${tip.incident.contained}%`}</dd></div><div><dt>Personnel</dt><dd>{tip.incident.personnel?.toLocaleString('en-US') ?? 'Not reported'}</dd></div></dl>}
    </div>}
    {error && <div className="operations-map-error" role="alert">{error} <button type="button" onClick={() => setAttempt(value => value + 1)}>Retry map</button></div>}
  </>;
}
