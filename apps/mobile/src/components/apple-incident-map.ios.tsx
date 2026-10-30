import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import MapView, { Marker, type Region } from 'react-native-maps';

import { AppSymbol } from '@/components/app-symbol';
import type { FleetVehicle } from '@/lib/fleet-store';
import { telemetryFreshness } from '@/lib/telemetry-freshness';
import type { AppleIncidentMapProps } from './apple-incident-map';

const US_REGION: Region = {
  latitude: 39.5,
  longitude: -98.35,
  latitudeDelta: 41,
  longitudeDelta: 64,
};

function formatAcres(value: number | null) {
  return value === null ? 'Acres unavailable' : `${Math.round(value).toLocaleString()} acres`;
}

function vehicleCoordinates(vehicle: FleetVehicle) {
  const latitude = vehicle.motive?.latitude;
  const longitude = vehicle.motive?.longitude;
  return typeof latitude === 'number' && Number.isFinite(latitude) && typeof longitude === 'number' && Number.isFinite(longitude)
    ? { latitude, longitude }
    : null;
}

export function AppleIncidentMap({
  incidents,
  vehicles,
  focusedVehicleId,
  onIncidentDetails,
  onVehicleDetails,
  style,
}: AppleIncidentMapProps) {
  const [longitudeDelta, setLongitudeDelta] = useState(US_REGION.longitudeDelta);
  const mapRef = useRef<MapView>(null);
  const showPins = longitudeDelta < 12;

  useEffect(() => {
    if (!focusedVehicleId) return;
    const vehicle = vehicles.find((item) => item.id === focusedVehicleId);
    const coordinate = vehicle ? vehicleCoordinates(vehicle) : null;
    if (coordinate) mapRef.current?.animateToRegion({ ...coordinate, latitudeDelta: 0.04, longitudeDelta: 0.04 }, 350);
  }, [focusedVehicleId, vehicles]);

  return (
    <MapView
      ref={mapRef}
      accessibilityLabel={`Apple Map showing ${incidents.length} active wildfire incidents`}
      initialRegion={US_REGION}
      mapType="standard"
      onRegionChangeComplete={(region) => setLongitudeDelta(region.longitudeDelta)}
      pitchEnabled={false}
      rotateEnabled={false}
      style={style}
    >
      {incidents.map((incident, index) => showPins ? (
        <Marker
          coordinate={{ latitude: incident.latitude, longitude: incident.longitude }}
          description={`${incident.state || 'Location unavailable'} · ${formatAcres(incident.acres)}`}
          key={`${incident.id}-${index}-pin`}
          onCalloutPress={() => onIncidentDetails(incident)}
          pinColor="#E2231A"
          title={incident.name}
          tracksViewChanges={false}
        />
      ) : (
        <Marker
          anchor={{ x: 0.5, y: 0.5 }}
          coordinate={{ latitude: incident.latitude, longitude: incident.longitude }}
          description={`${incident.state || 'Location unavailable'} · ${formatAcres(incident.acres)}`}
          key={`${incident.id}-${index}-dot`}
          onCalloutPress={() => onIncidentDetails(incident)}
          title={incident.name}
          tracksViewChanges={false}
        >
          <View style={styles.fireMarker} />
        </Marker>
      ))}
      {vehicles.map((vehicle, index) => {
        const coordinate = vehicleCoordinates(vehicle);
        if (!coordinate) return null;
        const stale = telemetryFreshness(vehicle.motive?.updatedAt) === 'stale';
        return (
          <Marker
            anchor={{ x: 0.5, y: 0.5 }}
            coordinate={coordinate}
            description={`${stale ? 'Stale · ' : ''}${vehicle.motive?.location ?? 'Location unavailable'} · ${vehicle.motive?.speed ?? 'Speed unavailable'}`}
            key={`${vehicle.id}-${index}-vehicle`}
            onCalloutPress={() => onVehicleDetails(vehicle.id)}
            onPress={() => onVehicleDetails(vehicle.id)}
            title={vehicle.name}
            tracksViewChanges={false}
          >
            <View style={[styles.vehicleMarker, stale && styles.vehicleMarkerStale]}>
              <AppSymbol name={{ ios: 'truck.box.fill', android: 'local_shipping' } as never} size={14} color="#FFFFFF" />
            </View>
          </Marker>
        );
      })}
    </MapView>
  );
}

const styles = StyleSheet.create({
  fireMarker: {
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#FFFFFF',
    backgroundColor: '#E2231A',
  },
  vehicleMarker: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    backgroundColor: '#18864B',
  },
  vehicleMarkerStale: {
    backgroundColor: '#B86E0B',
  },
});
