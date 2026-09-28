import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import MapView, { Marker, type Region } from 'react-native-maps';

import type { MotiveVehicleSnapshot } from '@fireops/domain';
import type { FleetVehicle } from '@/lib/fleet-store';
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

type MotiveWithCoordinates = MotiveVehicleSnapshot & { latitude?: number; longitude?: number; lat?: number; lon?: number };

function vehicleCoordinates(vehicle: FleetVehicle) {
  const motive = vehicle.motive as MotiveWithCoordinates | undefined;
  const latitude = Number(motive?.latitude ?? motive?.lat);
  const longitude = Number(motive?.longitude ?? motive?.lon);
  if (Number.isFinite(latitude) && Number.isFinite(longitude)) return { latitude, longitude };
  const location = motive?.location.toLocaleLowerCase() ?? '';
  if (location.includes('redding')) return { latitude: 40.5865, longitude: -122.3917 };
  if (location.includes('shasta lake')) return { latitude: 40.6804, longitude: -122.3708 };
  if (location.includes('anderson')) return { latitude: 40.4482, longitude: -122.2978 };
  return null;
}

export function AppleIncidentMap({
  incidents,
  vehicles,
  onIncidentDetails,
  onVehicleDetails,
  style,
}: AppleIncidentMapProps) {
  const [longitudeDelta, setLongitudeDelta] = useState(US_REGION.longitudeDelta);
  const showPins = longitudeDelta < 12;

  return (
    <MapView
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
        return (
          <Marker
            anchor={{ x: 0.5, y: 0.5 }}
            coordinate={coordinate}
            description={`${vehicle.motive?.location ?? 'Location unavailable'} · ${vehicle.motive?.speed ?? 'Speed unavailable'}`}
            key={`${vehicle.id}-${index}-vehicle`}
            onCalloutPress={() => onVehicleDetails(vehicle.id)}
            title={vehicle.name}
            tracksViewChanges={false}
          >
            <View style={styles.vehicleMarker} />
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
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    backgroundColor: '#18864B',
  },
});
