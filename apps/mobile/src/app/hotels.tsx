import {useEffect,useMemo,useRef,useState} from 'react';
import {ActivityIndicator,Linking,Platform,Pressable,StyleSheet,Text,TextInput,View,type ScrollViewInstance} from 'react-native';
import * as Location from 'expo-location';
import {fedRoomsAddressLines,fedRoomsHotelDestination,fedRoomsRestaurantsUrl,fedRoomsMapsUrl,fedRoomsPlaceLabel,fedRoomsRegionFromValue,fedRoomsRegionLabel,fedRoomsRegionValue,fedRoomsResultLimit,fedRoomsSearchFilter,fedRoomsSearchTerm,fedRoomsSourceUrl,fedRoomsWebSearchUrl,matchFedRoomsCity,matchFedRoomsRegion,sortFedRoomsRegions,type FedRoomsCity,type FedRoomsPlace,type FedRoomsHotel,type FedRoomsRegion} from '@fireops/domain';
import {AppSymbol} from '@/components/app-symbol';
import {FilterSelect} from '@/components/filter-select';
import {FlightSearchCard} from '@/components/flight-search-card';
import {SectionScreen} from '@/components/section-screen';
import {supabase} from '@/lib/supabase';
import {useSession} from '@/providers/session-provider';
import {FireOpsTheme,useFireOpsTheme} from '@/theme';

const failureMessage=(error:unknown)=>error instanceof Error?error.message:'Hotel data could not be loaded.';
const mapsProvider=Platform.OS==='ios'?'apple':'google';

async function currentPlace():Promise<FedRoomsPlace>{
  const {status}=await Location.requestForegroundPermissionsAsync();
  if(status!=='granted')throw new Error('Location permission was denied. Allow location for FireOps in Settings and try again.');
  const {coords}=await Location.getCurrentPositionAsync({accuracy:Location.Accuracy.Balanced});
  const [address]=await Location.reverseGeocodeAsync({latitude:coords.latitude,longitude:coords.longitude});
  if(!address)throw new Error('Your city could not be looked up. Try again or choose it from the list.');
  return {city:address.city??address.subregion??null,state:address.region??null,country:address.country??null,countryCode:address.isoCountryCode??null};
}

