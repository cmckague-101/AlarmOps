import {useEffect,useMemo,useRef,useState} from 'react';
import {ActivityIndicator,Linking,Pressable,StyleSheet,Text,TextInput,View} from 'react-native';
import * as Location from 'expo-location';
import {filterDemoRestaurants,geocodeTravelPlace,restaurantKind,restaurantMapsUrl,searchRestaurantsNear,type TravelRestaurant} from '@fireops/domain';

import {AppSymbol} from '@/components/app-symbol';
import {FireOpsTheme,useFireOpsTheme} from '@/theme';

// OpenStreetMap asks apps to identify themselves; browsers send a Referer instead.
const osmHeaders={'User-Agent':'FireOps mobile (https://fireco.vercel.app)'};

/** Travel → Restaurants: its own section under Hotels, searchable by city or address. Matches web. */
export function RestaurantSearchCard({demoMode,prefillNear}:{demoMode:boolean;prefillNear:{value:string;key:number}|null}){
  const theme=useFireOpsTheme();
  const styles=useMemo(()=>createStyles(theme),[theme]);
  const [query,setQuery]=useState('');
  const [results,setResults]=useState<TravelRestaurant[]>([]);
  const [placeLabel,setPlaceLabel]=useState('');
  const [loading,setLoading]=useState(false);
  const [locating,setLocating]=useState(false);
  const [error,setError]=useState('');
  const [searched,setSearched]=useState(false);
  const request=useRef(0);

  useEffect(()=>{
    if(!prefillNear)return;
    setQuery(prefillNear.value);
    void runSearch(prefillNear.value);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-run when a hotel asks for restaurants
  },[prefillNear]);

  async function show(load:()=>Promise<{items:TravelRestaurant[];label:string}>){
    const id=++request.current;
    setLoading(true);setError('');setSearched(true);
    try{const {items,label}=await load();if(id!==request.current)return;setResults(items);setPlaceLabel(label)}
    catch(failure){if(id!==request.current)return;setResults([]);setPlaceLabel('');setError(failure instanceof Error?failure.message:'Restaurant search failed.')}
    finally{if(id===request.current)setLoading(false)}
  }

  function runSearch(raw:string){
    const term=raw.trim();
    if(demoMode)return show(async()=>({items:filterDemoRestaurants(term),label:term||'Sample restaurants'}));
    if(term.length<2){setSearched(true);setResults([]);setError('Enter a city or address, or use Near me.');return Promise.resolve()}
    return show(async()=>{const place=await geocodeTravelPlace(term,osmHeaders);return {items:await searchRestaurantsNear(place.lat,place.lon,osmHeaders),label:place.label}});
  }

  async function findNearMe(){
    setLocating(true);
    try{
      if(demoMode){setQuery('Redding, CA');await runSearch('Redding, CA');return}
      await show(async()=>{
        const {status}=await Location.requestForegroundPermissionsAsync();
        if(status!=='granted')throw new Error('Location permission was denied. Allow location for FireOps in Settings and try again.');
        const {coords}=await Location.getCurrentPositionAsync({accuracy:Location.Accuracy.Balanced});
        setQuery('');
        return {items:await searchRestaurantsNear(coords.latitude,coords.longitude,osmHeaders),label:'Near your location'};
      });
    }finally{setLocating(false)}
  }

  return <View style={styles.section}>
    <View style={styles.sectionTitle}><AppSymbol name={{ios:'fork.knife',android:'restaurant'}} size={18} color={theme.ember}/><Text accessibilityRole="header" style={styles.sectionTitleText}>Restaurants</Text></View>
    <Text style={styles.description}>Restaurants, cafes, and food spots near a city, an address, or your location.</Text>
    <Pressable accessibilityRole="button" accessibilityLabel="Find restaurants near me" disabled={locating||loading} onPress={()=>void findNearMe()} style={({pressed})=>[styles.nearMe,pressed&&styles.pressed,(locating||loading)&&styles.disabled]}>{locating?<ActivityIndicator size="small" color="#fff"/>:<AppSymbol name={{ios:'location.fill',android:'my_location'}} size={17} color="#fff"/>}<Text style={styles.nearMeText}>{locating?'Locating…':'Restaurants near me'}</Text></Pressable>
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>Near</Text>
      <View style={styles.searchRow}>
        <TextInput accessibilityLabel="Search restaurants near a city or address" value={query} onChangeText={setQuery} onSubmitEditing={()=>void runSearch(query)} placeholder="City or address, e.g. Boise, ID" placeholderTextColor={theme.secondary} selectionColor={theme.ember} autoCorrect={false} clearButtonMode="while-editing" returnKeyType="search" style={styles.input}/>
        <Pressable accessibilityRole="button" accessibilityLabel="Search restaurants" disabled={loading} onPress={()=>void runSearch(query)} style={({pressed})=>[styles.searchButton,pressed&&styles.pressed,loading&&styles.disabled]}><AppSymbol name={{ios:'magnifyingglass',android:'search'}} size={18} color="#fff"/></Pressable>
      </View>
    </View>
    {loading?<ActivityIndicator accessibilityLabel="Searching restaurants" style={styles.loading} color={theme.green}/>:null}
    {error?<View accessibilityRole="alert" style={[styles.state,styles.errorState]}><Text style={styles.stateTitle}>Restaurant search unavailable</Text><Text style={styles.errorText}>{error}</Text></View>:null}
    {searched&&!error?<View style={styles.results}>
      <View style={styles.resultsHeader}><View style={styles.headerCopy}><Text style={styles.resultsTitle}>{placeLabel||'Search results'}</Text><Text style={styles.resultsMeta}>{loading?'Searching…':`${results.length} ${results.length===1?'place':'places'}`}</Text></View>{demoMode?<Text style={styles.warning}>Demo data</Text>:null}</View>
      {results.map(item=><View key={item.id} style={styles.row}>
        <View style={styles.rowCopy}><Text style={styles.name}>{item.name}</Text><Text style={styles.detail}>{restaurantKind(item)}</Text>{item.address?<Text style={styles.detail}>{item.address}</Text>:null}</View>
        <Pressable accessibilityRole="link" accessibilityLabel={`Open ${item.name} in Maps`} onPress={()=>void Linking.openURL(restaurantMapsUrl(item))} style={({pressed})=>[styles.action,pressed&&styles.pressed]}><AppSymbol name={{ios:'map',android:'map'}} size={15} color={theme.green}/><Text style={styles.actionText}>Map</Text></Pressable>
      </View>)}
      {!results.length&&!loading?<View style={styles.empty}><Text style={styles.stateTitle}>No restaurants found</Text></View>:null}
      <Text style={styles.source}>{demoMode?'Fictional sample records for demonstration. ':'Source: OpenStreetMap contributors. '}Coverage varies by area. FireOps is not affiliated with listed businesses.</Text>
    </View>:null}
  </View>;
}

