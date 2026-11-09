import {useEffect, useMemo, useState} from 'react';
import {ActivityIndicator, Platform, Pressable, StyleSheet, Text, TextInput, View} from 'react-native';
import {useRouter} from 'expo-router';
import Svg, {Circle, G, Path} from 'react-native-svg';
import {geoAlbersUsa, geoPath} from 'd3-geo';
import type {FeatureCollection} from 'geojson';
import {feature} from 'topojson-client';
import type {Topology} from 'topojson-specification';
import statesTopology from 'us-atlas/states-10m.json';
import type {NifcIncident} from '@fireops/domain';
import {AppleIncidentMap} from './apple-incident-map';
import {AppSymbol} from './app-symbol';
import {fetchNifcIncidents} from '@/lib/nifc';
import {useFleetVehicles} from '@/lib/fleet-store';
import {useSession} from '@/providers/session-provider';
import {type FireOpsTheme, useFireOpsTheme} from '@/theme';

const states=feature(statesTopology as unknown as Topology,'states') as unknown as FeatureCollection;
const projection=geoAlbersUsa().fitExtent([[20,20],[880,540]],states);
const statePath=geoPath(projection);
const statePaths=states.features.map((state,index)=>({key:String(state.id??index),d:statePath(state)??''}));

/** Fires matching a name search, largest first. */
export function searchIncidents(incidents:NifcIncident[],query:string,limit=5){
  const normalized=query.trim().toLocaleLowerCase();
  if(!normalized)return [];
  return incidents
    .filter(incident=>incident.name.toLocaleLowerCase().includes(normalized))
    .sort((a,b)=>(b.acres??-1)-(a.acres??-1)||a.name.localeCompare(b.name))
    .slice(0,limit);
}

/**
 * Compact incident map card for the Dashboard. The full map, fire list and
 * assignment flow stay on the Operations tab; tapping a fire opens it there.
 */