export default function HotelsScreen(){
  const theme=useFireOpsTheme();
  const {demoMode}=useSession();
  const styles=useMemo(()=>createStyles(theme),[theme]);
  const [regions,setRegions]=useState<FedRoomsRegion[]>([]);
  const [cities,setCities]=useState<FedRoomsCity[]>([]);
  const [hotels,setHotels]=useState<FedRoomsHotel[]>([]);
  const [regionValue,setRegionValue]=useState('');
  const [city,setCity]=useState('');
  const [query,setQuery]=useState('');
  const [term,setTerm]=useState('');
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [refresh,setRefresh]=useState(0);
  const [citiesRegion,setCitiesRegion]=useState('');
  const [locating,setLocating]=useState(false);
  const [nearMe,setNearMe]=useState<{regionValue:string;place:FedRoomsPlace}|null>(null);
  const [nearNote,setNearNote]=useState('');
  const [flightsTo,setFlightsTo]=useState<{value:string;key:number}|null>(null);
  const scroll=useRef<ScrollViewInstance>(null);
  const region=regionValue?fedRoomsRegionFromValue(regionValue):null;
  const ready=Boolean(region||term.length>=2);

  useEffect(()=>{const timer=setTimeout(()=>setTerm(fedRoomsSearchTerm(query)),300);return()=>clearTimeout(timer)},[query]);

  useEffect(()=>{
    let active=true;if(!supabase){setLoading(false);return}
    setLoading(true);setError('');
    void (async()=>{try{
      const {data,error:failure}=await supabase.from('fedrooms_hotel_regions').select('country,state,hotel_count,last_seen_at');
      if(!active)return;if(failure)throw failure;setRegions(sortFedRoomsRegions((data??[]) as FedRoomsRegion[]));
    }catch(failure){if(active)setError(failureMessage(failure))}finally{if(active)setLoading(false)}})();
    return()=>{active=false};
  },[demoMode,refresh]);

  useEffect(()=>{
    let active=true;setCities([]);setCity('');setCitiesRegion('');
    const selected=regionValue?fedRoomsRegionFromValue(regionValue):null;
    if(!supabase||!selected)return()=>{active=false};
    void (async()=>{try{
      let request=supabase.from('fedrooms_hotel_cities').select('city,hotel_count').eq('country',selected.country);
      request=selected.state?request.eq('state',selected.state):request.is('state',null);
      const {data,error:failure}=await request.order('city');
      if(!active)return;if(failure)throw failure;setCities((data??[]) as FedRoomsCity[]);setCitiesRegion(regionValue);
    }catch(failure){if(active)setError(failureMessage(failure))}})();
    return()=>{active=false};
  },[regionValue,refresh]);

  // Near me: once the located state's cities load, pick the same city or fall back to the whole state.
  useEffect(()=>{
    if(!nearMe||citiesRegion!==nearMe.regionValue)return;
    const match=matchFedRoomsCity(cities,nearMe.place.city);
    setCity(match??'');
    setNearNote(match?`Showing FedRooms hotels in ${fedRoomsPlaceLabel(nearMe.place)}.`:`No FedRooms hotels listed in ${nearMe.place.city??'your city'}. Showing all of ${fedRoomsRegionLabel({...fedRoomsRegionFromValue(nearMe.regionValue)!,hotel_count:0})}.`);
    setNearMe(null);
  },[cities,citiesRegion,nearMe]);

  async function findNearMe(){
    setLocating(true);setNearNote('');setError('');
    try{
      const place=await currentPlace();
      const match=matchFedRoomsRegion(regions,place);
      if(!match){setNearNote(`No FedRooms hotels listed near ${fedRoomsPlaceLabel(place)}.`);return}
      const value=fedRoomsRegionValue(match);
      setQuery('');setTerm('');setNearMe({regionValue:value,place});setRegionValue(value);
    }catch(failure){setNearNote(failure instanceof Error?failure.message:'Your location could not be determined.')}
    finally{setLocating(false)}
  }

  useEffect(()=>{
    let active=true;setHotels([]);
    const selected=regionValue?fedRoomsRegionFromValue(regionValue):null;
    if(!supabase||(!selected&&term.length<2))return()=>{active=false};
    setLoading(true);setError('');
    void (async()=>{try{
      let request=supabase.from('fedrooms_hotels').select('property_key,name,address,city,state,postal_code,country');
      if(selected){request=request.eq('country',selected.country);request=selected.state?request.eq('state',selected.state):request.is('state',null)}
      if(city)request=request.eq('city',city);
      if(term)request=request.or(fedRoomsSearchFilter(term));
      const {data,error:failure}=await request.order('name').limit(fedRoomsResultLimit+1);
      if(!active)return;if(failure)throw failure;setHotels((data??[]) as FedRoomsHotel[]);
    }catch(failure){if(active)setError(failureMessage(failure))}finally{if(active)setLoading(false)}})();
    return()=>{active=false};
  },[regionValue,city,term,refresh]);

  const total=regions.reduce((sum,item)=>sum+item.hotel_count,0);
  const shown=hotels.slice(0,fedRoomsResultLimit);
  return <SectionScreen scrollRef={scroll} title="Travel" description="Flights, GSA FedRooms hotels, and nearby restaurants. Book through your travel system or directly.">
    <FlightSearchCard prefillTo={flightsTo}/>
    <View style={styles.sectionTitle}><AppSymbol name={{ios:'bed.double.fill',android:'hotel'}} size={18} color={theme.ember}/><Text accessibilityRole="header" style={styles.sectionTitleText}>Hotels</Text></View>
    <Pressable accessibilityRole="button" accessibilityLabel="Find hotels near me" disabled={locating||!regions.length} onPress={()=>void findNearMe()} style={({pressed})=>[styles.nearMe,pressed&&styles.pressed,(locating||!regions.length)&&styles.disabled]}>{locating?<ActivityIndicator size="small" color="#fff"/>:<AppSymbol name={{ios:'location.fill',android:'my_location'}} size={17} color="#fff"/>}<Text style={styles.nearMeText}>{locating?'Locating…':'Hotels near me'}</Text></Pressable>
    {nearNote?<Text accessibilityRole="text" style={styles.nearNote}>{nearNote}</Text>:null}
    <View style={styles.filters}>
      <View style={styles.field}><Text style={styles.fieldLabel}>Search</Text><TextInput accessibilityLabel="Search hotels" value={query} onChangeText={setQuery} placeholder="Hotel, city, or address" placeholderTextColor={theme.secondary} selectionColor={theme.ember} autoCorrect={false} clearButtonMode="while-editing" returnKeyType="search" style={styles.input}/></View>
      <View style={styles.field}><Text style={styles.fieldLabel}>State or country</Text><FilterSelect accessibilityLabel="State or country" value={regionValue} onChange={value=>{setNearNote('');setRegionValue(value)}} options={[{value:'',label:'All'},...regions.map(item=>({value:fedRoomsRegionValue(item),label:`${fedRoomsRegionLabel(item)} (${item.hotel_count})`}))]}/></View>
      {cities.length?<View style={styles.field}><Text style={styles.fieldLabel}>City</Text><FilterSelect accessibilityLabel="City" value={city} onChange={value=>{setNearNote('');setCity(value)}} options={[{value:'',label:'All'},...cities.map(item=>({value:item.city,label:`${item.city} (${item.hotel_count})`}))]}/></View>:null}
    </View>
    <Pressable accessibilityRole="button" disabled={loading} onPress={()=>setRefresh(value=>value+1)} style={({pressed})=>[styles.refresh,pressed&&styles.pressed,loading&&styles.disabled]}><AppSymbol name={{ios:'arrow.clockwise',android:'refresh'}} size={17} color={theme.green}/><Text style={styles.refreshText}>Refresh hotels</Text>{loading?<ActivityIndicator size="small" color={theme.green}/>:null}</Pressable>
    {error?<View accessibilityRole="alert" style={[styles.state,styles.errorState]}><Text style={styles.stateTitle}>Hotel data unavailable</Text><Text style={styles.errorText}>{error}</Text></View>:null}
    {!error&&!supabase?<View style={styles.state}><Text style={styles.stateTitle}>Supabase connection required</Text></View>:null}
    {!error&&supabase&&!ready?<View style={styles.state}><Text style={styles.stateTitle}>{regions.length||loading?'Find a FedRooms hotel':'No hotels imported yet'}</Text><Text style={styles.stateCopy}>{regions.length||loading?`Choose a state or country, or search by name.${total?` ${total.toLocaleString()} properties available.`:''}`:'Check again after the scheduled GSA import.'}</Text></View>:null}
    {ready&&!error&&supabase?<View style={styles.results}>
      <View style={styles.resultsHeader}><View style={styles.headerCopy}><Text style={styles.resultsTitle}>{city||(region?fedRoomsRegionLabel({...region,hotel_count:0}):'Search results')}</Text><Text style={styles.resultsMeta}>{hotels.length>fedRoomsResultLimit?`First ${fedRoomsResultLimit} matches. Narrow your search to see more.`:`${hotels.length} ${hotels.length===1?'property':'properties'}`}</Text></View>{demoMode?<Text style={styles.warning}>Demo data</Text>:null}</View>
      {shown.map(hotel=><View key={hotel.property_key} style={styles.hotel}>
        <Text style={styles.hotelName}>{hotel.name}</Text>
        {fedRoomsAddressLines(hotel).map(line=><Text key={line} style={styles.detail}>{line}</Text>)}
        <View style={styles.actions}>
          <Pressable accessibilityRole="link" accessibilityLabel={`Open ${hotel.name} in Maps`} onPress={()=>void Linking.openURL(fedRoomsMapsUrl(hotel,mapsProvider))} style={({pressed})=>[styles.action,pressed&&styles.pressed]}><AppSymbol name={{ios:'map',android:'map'}} size={15} color={theme.green}/><Text style={styles.actionText}>Map</Text></Pressable>
          <Pressable accessibilityRole="link" accessibilityLabel={`Find restaurants near ${hotel.name}`} onPress={()=>void Linking.openURL(fedRoomsRestaurantsUrl(hotel,mapsProvider))} style={({pressed})=>[styles.action,pressed&&styles.pressed]}><AppSymbol name={{ios:'fork.knife',android:'restaurant'}} size={15} color={theme.green}/><Text style={styles.actionText}>Restaurants</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={`Search flights to ${fedRoomsHotelDestination(hotel)}`} onPress={()=>{setFlightsTo(current=>({value:fedRoomsHotelDestination(hotel),key:(current?.key??0)+1}));scroll.current?.scrollTo({y:0,animated:true})}} style={({pressed})=>[styles.action,pressed&&styles.pressed]}><AppSymbol name={{ios:'airplane',android:'flight'}} size={15} color={theme.green}/><Text style={styles.actionText}>Flights here</Text></Pressable>
          <Pressable accessibilityRole="link" accessibilityLabel={`Search the web for ${hotel.name}`} onPress={()=>void Linking.openURL(fedRoomsWebSearchUrl(hotel))} style={({pressed})=>[styles.action,pressed&&styles.pressed]}><AppSymbol name={{ios:'safari',android:'travel_explore'}} size={15} color={theme.green}/><Text style={styles.actionText}>Search web</Text></Pressable>
        </View>
      </View>)}
      {!hotels.length&&!loading?<View style={styles.empty}><Text style={styles.stateTitle}>No hotels match</Text></View>:null}
      <Pressable accessibilityRole="link" onPress={()=>void Linking.openURL(fedRoomsSourceUrl)} style={({pressed})=>[styles.source,pressed&&styles.pressed]}><Text style={styles.sourceText}>{demoMode?'Fictional sample records for demonstration. ':'Source: GSA FedRooms accepted properties. '}Verify official source. Rates and availability are not shown. FireOps is not affiliated with or endorsed by GSA.</Text><AppSymbol name={{ios:'arrow.up.right.square',android:'open_in_new'}} size={16} color={theme.green}/></Pressable>
    </View>:null}
  </SectionScreen>;
}

