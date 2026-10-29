import DateTimePicker from '@react-native-community/datetimepicker';
import * as Location from 'expo-location';
import {useEffect,useMemo,useRef,useState} from 'react';
import {ActivityIndicator,Linking,Platform,Pressable,StyleSheet,Text,TextInput,View,type TextInputInstance} from 'react-native';
import {airportLabel,flightSearchProblem,formatCalendarDate,googleFlightsUrl,nearestAirport} from '@fireops/domain';
import {AppSymbol} from '@/components/app-symbol';
import {FireOpsTheme,useFireOpsTheme} from '@/theme';

const isoDate=(date:Date)=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;

export function FlightSearchCard({prefillTo}:{prefillTo:{value:string;key:number}|null}){
  const theme=useFireOpsTheme();
  const styles=useMemo(()=>createStyles(theme),[theme]);
  const [from,setFrom]=useState('');
  const [to,setTo]=useState('');
  const [depart,setDepart]=useState('');
  const [returnDate,setReturnDate]=useState('');
  const [picking,setPicking]=useState<'depart'|'return'|null>(null);
  const [note,setNote]=useState('');
  const [locating,setLocating]=useState(false);
  const toInput=useRef<TextInputInstance>(null);

  useEffect(()=>{if(prefillTo){setTo(prefillTo.value);setNote(`Destination set to ${prefillTo.value}. Choose your dates.`)}},[prefillTo]);

  async function fillNearestAirport(){
    setLocating(true);setNote('');
    try{
      const {status}=await Location.requestForegroundPermissionsAsync();
      if(status!=='granted')throw new Error('Location permission was denied. Allow location for FireOps in Settings and try again.');
      const [{coords},{airportRows}]=await Promise.all([Location.getCurrentPositionAsync({accuracy:Location.Accuracy.Balanced}),import('@fireops/domain/airports-data')]);
      const airport=nearestAirport(airportRows,coords);
      if(!airport){setNote('No nearby airport was found.');return}
      setFrom(airport.code);setNote(`Nearest airport: ${airportLabel(airport)} (${Math.round(airport.distanceKm*0.621371)} mi). Check that it has the flights you need.`);
    }catch(failure){setNote(failure instanceof Error?failure.message:'Your location could not be determined.')}
    finally{setLocating(false)}
  }

  function search(){
    const flight={from,to,depart,returnDate:returnDate||null};
    const problem=flightSearchProblem(flight);
    if(problem){setNote(problem);return}
    setNote('');
    void Linking.openURL(googleFlightsUrl(flight));
  }

  const pickerValue=picking==='return'?returnDate||depart:depart;
  return <View style={styles.card}>
    <View style={styles.titleRow}><AppSymbol name={{ios:'airplane',android:'flight'}} size={18} color={theme.ember}/><Text accessibilityRole="header" style={styles.title}>Flights</Text></View>
    <Text style={styles.copy}>Search Google Flights. Leave Return empty for one way.</Text>
    <View style={styles.field}><Text style={styles.label}>From</Text><View style={styles.fromRow}><TextInput accessibilityLabel="Flying from" value={from} onChangeText={setFrom} placeholder="Airport or city, e.g. SMF" placeholderTextColor={theme.secondary} selectionColor={theme.ember} autoCorrect={false} autoCapitalize="characters" returnKeyType="next" onSubmitEditing={()=>toInput.current?.focus()} style={[styles.input,styles.fromInput]}/><Pressable accessibilityRole="button" accessibilityLabel="Use nearest airport" disabled={locating} onPress={()=>void fillNearestAirport()} style={({pressed})=>[styles.nearest,pressed&&styles.pressed,locating&&styles.disabled]}>{locating?<ActivityIndicator size="small" color={theme.green}/>:<AppSymbol name={{ios:'location.fill',android:'my_location'}} size={15} color={theme.green}/>}<Text style={styles.nearestText}>Nearest</Text></Pressable></View></View>
    <View style={styles.field}><Text style={styles.label}>To</Text><TextInput ref={toInput} accessibilityLabel="Flying to" value={to} onChangeText={setTo} placeholder="Airport or city, e.g. Boise, Idaho" placeholderTextColor={theme.secondary} selectionColor={theme.ember} autoCorrect={false} returnKeyType="done" style={styles.input}/></View>
    <View style={styles.dates}>
      <View style={[styles.field,styles.dateField]}><Text style={styles.label}>Depart</Text><Pressable accessibilityRole="button" accessibilityLabel={depart?`Departure date, ${formatCalendarDate(depart)}`:'Select departure date'} onPress={()=>setPicking(value=>value==='depart'?null:'depart')} style={styles.dateButton}><Text style={depart?styles.dateText:styles.placeholder}>{depart?formatCalendarDate(depart):'Select date'}</Text></Pressable></View>
      <View style={[styles.field,styles.dateField]}><Text style={styles.label}>Return (optional)</Text><Pressable accessibilityRole="button" accessibilityLabel={returnDate?`Return date, ${formatCalendarDate(returnDate)}`:'Select return date'} onPress={()=>setPicking(value=>value==='return'?null:'return')} style={styles.dateButton}><Text style={returnDate?styles.dateText:styles.placeholder}>{returnDate?formatCalendarDate(returnDate):'One way'}</Text></Pressable></View>
    </View>
    {picking?<><DateTimePicker value={pickerValue?new Date(`${pickerValue}T12:00:00`):new Date()} minimumDate={picking==='return'&&depart?new Date(`${depart}T12:00:00`):new Date()} mode="date" display={Platform.OS==='ios'?'inline':'default'} onChange={(event,date)=>{const field=picking;if(Platform.OS!=='ios')setPicking(null);if(event.type!=='set'||!date)return;const value=isoDate(date);if(field==='return')setReturnDate(value);else{setDepart(value);if(returnDate&&returnDate<value)setReturnDate('')}}}/>{Platform.OS==='ios'?<View style={styles.pickerActions}>{picking==='return'&&returnDate?<Pressable accessibilityRole="button" onPress={()=>{setReturnDate('');setPicking(null)}} style={styles.pickerButton}><Text style={styles.pickerButtonText}>One way</Text></Pressable>:null}<Pressable accessibilityRole="button" onPress={()=>setPicking(null)} style={styles.pickerButton}><Text style={styles.pickerButtonText}>Done</Text></Pressable></View>:null}</>:null}
    {Platform.OS!=='ios'&&returnDate?<Pressable accessibilityRole="button" onPress={()=>setReturnDate('')} style={styles.clearReturn}><Text style={styles.nearestText}>Make it one way</Text></Pressable>:null}
    <Pressable accessibilityRole="button" onPress={search} style={({pressed})=>[styles.search,pressed&&styles.pressed]}><AppSymbol name={{ios:'magnifyingglass',android:'search'}} size={17} color="#fff"/><Text style={styles.searchText}>Search Google Flights</Text></Pressable>
    {note?<Text style={styles.note}>{note}</Text>:null}
  </View>;
}