export function DashboardIncidentMap(){
  const theme=useFireOpsTheme();
  const styles=useMemo(()=>createStyles(theme),[theme]);
  const router=useRouter();
  const {access}=useSession();
  const member=access.value?.kind==='member'?access.value:null;
  const {vehicles}=useFleetVehicles(member?.company.id??null);
  const [incidents,setIncidents]=useState<NifcIncident[]>([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [request,setRequest]=useState(0);
  const [query,setQuery]=useState('');
  useEffect(()=>{
    const controller=new AbortController();
    void fetchNifcIncidents(controller.signal)
      .then(next=>{if(!controller.signal.aborted)setIncidents(next)})
      .catch(failure=>{
        if(failure instanceof Error&&failure.name==='AbortError')return;
        if(!controller.signal.aborted)setError('Current NIFC fire data could not be loaded. Check your connection and try again.');
      })
      .finally(()=>{if(!controller.signal.aborted)setLoading(false)});
    return()=>controller.abort();
  },[request]);
  const retry=()=>{setLoading(true);setError('');setRequest(value=>value+1)};
  const motiveVehicles=useMemo(()=>vehicles.filter(vehicle=>vehicle.motive),[vehicles]);
  const results=useMemo(()=>searchIncidents(incidents,query),[incidents,query]);
  const openOperations=()=>router.push('/(tabs)/operations' as never);
  const openIncident=(incident:NifcIncident)=>{setQuery('');router.push({pathname:'/(tabs)/operations',params:{incidentId:incident.id}} as never)};
  const openVehicle=(vehicleId:string)=>router.push(`/vehicle/${encodeURIComponent(vehicleId)}` as never);
  const markers=useMemo(()=>incidents.flatMap(incident=>{const point=projection([incident.longitude,incident.latitude]);return point?[{incident,x:point[0],y:point[1]}]:[]}),[incidents]);

  return <View style={styles.panel}>
    <View style={styles.header}>
      <View style={styles.heading}>
        <Text accessibilityRole="header" style={styles.title}>Incident Map</Text>
        <Text style={styles.meta}>{loading?'Updating NIFC data':`${incidents.length} ${incidents.length===1?'incident':'incidents'}`}</Text>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="Open Operations" onPress={openOperations} style={({pressed})=>[styles.open,pressed&&styles.pressed]}><Text style={styles.openText}>Operations</Text><AppSymbol name={{ios:'chevron.right',android:'chevron_right'} as never} size={14} color={theme.ember}/></Pressable>
    </View>
    <View style={styles.search}>
      <AppSymbol name={{ios:'magnifyingglass',android:'search'} as never} size={16} color={theme.secondary}/>
      <TextInput value={query} onChangeText={setQuery} placeholder="Search fires by name" placeholderTextColor={theme.secondary} accessibilityLabel="Search fires by name" returnKeyType="search" style={styles.searchInput}/>
      {query?<Pressable accessibilityRole="button" accessibilityLabel="Clear fire search" onPress={()=>setQuery('')} hitSlop={8}><AppSymbol name={{ios:'xmark.circle.fill',android:'cancel'} as never} size={16} color={theme.secondary}/></Pressable>:null}
    </View>
    {query.trim()?<View style={styles.results}>
      {results.length?results.map(incident=><Pressable key={incident.id} accessibilityRole="button" accessibilityLabel={`Open ${incident.name}`} onPress={()=>openIncident(incident)} style={({pressed})=>[styles.result,pressed&&styles.pressed]}>
        <Text style={styles.resultName} numberOfLines={1}>{incident.name}</Text>
        <Text style={styles.meta}>{incident.acres===null?'Acres not reported':`${Math.round(incident.acres).toLocaleString('en-US')} acres`}</Text>
      </Pressable>):<Text style={styles.empty}>No fire names match “{query.trim()}”.</Text>}
    </View>:null}
    <View style={styles.map}>
      {Platform.OS==='ios'
        ?<AppleIncidentMap incidents={incidents} vehicles={motiveVehicles} onIncidentDetails={openIncident} onVehicleDetails={openVehicle} style={StyleSheet.absoluteFill}/>
        :<Pressable accessibilityRole="button" accessibilityLabel={`Map showing ${incidents.length} wildfire incidents. Open Operations`} onPress={openOperations} style={StyleSheet.absoluteFill}>
          <Svg width="100%" height="100%" viewBox="0 0 900 560" preserveAspectRatio="xMidYMid meet">
            <G>{statePaths.map(state=><Path key={state.key} d={state.d} fill={theme.surfaceAlt} stroke={theme.divider} strokeWidth={1}/>)}</G>
            <G>{markers.map(({incident,x,y})=><Circle key={incident.id} cx={x} cy={y} r={incident.acres&&incident.acres>=1000?7:4} fill={theme.ember} opacity={0.8}/>)}</G>
          </Svg>
        </Pressable>}
      {loading?<View pointerEvents="none" style={styles.overlay}><ActivityIndicator color={theme.commandForeground}/></View>:null}
      {!loading&&error?<View style={styles.overlay}><Text accessibilityRole="alert" style={styles.errorText}>{error}</Text><Pressable accessibilityRole="button" onPress={retry} style={({pressed})=>[styles.retry,pressed&&styles.pressed]}><Text style={styles.retryText}>Try again</Text></Pressable></View>:null}
      {!loading&&!error&&!incidents.length?<View pointerEvents="none" style={styles.overlay}><Text style={styles.meta}>NIFC is not reporting any active wildfire incidents.</Text></View>:null}
    </View>
    <View style={styles.footer}><View style={styles.legend}><View style={styles.dot}/><Text style={styles.meta}>Active wildfire</Text></View><Text style={styles.meta}>Source: NIFC WFIGS</Text></View>
  </View>;
}

function createStyles(theme:FireOpsTheme){return StyleSheet.create({
  panel:{overflow:'hidden',borderWidth:1,borderColor:theme.divider,borderRadius:14,backgroundColor:theme.paper},
  header:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:12,paddingHorizontal:16,paddingTop:14,paddingBottom:10},
  heading:{flex:1},title:{color:theme.ink,fontSize:18,fontWeight:'800'},meta:{color:theme.secondary,fontSize:13},
  open:{flexDirection:'row',alignItems:'center',gap:2,minHeight:44,paddingHorizontal:4},openText:{color:theme.ember,fontSize:14,fontWeight:'700'},
  search:{flexDirection:'row',alignItems:'center',gap:8,marginHorizontal:16,marginBottom:12,paddingHorizontal:12,minHeight:44,borderWidth:1,borderColor:theme.divider,borderRadius:10,backgroundColor:theme.surfaceAlt},
  searchInput:{flex:1,color:theme.ink,fontSize:15,paddingVertical:8},
  results:{marginHorizontal:16,marginBottom:12,borderWidth:1,borderColor:theme.divider,borderRadius:10,overflow:'hidden'},
  result:{minHeight:52,justifyContent:'center',paddingHorizontal:12,paddingVertical:8,borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:theme.divider},
  resultName:{color:theme.ink,fontSize:15,fontWeight:'700'},empty:{padding:12,color:theme.secondary,fontSize:14},
  map:{height:240,borderTopWidth:1,borderBottomWidth:1,borderColor:theme.divider,backgroundColor:theme.surfaceAlt},
  overlay:{position:'absolute',top:0,right:0,bottom:0,left:0,alignItems:'center',justifyContent:'center',gap:10,padding:16},
  errorText:{color:theme.danger,fontSize:14,textAlign:'center'},retry:{minHeight:44,justifyContent:'center',paddingHorizontal:16,borderRadius:9,borderWidth:1,borderColor:theme.divider,backgroundColor:theme.paper},retryText:{color:theme.ink,fontWeight:'700'},
  footer:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:12,paddingHorizontal:16,paddingVertical:10},
  legend:{flexDirection:'row',alignItems:'center',gap:6},dot:{width:8,height:8,borderRadius:4,backgroundColor:theme.ember},
  pressed:{opacity:.65},
});}