function createStyles(theme:FireOpsTheme){return StyleSheet.create({
  sectionTitle:{marginBottom:12,flexDirection:'row',alignItems:'center',gap:8},sectionTitleText:{color:theme.ink,fontSize:18,fontWeight:'800'},
  filters:{gap:14},field:{gap:6},fieldLabel:{color:theme.secondary,fontSize:11,fontWeight:'800',textTransform:'uppercase',letterSpacing:.6},
  nearMe:{minHeight:48,marginBottom:12,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:8,borderRadius:12,backgroundColor:theme.ember},nearMeText:{color:'#fff',fontSize:15,fontWeight:'800'},
  nearNote:{marginBottom:12,padding:12,borderRadius:10,backgroundColor:theme.surfaceAlt,color:theme.ink,fontSize:13,lineHeight:18},
  input:{minHeight:48,paddingHorizontal:14,borderWidth:1,borderColor:theme.divider,borderRadius:12,backgroundColor:theme.surfaceAlt,color:theme.ink,fontSize:16},
  refresh:{minHeight:48,marginVertical:16,paddingHorizontal:14,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:8,borderWidth:1,borderColor:theme.divider,borderRadius:12,backgroundColor:theme.paper},refreshText:{color:theme.green,fontSize:14,fontWeight:'800'},pressed:{opacity:.68},disabled:{opacity:.55},
  state:{padding:24,alignItems:'center',gap:6,borderWidth:1,borderColor:theme.divider,borderRadius:14,backgroundColor:theme.paper},errorState:{borderColor:theme.danger},stateTitle:{color:theme.ink,fontSize:16,fontWeight:'800'},stateCopy:{color:theme.secondary,fontSize:13,lineHeight:19,textAlign:'center'},errorText:{color:theme.danger,fontSize:13,lineHeight:19,textAlign:'center'},
  results:{overflow:'hidden',borderWidth:1,borderColor:theme.divider,borderRadius:14,backgroundColor:theme.paper},resultsHeader:{padding:16,flexDirection:'row',alignItems:'flex-start',gap:10,borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:theme.divider},headerCopy:{flex:1},resultsTitle:{color:theme.ink,fontSize:17,lineHeight:22,fontWeight:'800'},resultsMeta:{marginTop:5,color:theme.secondary,fontSize:11,lineHeight:16},warning:{overflow:'hidden',paddingHorizontal:8,paddingVertical:5,borderRadius:999,backgroundColor:theme.warningSurface,color:theme.warning,fontSize:10,fontWeight:'800'},
  hotel:{padding:14,gap:3,borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:theme.divider},hotelName:{color:theme.ink,fontSize:15,lineHeight:20,fontWeight:'800'},detail:{color:theme.secondary,fontSize:12,lineHeight:17},
  actions:{marginTop:10,flexDirection:'row',flexWrap:'wrap',gap:8},action:{flexGrow:1,flexBasis:'45%',minHeight:40,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:6,borderWidth:1,borderColor:theme.divider,borderRadius:10,backgroundColor:theme.surfaceAlt},actionText:{color:theme.green,fontSize:13,fontWeight:'800'},
  empty:{padding:24,alignItems:'center'},
  source:{padding:14,flexDirection:'row',alignItems:'center',gap:10,backgroundColor:theme.surfaceAlt},sourceText:{flex:1,color:theme.secondary,fontSize:10,lineHeight:15},
})}
