import React, {useState} from 'react';
import {Modal, Pressable, ScrollView, StyleSheet, Switch, Text, View} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import {colors} from '../theme';
import {demoAlerts, demoHeat, demoIncidents, demoResources} from '../data/mapSeed';
import {CompanyResource, FireIncident, MapLayerKey} from '../data/mapTypes';

const layerLabels: Record<MapLayerKey, string> = {
  incidents: 'Official incidents',
  perimeters: 'Fire perimeters',
  heat: 'Satellite heat detections',
  weather: 'NWS weather alerts',
  resources: 'FireCo / Motive resources',
  water: 'Water sources',
  facilities: 'Incident facilities',
};

const initialLayers: Record<MapLayerKey, boolean> = {
  incidents: true,
  perimeters: true,
  heat: true,
  weather: true,
  resources: true,
  water: false,
  facilities: false,
};

function mapPosition(coordinate: {latitude: number; longitude: number}) {
  const left = Math.max(5, Math.min(95, ((coordinate.longitude + 118) / 2.5) * 100));
  const top = Math.max(8, Math.min(92, ((45.4 - coordinate.latitude) / 2.1) * 100));
  return {left: `${left}%` as `${number}%`, top: `${top}%` as `${number}%`};
}

export function IncidentMapScreen() {
  const [layers, setLayers] = useState(initialLayers);
  const [showLayers, setShowLayers] = useState(false);
  const [selected, setSelected] = useState<FireIncident | null>(null);
  const [selectedResource, setSelectedResource] = useState<CompanyResource | null>(null);

  const toggle = (key: MapLayerKey) => setLayers(current => ({...current, [key]: !current[key]}));

  return <View style={styles.page}>
    <View style={styles.map}>
      <View style={[styles.terrain, styles.terrainOne]}/>
      <View style={[styles.terrain, styles.terrainTwo]}/>
      <View style={styles.roadOne}/>
      <View style={styles.roadTwo}/>
      <Text style={[styles.place, {left: '58%', top: '67%'}]}>Boise</Text>
      <Text style={[styles.place, {left: '15%', top: '21%'}]}>Baker City</Text>
      <Text style={[styles.place, {left: '65%', top: '35%'}]}>Payette</Text>

      {layers.heat && demoHeat.map(item => <View key={item.id} style={[styles.heat, mapPosition(item.coordinate)]}/>)}
      {layers.incidents && demoIncidents.map(item => <Pressable key={item.id} onPress={() => setSelected(item)} style={[styles.marker, styles.fireMarker, mapPosition(item.coordinate)]}>
        <Ionicons name="flame" size={19} color={colors.white}/>
      </Pressable>)}
      {layers.resources && demoResources.map(item => <Pressable key={item.id} onPress={() => setSelectedResource(item)} style={[styles.marker, styles.resourceMarker, mapPosition(item.coordinate)]}>
        <Ionicons name={item.type.includes('Tender') ? 'water' : 'car'} size={16} color={colors.white}/>
      </Pressable>)}
      {layers.weather && demoAlerts.map(item => <View key={item.id} style={[styles.marker, styles.weatherMarker, mapPosition(item.coordinate)]}>
        <Ionicons name="warning" size={16} color="#111"/>
      </View>)}
    </View>

    <View style={styles.topBar}>
      <View><Text style={styles.title}>Incident Map</Text><Text style={styles.meta}>Web preview · interactive demo layers</Text></View>
      <Pressable style={styles.iconButton}><Ionicons name="refresh" size={21} color={colors.white}/></Pressable>
    </View>
    <View style={styles.actions}>
      <Pressable style={styles.action} onPress={() => setShowLayers(true)}><Ionicons name="layers" size={18} color={colors.white}/><Text style={styles.actionText}>Layers</Text></Pressable>
      <View style={styles.badge}><Text style={styles.badgeText}>{demoIncidents.length} IMSR · offline</Text></View>
    </View>

    <Modal transparent animationType="slide" visible={showLayers} onRequestClose={() => setShowLayers(false)}>
      <Pressable style={styles.backdrop} onPress={() => setShowLayers(false)}/>
      <View style={styles.sheet}>
        <View style={styles.handle}/><Text style={styles.sheetTitle}>Map Layers</Text>
        {(Object.keys(layerLabels) as MapLayerKey[]).map(key => <View key={key} style={styles.layerRow}>
          <Text style={styles.layerText}>{layerLabels[key]}</Text><Switch value={layers[key]} onValueChange={() => toggle(key)} trackColor={{true: colors.red}}/>
        </View>)}
        <Text style={styles.sourceTitle}>Data Connections</Text>
        <Text style={styles.source}>○ NIFC current IMSR incidents · offline preview</Text>
        <Text style={styles.source}>○ NASA FIRMS · MAP_KEY required</Text>
        <Text style={styles.source}>● National Weather Service alerts</Text>
      </View>
    </Modal>

    <Modal transparent animationType="fade" visible={Boolean(selected)} onRequestClose={() => setSelected(null)}>
      <View style={styles.detailBackdrop}><View style={styles.detail}>{selected && <ScrollView>
        <View style={styles.detailHead}><View style={[styles.marker, styles.fireMarker]}><Ionicons name="flame" size={19} color={colors.white}/></View><Pressable onPress={() => setSelected(null)}><Ionicons name="close" size={27} color={colors.text}/></Pressable></View>
        <Text style={styles.detailTitle}>{selected.name}</Text><Text style={styles.detailSub}>{selected.source} · active incident</Text>
        <View style={styles.stats}><View><Text style={styles.statValue}>{selected.acres.toLocaleString()}</Text><Text style={styles.statLabel}>acres</Text></View><View><Text style={styles.statValue}>{selected.containment}%</Text><Text style={styles.statLabel}>contained</Text></View><View><Text style={styles.statValue}>{selected.personnel ?? '—'}</Text><Text style={styles.statLabel}>personnel</Text></View></View>
        <Text style={styles.section}>FireCo Resources</Text>
        {demoResources.filter(resource => resource.incidentId === selected.id).map(resource => <Pressable key={resource.id} style={styles.resourceRow} onPress={() => {setSelected(null); setSelectedResource(resource);}}><Ionicons name="car" size={18} color={colors.green}/><View><Text style={styles.resourceName}>{resource.unit}</Text><Text style={styles.resourceSub}>{resource.type} · {resource.status}</Text></View></Pressable>)}
      </ScrollView>}</View></View>
    </Modal>

    <Modal transparent animationType="fade" visible={Boolean(selectedResource)} onRequestClose={() => setSelectedResource(null)}>
      <View style={styles.detailBackdrop}><View style={styles.detail}>{selectedResource && <ScrollView>
        <View style={styles.detailHead}><View style={[styles.marker, styles.resourceMarker]}><Ionicons name="car" size={17} color={colors.white}/></View><Pressable onPress={() => setSelectedResource(null)}><Ionicons name="close" size={27} color={colors.text}/></Pressable></View>
        <Text style={styles.detailTitle}>{selectedResource.unit}</Text><Text style={styles.detailSub}>{selectedResource.callSign} · {selectedResource.type}</Text>
        <View style={styles.stats}><View><Text style={styles.statValue}>{selectedResource.readiness}%</Text><Text style={styles.statLabel}>readiness</Text></View><View><Text style={styles.statValue}>{selectedResource.crew.length}</Text><Text style={styles.statLabel}>crew</Text></View><View><Text style={styles.statValue}>{selectedResource.status}</Text><Text style={styles.statLabel}>status</Text></View></View>
        <Text style={styles.section}>Assigned Personnel</Text>
        {selectedResource.crew.map(member => <View key={member.id} style={styles.resourceRow}><Ionicons name="person-circle-outline" size={25} color={colors.muted}/><View><Text style={styles.resourceName}>{member.name}</Text><Text style={styles.resourceSub}>{member.role} · {member.qualifications.join(' · ')}</Text></View></View>)}
      </ScrollView>}</View></View>
    </Modal>
  </View>;
}