function createStyles(theme:FireOpsTheme){return StyleSheet.create({
  card:{marginBottom:24,padding:16,gap:12,borderWidth:1,borderColor:theme.divider,borderRadius:14,backgroundColor:theme.paper},
  titleRow:{flexDirection:'row',alignItems:'center',gap:8},title:{color:theme.ink,fontSize:18,fontWeight:'800'},copy:{marginTop:-6,color:theme.secondary,fontSize:12,lineHeight:17},
  field:{gap:6},label:{color:theme.secondary,fontSize:11,fontWeight:'800',textTransform:'uppercase',letterSpacing:.6},
  input:{minHeight:48,paddingHorizontal:14,borderWidth:1,borderColor:theme.divider,borderRadius:12,backgroundColor:theme.surfaceAlt,color:theme.ink,fontSize:16},
  fromRow:{flexDirection:'row',gap:8},fromInput:{flex:1},nearest:{minHeight:48,paddingHorizontal:12,flexDirection:'row',alignItems:'center',gap:6,borderWidth:1,borderColor:theme.divider,borderRadius:12,backgroundColor:theme.paper},nearestText:{color:theme.green,fontSize:13,fontWeight:'800'},
  dates:{flexDirection:'row',gap:10},dateField:{flex:1},dateButton:{minHeight:48,paddingHorizontal:14,justifyContent:'center',borderWidth:1,borderColor:theme.divider,borderRadius:12,backgroundColor:theme.surfaceAlt},dateText:{color:theme.ink,fontSize:15,fontWeight:'600'},placeholder:{color:theme.secondary,fontSize:15},
  pickerActions:{flexDirection:'row',gap:8},pickerButton:{flex:1,minHeight:44,alignItems:'center',justifyContent:'center',borderWidth:1,borderColor:theme.divider,borderRadius:10,backgroundColor:theme.paper},pickerButtonText:{color:theme.ink,fontSize:14,fontWeight:'700'},clearReturn:{alignSelf:'flex-start',minHeight:34,justifyContent:'center'},
  search:{minHeight:48,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:8,borderRadius:12,backgroundColor:theme.ember},searchText:{color:'#fff',fontSize:15,fontWeight:'800'},
  note:{padding:12,borderRadius:10,backgroundColor:theme.surfaceAlt,color:theme.ink,fontSize:13,lineHeight:18},
  pressed:{opacity:.68},disabled:{opacity:.55},
})}