function createStyles(theme:FireOpsTheme){return StyleSheet.create({
  section:{marginTop:28},
  sectionTitle:{marginBottom:6,flexDirection:'row',alignItems:'center',gap:8},sectionTitleText:{color:theme.ink,fontSize:18,fontWeight:'800'},
  description:{marginBottom:12,color:theme.secondary,fontSize:13,lineHeight:19},
  nearMe:{minHeight:48,marginBottom:12,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:8,borderRadius:12,backgroundColor:theme.ember},nearMeText:{color:'#fff',fontSize:15,fontWeight:'800'},
  field:{gap:6,marginBottom:16},fieldLabel:{color:theme.secondary,fontSize:11,fontWeight:'800',textTransform:'uppercase',letterSpacing:.6},
  searchRow:{flexDirection:'row',gap:8},
  input:{flex:1,minHeight:48,paddingHorizontal:14,borderWidth:1,borderColor:theme.divider,borderRadius:12,backgroundColor:theme.surfaceAlt,color:theme.ink,fontSize:16},
  searchButton:{width:48,minHeight:48,alignItems:'center',justifyContent:'center',borderRadius:12,backgroundColor:theme.ember},
  loading:{marginBottom:16},pressed:{opacity:.68},disabled:{opacity:.55},
  state:{padding:24,alignItems:'center',gap:6,borderWidth:1,borderColor:theme.divider,borderRadius:14,backgroundColor:theme.paper},errorState:{borderColor:theme.danger},stateTitle:{color:theme.ink,fontSize:16,fontWeight:'800'},errorText:{color:theme.danger,fontSize:13,lineHeight:19,textAlign:'center'},
  results:{overflow:'hidden',borderWidth:1,borderColor:theme.divider,borderRadius:14,backgroundColor:theme.paper},resultsHeader:{padding:16,flexDirection:'row',alignItems:'flex-start',gap:10,borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:theme.divider},headerCopy:{flex:1},resultsTitle:{color:theme.ink,fontSize:17,lineHeight:22,fontWeight:'800'},resultsMeta:{marginTop:5,color:theme.secondary,fontSize:11,lineHeight:16},warning:{overflow:'hidden',paddingHorizontal:8,paddingVertical:5,borderRadius:999,backgroundColor:theme.warningSurface,color:theme.warning,fontSize:10,fontWeight:'800'},
  row:{padding:14,flexDirection:'row',alignItems:'center',gap:12,borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:theme.divider},rowCopy:{flex:1,gap:3},name:{color:theme.ink,fontSize:15,lineHeight:20,fontWeight:'800'},detail:{color:theme.secondary,fontSize:12,lineHeight:17},
  action:{minHeight:40,paddingHorizontal:14,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:6,borderWidth:1,borderColor:theme.divider,borderRadius:10,backgroundColor:theme.surfaceAlt},actionText:{color:theme.green,fontSize:13,fontWeight:'800'},
  empty:{padding:24,alignItems:'center'},
  source:{padding:14,backgroundColor:theme.surfaceAlt,color:theme.secondary,fontSize:10,lineHeight:15},
})}