const styles = StyleSheet.create({
  page: {flex: 1, backgroundColor: '#152019', overflow: 'hidden'},
  map: {flex: 1, position: 'relative', backgroundColor: '#1d2922'},
  terrain: {position: 'absolute', borderRadius: 999, backgroundColor: '#26382b', transform: [{rotate: '-18deg'}]},
  terrainOne: {width: '75%', height: '30%', left: '-10%', top: '16%'},
  terrainTwo: {width: '85%', height: '34%', right: '-18%', bottom: '8%'},
  roadOne: {position: 'absolute', width: '120%', height: 3, left: '-10%', top: '55%', backgroundColor: '#59604d', transform: [{rotate: '-12deg'}]},
  roadTwo: {position: 'absolute', width: 3, height: '110%', left: '59%', top: '-5%', backgroundColor: '#59604d', transform: [{rotate: '20deg'}]},
  place: {position: 'absolute', color: '#96a397', fontSize: 12, fontWeight: '700'},
  heat: {position: 'absolute', width: 42, height: 42, marginLeft: -21, marginTop: -21, borderRadius: 21, backgroundColor: 'rgba(240,169,59,.28)', borderWidth: 1, borderColor: colors.amber},
  marker: {width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.white},
  fireMarker: {position: 'absolute', backgroundColor: colors.red},
  resourceMarker: {position: 'absolute', borderRadius: 10, backgroundColor: colors.green},
  weatherMarker: {position: 'absolute', backgroundColor: colors.amber},
  topBar: {position: 'absolute', top: 12, left: 12, right: 12, backgroundColor: 'rgba(15,19,23,.94)', borderRadius: 16, padding: 13, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderWidth: 1, borderColor: colors.border},
  title: {color: colors.text, fontSize: 22, fontWeight: '900'}, meta: {color: colors.muted, fontSize: 12, marginTop: 2},
  iconButton: {width: 42, height: 42, borderRadius: 12, backgroundColor: colors.red, alignItems: 'center', justifyContent: 'center'},
  actions: {position: 'absolute', top: 91, left: 12, right: 12, flexDirection: 'row', justifyContent: 'space-between'},
  action: {backgroundColor: 'rgba(15,19,23,.94)', paddingHorizontal: 15, height: 42, borderRadius: 12, flexDirection: 'row', gap: 7, alignItems: 'center', borderColor: colors.border, borderWidth: 1},
  actionText: {color: colors.text, fontWeight: '800'}, badge: {backgroundColor: 'rgba(15,19,23,.94)', paddingHorizontal: 14, height: 42, borderRadius: 12, justifyContent: 'center', borderColor: colors.border, borderWidth: 1}, badgeText: {color: colors.amber, fontWeight: '900'},
  backdrop: {...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,.45)'},
  sheet: {position: 'absolute', alignSelf: 'center', width: '100%', maxWidth: 640, bottom: 0, backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 34, borderWidth: 1, borderColor: colors.border},
  handle: {width: 48, height: 5, borderRadius: 5, backgroundColor: colors.border, alignSelf: 'center', marginBottom: 14}, sheetTitle: {color: colors.text, fontSize: 22, fontWeight: '900', marginBottom: 10},
  layerRow: {minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: colors.border}, layerText: {color: colors.text, fontWeight: '700'}, sourceTitle: {color: colors.text, fontWeight: '900', marginTop: 18, marginBottom: 8}, source: {color: colors.muted, lineHeight: 23},
  detailBackdrop: {flex: 1, backgroundColor: 'rgba(0,0,0,.65)', justifyContent: 'flex-end', alignItems: 'center'}, detail: {maxHeight: '75%', width: '100%', maxWidth: 640, backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20},
  detailHead: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 38}, detailTitle: {color: colors.text, fontSize: 27, fontWeight: '900', marginTop: 12}, detailSub: {color: colors.muted, marginTop: 3},
  stats: {flexDirection: 'row', justifyContent: 'space-between', backgroundColor: colors.surfaceAlt, padding: 16, borderRadius: 16, marginTop: 18}, statValue: {color: colors.text, fontSize: 20, fontWeight: '900'}, statLabel: {color: colors.muted, fontSize: 12, marginTop: 2}, section: {color: colors.text, fontWeight: '900', fontSize: 17, marginTop: 20, marginBottom: 9},
  resourceRow: {flexDirection: 'row', gap: 11, alignItems: 'center', paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: colors.border}, resourceName: {color: colors.text, fontWeight: '800'}, resourceSub: {color: colors.muted, fontSize: 12, marginTop: 2},
});
