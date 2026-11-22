import * as Print from 'expo-print';
import {Redirect,Stack} from 'expo-router';
import * as Sharing from 'expo-sharing';
import {useEffect,useMemo,useState} from 'react';
import {
  ActionSheetIOS,
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {AppSymbol} from '@/components/app-symbol';
import {FilterSelect} from '@/components/filter-select';
import {
  MANIFEST_POSITION_OPTIONS,
  addDispatchCenter,
  addManifestVehicle,
  buildManifestShareText,
  canCreateCrewManifest,
  createAshleyNfRxDemoManifest,
  createBlankManifestPerson,
  createBlankManifestVehicle,
  emptyCrewManifest,
  emtColumnValue,
  fleetOptionsForManifest,
  hasManifestContacts,
  isManifestPersonIdentityLocked,
  manifestPersonFromCrewMember,
  patchManifestVehicle,
  removeManifestVehicle,
  renumberManifestPeople,
  selectedDispatchCenter,
  staffAssignmentOptions,
  toManifestFleetVehicle,
  type CrewManifestDocument,
  type CrewManifestPerson,
  type ManifestCompanyStamp,
  type ManifestFleetVehicle,
  type ManifestSelectedVehicle,
  type ManifestStaffAssignment,
} from '@/lib/crew-manifest';
import {openFleetFile} from '@/lib/fleet-files';
import {manifestLogoDataUrl} from '@/lib/manifest-logo';
import {useFleetVehicles,type FleetVehicle} from '@/lib/fleet-store';
import {createManifestPrintHtml,manifestPdfFileName,OPS_CLEAN} from '@/lib/manifest-print';
import {useSession} from '@/providers/session-provider';
import type {CrewMember} from '@fireops/domain';

/** Ops Clean tokens — FireCo red / black / white only. */
const MF={
  red:OPS_CLEAN.red,
  black:OPS_CLEAN.black,
  ink:OPS_CLEAN.ink,
  muted:OPS_CLEAN.muted,
  line:OPS_CLEAN.line,
  wash:OPS_CLEAN.wash,
  paper:OPS_CLEAN.paper,
} as const;

type PickerMode='roster'|'fleet'|'coordinator'|'dispatch'|null;

export default function CrewManifestScreen(){
  const styles=useMemo(()=>createStyles(),[]);
  const {session,access,demoMode}=useSession();
  const member=access.value?.kind==='member'?access.value:null;
  const {crew,vehicles:fleetVehicles}=useFleetVehicles(member?.company.id??null);
  const allowed=Boolean(member&&canCreateCrewManifest(member.user.role));
  const [manifest,setManifest]=useState<CrewManifestDocument>(()=>demoMode
    ?createAshleyNfRxDemoManifest()
    :emptyCrewManifest(member?.company.name??'FIRECO MODULE'));
  const [picker,setPicker]=useState<PickerMode>(null);
  const [newDispatchName,setNewDispatchName]=useState('');
  const [newDispatchPhone,setNewDispatchPhone]=useState('');
  const [logoUri,setLogoUri]=useState('');
  const [exportBusy,setExportBusy]=useState(false);
  const [qualDrafts,setQualDrafts]=useState<Record<string,string>>({});

  useEffect(()=>{
    let active=true;
    void (async()=>{
      if(!member?.company.logoPath){if(active)setLogoUri('');return}
      try{
        const url=await openFleetFile({name:'Company logo',type:'image/*',path:member.company.logoPath});
        if(active)setLogoUri(url);
      }catch{
        if(active)setLogoUri('');
      }
    })();
    return()=>{active=false};
  },[member?.company.logoPath]);

  const available=useMemo(
    ()=>crew.filter(person=>!manifest.people.some(item=>item.id===person.id)).sort((a,b)=>a.name.localeCompare(b.name)),
    [crew,manifest.people],
  );
  const fleetOptions=useMemo(()=>{
    const fromApp=fleetVehicles.map((vehicle:FleetVehicle)=>toManifestFleetVehicle({
      id:vehicle.id,
      name:vehicle.name,
      make:vehicle.make,
      model:vehicle.model,
      vin:vehicle.vin,
      plate:vehicle.plate,
    }));
    return fleetOptionsForManifest(fromApp,demoMode);
  },[demoMode,fleetVehicles]);
  const availableFleet=useMemo(
    ()=>fleetOptions.filter(vehicle=>!manifest.vehicles.some(item=>item.vehicleId===vehicle.id)),
    [fleetOptions,manifest.vehicles],
  );
  const coordinatorOptions=useMemo(
    ()=>staffAssignmentOptions(crew,manifest.handCrewCoordinator),
    [crew,manifest.handCrewCoordinator],
  );
  const dispatch=selectedDispatchCenter(manifest);
  const contactsReady=hasManifestContacts(manifest);

  const companyStamp=():ManifestCompanyStamp=>({
    name:member?.company.name||'FireCo',
    phone:member?.company.phone||undefined,
    location:member?.company.location||undefined,
    ownerName:member?.user.name||undefined,
    ownerEmail:session?.user.email||undefined,
    logoDataUrl:logoUri||undefined,
  });

  if(!session||access.status==='error')return <Redirect href="/"/>;
  if(!allowed)return <Redirect href="/(tabs)/more"/>;

  const addFromRoster=(person:CrewMember)=>{
    setManifest(current=>{
      const withoutEmptyManual=current.people.filter(item=>!(item.source==='manual'&&!item.name.trim()&&!item.phone.trim()));
      return {
        ...current,
        people:renumberManifestPeople([...withoutEmptyManual,manifestPersonFromCrewMember(person,withoutEmptyManual.length+1)]),
      };
    });
    setPicker(null);
  };

  const addFromFleet=(vehicle:ManifestFleetVehicle)=>{
    setManifest(current=>{
      const next=addManifestVehicle(current.vehicles,vehicle);
      return next?{...current,vehicles:next}:current;
    });
    setPicker(null);
  };

  const addPerson=()=>setManifest(current=>({
    ...current,
    people:renumberManifestPeople([...current.people,createBlankManifestPerson(current.people.length+1)]),
  }));

  const removePerson=(id:string)=>setManifest(current=>({
    ...current,
    people:renumberManifestPeople(current.people.filter(person=>person.id!==id)),
  }));

  const patchPerson=(id:string,patch:Partial<CrewManifestPerson>)=>setManifest(current=>({
    ...current,
    people:current.people.map(person=>{
      if(person.id!==id)return person;
      if(isManifestPersonIdentityLocked(person)){
        const {name:_n,dob:_d,...rest}=patch;
        return {...person,...rest};
      }
      return {...person,...patch};
    }),
  }));

  const addManualVehicle=()=>setManifest(current=>({
    ...current,
    vehicles:[...current.vehicles,createBlankManifestVehicle()],
  }));

  const addDispatch=()=>{
    const result=addDispatchCenter(manifest.dispatchCenters,{name:newDispatchName,phone:newDispatchPhone});
    if(!result)return;
    setManifest(current=>({
      ...current,
      dispatchCenters:result.centers,
      selectedDispatchCenterId:result.added.id,
    }));
    setNewDispatchName('');
    setNewDispatchPhone('');
  };

  const exportBlockedReason=():string|null=>{
    if(!manifest.people.length)return 'Add at least one person before exporting.';
    if(!contactsReady)return 'Select a Crew Coordinator and Dispatch Center before exporting.';
    return null;
  };

  const createPdf=async()=>{
    const blocked=exportBlockedReason();
    if(blocked){Alert.alert('Cannot create PDF',blocked);return}
    if(exportBusy)return;
    setExportBusy(true);
    try{
      const stamp=companyStamp();
      // Resolve the current profile logo even if the on-screen preview is still loading.
      stamp.logoDataUrl=member?.company.logoPath
        ?await manifestLogoDataUrl(await openFleetFile({path:member.company.logoPath}))
        :undefined;
      const html=createManifestPrintHtml(manifest,stamp);
      const result=await Print.printToFileAsync({html});
      const fileName=manifestPdfFileName(stamp,manifest);
      if(await Sharing.isAvailableAsync()){
        await Sharing.shareAsync(result.uri,{
          mimeType:'application/pdf',
          UTI:'com.adobe.pdf',
          dialogTitle:`Save ${fileName}`,
        });
      }else{
        await Print.printAsync({uri:result.uri});
      }
    }catch(caught){
      Alert.alert('PDF not created',caught instanceof Error?caught.message:'Please try again.');
    }finally{
      setExportBusy(false);
    }
  };

  const shareManifest=()=>{
    const blocked=exportBlockedReason();
    if(blocked){Alert.alert('Cannot share',blocked);return}
    if(exportBusy)return;
    const {subject,body}=buildManifestShareText(manifest,companyStamp());
    const runShare=async(mode:'text'|'email')=>{
      try{
        if(mode==='email'){
          const url=`mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
          const can=await Linking.canOpenURL(url);
          if(can)await Linking.openURL(url);
          else await Share.share({message:body,title:subject});
          return;
        }
        await Share.share({message:body,title:subject});
      }catch(caught){
        Alert.alert('Share failed',caught instanceof Error?caught.message:'Please try again.');
      }
    };
    if(Platform.OS==='ios'){
      ActionSheetIOS.showActionSheetWithOptions(
        {options:['Cancel','Share text','Share email'],cancelButtonIndex:0},
        index=>{
          if(index===1)void runShare('text');
          if(index===2)void runShare('email');
        },
      );
      return;
    }
    Alert.alert('Share',subject,[
      {text:'Text',onPress:()=>void runShare('text')},
      {text:'Email',onPress:()=>void runShare('email')},
      {text:'Cancel',style:'cancel'},
    ]);
  };

  const addQual=(personId:string)=>{
    const draft=(qualDrafts[personId]??'').trim();
    if(!draft)return;
    const person=manifest.people.find(item=>item.id===personId);
    if(!person||person.additionalQuals.includes(draft))return;
    patchPerson(personId,{additionalQuals:[...person.additionalQuals,draft]});
    setQualDrafts(current=>({...current,[personId]:''}));
  };

  const canExport=manifest.people.length>0&&contactsReady&&!exportBusy;
  const prepared=new Date(manifest.preparedAt).toLocaleString('en-US',{dateStyle:'medium',timeStyle:'short'});
  const coordinatorLabel=manifest.handCrewCoordinator.name.trim()
    ?(manifest.handCrewCoordinator.phone
      ?`${manifest.handCrewCoordinator.name} · ${manifest.handCrewCoordinator.phone}`
      :manifest.handCrewCoordinator.name)
    :'Select Crew Coordinator…';
  const dispatchLabel=dispatch
    ?(dispatch.phone?`${dispatch.name} · ${dispatch.phone}`:dispatch.name)
    :'Select Dispatch Center…';

  return <SafeAreaView style={styles.safe} edges={['bottom']}>
    <Stack.Screen options={{title:'Create Manifest'}}/>
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS==='ios'?'padding':'height'}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.topBar}>
          <Text style={styles.brand}>FireCo</Text>
          <Text style={styles.prepared}>Prepared {prepared}</Text>
        </View>

        <View style={styles.fieldBlock}>
          <Text style={styles.label}>Module</Text>
          <TextInput
            accessibilityLabel="Module name"
            onChangeText={value=>setManifest(current=>({...current,moduleName:value}))}
            placeholder="FIRECO MODULE"
            placeholderTextColor={MF.muted}
            style={styles.input}
            value={manifest.moduleName}
          />
          <Text style={styles.label}>Project / incident</Text>
          <TextInput
            accessibilityLabel="Project or incident name"
            onChangeText={value=>setManifest(current=>({...current,incidentLabel:value}))}
            placeholder="e.g. Ashley NF RX Support"
            placeholderTextColor={MF.muted}
            style={styles.input}
            value={manifest.incidentLabel}
          />
        </View>

        <View style={styles.stamp}>
          {logoUri?<Image source={{uri:logoUri}} style={styles.stampLogo} resizeMode="contain"/>:null}
          <View style={styles.stampCopy}>
            <Text style={styles.stampKicker}>Company identification</Text>
            <Text style={styles.stampName}>{member?.company.name||'FireCo'}</Text>
            <Text style={styles.stampMeta} numberOfLines={2}>
              {[member?.user.name,member?.company.phone,member?.company.location||session?.user.email].filter(Boolean).join(' · ')||'Set logo & contact in Settings'}
            </Text>
          </View>
        </View>

        <Section title="Personnel" styles={styles}>
          <Pressable
            accessibilityRole="button"
            disabled={!available.length}
            onPress={()=>setPicker('roster')}
            style={({pressed})=>[styles.primaryBtn,!available.length&&styles.disabled,pressed&&styles.pressed]}
          >
            <AppSymbol name="person.badge.plus" color="#fff" size={18}/>
            <Text style={styles.primaryBtnText}>{available.length?'Add from Roster':'Everyone on Roster listed'}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={addPerson} hitSlop={8} style={styles.linkRow}>
            <Text style={styles.link}>+ Add Person</Text>
          </Pressable>

          {manifest.people.map(person=>{
            const locked=isManifestPersonIdentityLocked(person);
            const emt=emtColumnValue(person.medicMark);
            const positionOptions=MANIFEST_POSITION_OPTIONS.includes(person.position as typeof MANIFEST_POSITION_OPTIONS[number])
              ?MANIFEST_POSITION_OPTIONS
              :[person.position,...MANIFEST_POSITION_OPTIONS].filter(Boolean);
            return <View key={person.id} style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardIndex}>#{person.lineNumber}</Text>
                <Pressable accessibilityRole="button" onPress={()=>removePerson(person.id)} hitSlop={12}>
                  <Text style={styles.remove}>Remove</Text>
                </Pressable>
              </View>

              {locked?(
                <View style={styles.identity}>
                  <Text style={styles.identityName}>{person.name||'—'}</Text>
                  <Text style={styles.identityMeta}>{person.dob||'DOB —'} · {person.roleLabel||'From roster'}</Text>
                </View>
              ):(
                <View style={styles.stack}>
                  <Text style={styles.label}>Name</Text>
                  <TextInput
                    accessibilityLabel="Person name"
                    onChangeText={value=>patchPerson(person.id,{name:value})}
                    placeholder="Name as on ID"
                    placeholderTextColor={MF.muted}
                    style={styles.input}
                    value={person.name}
                  />
                  <Text style={styles.label}>DOB</Text>
                  <TextInput
                    accessibilityLabel="Date of birth"
                    onChangeText={value=>patchPerson(person.id,{dob:value})}
                    placeholder="MM/DD/YYYY"
                    placeholderTextColor={MF.muted}
                    style={styles.input}
                    value={person.dob}
                  />
                </View>
              )}

              <View style={styles.pair}>
                <View style={styles.pairCol}>
                  <Text style={styles.label}>M/F</Text>
                  <Segmented
                    accessibilityLabel={`Sex for ${person.name||'person'}`}
                    options={[{label:'—',value:''},{label:'M',value:'M'},{label:'F',value:'F'}]}
                    value={person.sex}
                    onChange={value=>patchPerson(person.id,{sex:value as CrewManifestPerson['sex']})}
                    styles={styles}
                  />
                </View>
                <View style={styles.pairCol}>
                  <Text style={styles.label}>EMT</Text>
                  <Segmented
                    accessibilityLabel={`EMT for ${person.name||'person'}`}
                    options={[{label:'Blank',value:''},{label:'Y',value:'Y'}]}
                    value={emt}
                    onChange={value=>{
                      if(value==='Y')patchPerson(person.id,{medicMark:person.medicMark==='medic'?'medic':'emt'});
                      else patchPerson(person.id,{medicMark:null});
                    }}
                    styles={styles}
                  />
                </View>
              </View>

              <Text style={styles.label}>Position</Text>
              <FilterSelect
                accessibilityLabel={`Position for ${person.name||'person'}`}
                options={positionOptions.map(option=>({label:option,value:option}))}
                value={person.position}
                onChange={value=>patchPerson(person.id,{position:value})}
              />

              <Text style={styles.label}>Quals</Text>
              <View style={styles.quals}>
                {person.additionalQuals.map(qual=>(
                  <Pressable
                    key={qual}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${qual}`}
                    onPress={()=>patchPerson(person.id,{additionalQuals:person.additionalQuals.filter(item=>item!==qual)})}
                    style={styles.qual}
                  >
                    <Text style={styles.qualText}>{qual}</Text>
                    <Text style={styles.qualX}>×</Text>
                  </Pressable>
                ))}
                {!person.additionalQuals.length?<Text style={styles.hint}>No quals yet</Text>:null}
              </View>
              <View style={styles.qualRow}>
                <TextInput
                  accessibilityLabel={`Add qualification for ${person.name||'person'}`}
                  onChangeText={value=>setQualDrafts(current=>({...current,[person.id]:value}))}
                  onSubmitEditing={()=>addQual(person.id)}
                  placeholder="Add qual"
                  placeholderTextColor={MF.muted}
                  style={[styles.input,styles.flex1]}
                  value={qualDrafts[person.id]??''}
                />
                <Pressable
                  accessibilityRole="button"
                  disabled={!(qualDrafts[person.id]??'').trim()}
                  onPress={()=>addQual(person.id)}
                  style={({pressed})=>[styles.blackBtn,!(qualDrafts[person.id]??'').trim()&&styles.disabled,pressed&&styles.pressed]}
                >
                  <Text style={styles.blackBtnText}>Add</Text>
                </Pressable>
              </View>

              <Text style={styles.label}>Phone</Text>
              <TextInput
                accessibilityLabel={`Phone for ${person.name||'person'}`}
                keyboardType="phone-pad"
                onChangeText={value=>patchPerson(person.id,{phone:value})}
                placeholder="Phone"
                placeholderTextColor={MF.muted}
                style={styles.input}
                value={person.phone}
              />

              <Text style={styles.label}>Notes</Text>
              <TextInput
                accessibilityLabel={`Notes for ${person.name||'person'}`}
                multiline
                onChangeText={value=>patchPerson(person.id,{notes:value})}
                placeholder="Notes"
                placeholderTextColor={MF.muted}
                style={[styles.input,styles.notes]}
                value={person.notes}
              />
            </View>;
          })}
          {!manifest.people.length?<Text style={styles.empty}>No personnel yet. Add from Roster or + Add Person.</Text>:null}
        </Section>

        <Section title="Vehicles" styles={styles}>
          <Text style={styles.help}>Fleet autofills Fleet ID, make, model, VIN, and plate (locked). Notes stay freeform.</Text>
          <Pressable
            accessibilityRole="button"
            disabled={!availableFleet.length}
            onPress={()=>setPicker('fleet')}
            style={({pressed})=>[styles.primaryBtn,!availableFleet.length&&styles.disabled,pressed&&styles.pressed]}
          >
            <AppSymbol name={{ios:'truck.box.fill',android:'local_shipping'} as never} color="#fff" size={18}/>
            <Text style={styles.primaryBtnText}>{availableFleet.length?'Add from fleet':'All fleet vehicles listed'}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={addManualVehicle} hitSlop={8} style={styles.linkRow}>
            <Text style={styles.link}>+ Add Vehicle</Text>
          </Pressable>

          {manifest.vehicles.map(vehicle=>(
            <VehicleCard
              key={vehicle.id}
              styles={styles}
              vehicle={vehicle}
              onChange={patch=>setManifest(current=>({
                ...current,
                vehicles:patchManifestVehicle(current.vehicles,vehicle.id,patch),
              }))}
              onRemove={()=>setManifest(current=>({
                ...current,
                vehicles:removeManifestVehicle(current.vehicles,vehicle.id),
              }))}
            />
          ))}
          {!manifest.vehicles.length?<Text style={styles.empty}>No vehicles yet.</Text>:null}
        </Section>

        <Section title="Contacts" styles={styles}>
          <Text style={styles.label}>Crew Coordinator</Text>
          <Pressable
            accessibilityRole="button"
            onPress={()=>setPicker('coordinator')}
            style={({pressed})=>[styles.selectBtn,pressed&&styles.pressed]}
          >
            <Text style={[styles.selectBtnText,!manifest.handCrewCoordinator.name.trim()&&styles.selectPlaceholder]} numberOfLines={1}>
              {coordinatorLabel}
            </Text>
            <AppSymbol name="chevron.down" color={MF.muted} size={16}/>
          </Pressable>

          <Text style={styles.label}>Dispatch Center</Text>
          <Pressable
            accessibilityRole="button"
            disabled={!manifest.dispatchCenters.length}
            onPress={()=>setPicker('dispatch')}
            style={({pressed})=>[styles.selectBtn,!manifest.dispatchCenters.length&&styles.disabled,pressed&&styles.pressed]}
          >
            <Text style={[styles.selectBtnText,!dispatch&&styles.selectPlaceholder]} numberOfLines={1}>
              {manifest.dispatchCenters.length?dispatchLabel:'Add a dispatch center below'}
            </Text>
            <AppSymbol name="chevron.down" color={MF.muted} size={16}/>
          </Pressable>

          <Text style={styles.label}>New dispatch center</Text>
          <TextInput
            accessibilityLabel="New dispatch center name"
            onChangeText={setNewDispatchName}
            placeholder="Name"
            placeholderTextColor={MF.muted}
            style={styles.input}
            value={newDispatchName}
          />
          <TextInput
            accessibilityLabel="Dispatch center phone"
            keyboardType="phone-pad"
            onChangeText={setNewDispatchPhone}
            placeholder="Phone (optional)"
            placeholderTextColor={MF.muted}
            style={styles.input}
            value={newDispatchPhone}
          />
          <Pressable
            accessibilityRole="button"
            disabled={!newDispatchName.trim()}
            onPress={addDispatch}
            style={({pressed})=>[styles.secondaryBtn,!newDispatchName.trim()&&styles.disabled,pressed&&styles.pressed]}
          >
            <Text style={styles.secondaryBtnText}>+ Add Dispatch Center</Text>
          </Pressable>
        </Section>

        <Section title="Manifest Notes" styles={styles}>
          <TextInput
            accessibilityLabel="Manifest Notes"
            multiline
            onChangeText={value=>setManifest(current=>({...current,sheetNotes:value}))}
            placeholder="Optional notes for this manifest…"
            placeholderTextColor={MF.muted}
            style={[styles.input,styles.notesTall]}
            value={manifest.sheetNotes}
          />
        </Section>

        {!contactsReady||!manifest.people.length?(
          <Text style={styles.exportHint}>
            {!manifest.people.length
              ?'Add personnel to enable Create PDF / Share.'
              :'Select Crew Coordinator and Dispatch Center to enable Create PDF / Share.'}
          </Text>
        ):null}

        <View style={styles.bottomSpacer}/>
      </ScrollView>

      <View style={styles.exportBar}>
        <Pressable
          accessibilityRole="button"
          disabled={!canExport}
          onPress={()=>void createPdf()}
          style={({pressed})=>[styles.exportPrimary,!canExport&&styles.disabled,pressed&&styles.pressed]}
        >
          <AppSymbol name="square.and.arrow.down" color="#fff" size={18}/>
          <Text style={styles.exportPrimaryText}>{exportBusy?'Working…':'Create PDF'}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={!canExport}
          onPress={shareManifest}
          style={({pressed})=>[styles.exportSecondary,!canExport&&styles.disabled,pressed&&styles.pressed]}
        >
          <Text style={styles.exportSecondaryText}>Share</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>

    <PickerSheet
      visible={picker==='roster'}
      title="Add from Roster"
      empty="Everyone on Roster is already listed."
      onClose={()=>setPicker(null)}
      styles={styles}
      data={available}
      keyExtractor={item=>item.id}
      renderItem={item=>(
        <Pressable accessibilityRole="button" onPress={()=>addFromRoster(item)} style={({pressed})=>[styles.sheetRow,pressed&&styles.pressed]}>
          <Text style={styles.sheetRowTitle}>{item.name}</Text>
          <Text style={styles.sheetRowMeta}>{item.phone||'No phone'} · {item.role}</Text>
        </Pressable>
      )}
    />
    <PickerSheet
      visible={picker==='fleet'}
      title="Add from fleet"
      empty="All fleet vehicles are already listed."
      onClose={()=>setPicker(null)}
      styles={styles}
      data={availableFleet}
      keyExtractor={item=>item.id}
      renderItem={item=>(
        <Pressable accessibilityRole="button" onPress={()=>addFromFleet(item)} style={({pressed})=>[styles.sheetRow,pressed&&styles.pressed]}>
          <Text style={styles.sheetRowTitle}>{item.firNumber||'Fleet unit'}</Text>
          <Text style={styles.sheetRowMeta}>
            {[item.make,item.model].filter(Boolean).join(' ')||'—'}{item.plate?` · ${item.plate}`:''}
          </Text>
        </Pressable>
      )}
    />
    <PickerSheet
      visible={picker==='coordinator'}
      title="Crew Coordinator"
      empty="No roster contacts available."
      onClose={()=>setPicker(null)}
      styles={styles}
      data={coordinatorOptions}
      keyExtractor={item=>item.personId||item.name}
      renderItem={(item:ManifestStaffAssignment)=>(
        <Pressable
          accessibilityRole="button"
          onPress={()=>{
            setManifest(current=>({...current,handCrewCoordinator:item}));
            setPicker(null);
          }}
          style={({pressed})=>[styles.sheetRow,pressed&&styles.pressed]}
        >
          <Text style={styles.sheetRowTitle}>{item.name}</Text>
          <Text style={styles.sheetRowMeta}>{item.phone||'No phone'}</Text>
        </Pressable>
      )}
    />
    <PickerSheet
      visible={picker==='dispatch'}
      title="Dispatch Center"
      empty="Add a dispatch center first."
      onClose={()=>setPicker(null)}
      styles={styles}
      data={manifest.dispatchCenters}
      keyExtractor={item=>item.id}
      renderItem={item=>(
        <Pressable
          accessibilityRole="button"
          onPress={()=>{
            setManifest(current=>({...current,selectedDispatchCenterId:item.id}));
            setPicker(null);
          }}
          style={({pressed})=>[styles.sheetRow,pressed&&styles.pressed]}
        >
          <Text style={styles.sheetRowTitle}>{item.name}</Text>
          <Text style={styles.sheetRowMeta}>{item.phone||'No phone'}</Text>
        </Pressable>
      )}
    />
  </SafeAreaView>;
}

function Section({title,children,styles}:{title:string;children:React.ReactNode;styles:ReturnType<typeof createStyles>}){
  return <View style={styles.section}>
    <Text style={styles.sectionTitle}>{title}</Text>
    <View style={styles.sectionBody}>{children}</View>
  </View>;
}

function Segmented({
  options,
  value,
  onChange,
  accessibilityLabel,
  styles,
}:{
  options:ReadonlyArray<{label:string;value:string}>;
  value:string;
  onChange:(value:string)=>void;
  accessibilityLabel:string;
  styles:ReturnType<typeof createStyles>;
}){
  return <View accessibilityLabel={accessibilityLabel} style={styles.segmented}>
    {options.map(option=>{
      const selected=option.value===value;
      return <Pressable
        key={option.value||'blank'}
        accessibilityRole="button"
        accessibilityState={{selected}}
        onPress={()=>onChange(option.value)}
        style={[styles.segment,selected&&styles.segmentOn]}
      >
        <Text style={[styles.segmentText,selected&&styles.segmentTextOn]}>{option.label}</Text>
      </Pressable>;
    })}
  </View>;
}

function VehicleCard({
  vehicle,
  onChange,
  onRemove,
  styles,
}:{
  vehicle:ManifestSelectedVehicle;
  onChange:(patch:Partial<Pick<ManifestSelectedVehicle,'notes'|'firNumber'|'make'|'model'|'vin'|'plate'>>)=>void;
  onRemove:()=>void;
  styles:ReturnType<typeof createStyles>;
}){
  const locked=vehicle.fromFleet;
  return <View style={styles.card}>
    <View style={styles.cardHeader}>
      <Text style={styles.cardIndex}>{locked?'Fleet':'Manual'}</Text>
      <Pressable accessibilityRole="button" onPress={onRemove} hitSlop={12}>
        <Text style={styles.remove}>Remove</Text>
      </Pressable>
    </View>
    {locked?(
      <View style={styles.lockedStack}>
        <Text style={styles.lockedTitle}>{vehicle.firNumber||'—'}</Text>
        <Text style={styles.lockedLine}>{[vehicle.make,vehicle.model].filter(Boolean).join(' ')||'—'}</Text>
        <Text style={styles.lockedLine}>Plate {vehicle.plate||'—'} · VIN {vehicle.vin||'—'}</Text>
      </View>
    ):(
      <View style={styles.stack}>
        {([
          ['firNumber','Fleet ID'],
          ['make','Make'],
          ['model','Model'],
          ['vin','VIN'],
          ['plate','License plate'],
        ] as const).map(([key,label])=>(
          <View key={key}>
            <Text style={styles.label}>{label}</Text>
            <TextInput
              accessibilityLabel={label}
              onChangeText={value=>onChange({[key]:value})}
              placeholder={label}
              placeholderTextColor={MF.muted}
              style={styles.input}
              value={vehicle[key]}
            />
          </View>
        ))}
      </View>
    )}
    <Text style={styles.label}>Notes</Text>
    <TextInput
      accessibilityLabel={`Notes for ${vehicle.firNumber||'vehicle'}`}
      multiline
      onChangeText={value=>onChange({notes:value})}
      placeholder="Notes"
      placeholderTextColor={MF.muted}
      style={[styles.input,styles.notes]}
      value={vehicle.notes}
    />
  </View>;
}

function PickerSheet<T>({
  visible,
  title,
  empty,
  onClose,
  data,
  keyExtractor,
  renderItem,
  styles,
}:{
  visible:boolean;
  title:string;
  empty:string;
  onClose:()=>void;
  data:T[];
  keyExtractor:(item:T)=>string;
  renderItem:(item:T)=>React.ReactElement;
  styles:ReturnType<typeof createStyles>;
}){
  return <Modal animationType="slide" presentationStyle="pageSheet" visible={visible} onRequestClose={onClose}>
    <SafeAreaView style={styles.modalSafe}>
      <View style={styles.modalHeader}>
        <Pressable accessibilityRole="button" onPress={onClose} hitSlop={8}>
          <Text style={styles.modalCancel}>Cancel</Text>
        </Pressable>
        <Text style={styles.modalTitle}>{title}</Text>
        <View style={styles.modalSpacer}/>
      </View>
      {data.length?(
        <FlatList
          data={data}
          keyExtractor={keyExtractor}
          contentContainerStyle={styles.modalList}
          renderItem={({item})=>renderItem(item)}
        />
      ):(
        <Text style={styles.empty}>{empty}</Text>
      )}
    </SafeAreaView>
  </Modal>;
}

function createStyles(){
  return StyleSheet.create({
    safe:{flex:1,backgroundColor:MF.wash},
    flex:{flex:1},
    content:{paddingHorizontal:16,paddingTop:8,paddingBottom:16,gap:18},
    topBar:{flexDirection:'row',alignItems:'baseline',justifyContent:'space-between'},
    brand:{color:MF.red,fontSize:13,fontWeight:'800',letterSpacing:1.2,textTransform:'uppercase'},
    prepared:{color:MF.muted,fontSize:12},
    fieldBlock:{gap:8},
    label:{color:MF.muted,fontSize:11,fontWeight:'800',letterSpacing:0.45,textTransform:'uppercase',marginTop:4},
    input:{
      minHeight:50,
      borderWidth:1,
      borderColor:MF.line,
      borderRadius:10,
      backgroundColor:MF.paper,
      paddingHorizontal:14,
      color:MF.ink,
      fontSize:17,
    },
    notes:{minHeight:72,paddingTop:14,textAlignVertical:'top'},
    notesTall:{minHeight:100,paddingTop:14,textAlignVertical:'top'},
    stamp:{
      flexDirection:'row',
      alignItems:'center',
      gap:12,
      padding:14,
      borderWidth:1,
      borderColor:MF.line,
      backgroundColor:MF.paper,
      borderRadius:10,
    },
    stampLogo:{width:44,height:44,borderRadius:8,backgroundColor:MF.wash,borderWidth:1,borderColor:MF.line},
    stampCopy:{flex:1,gap:2},
    stampKicker:{color:MF.red,fontSize:10,fontWeight:'800',letterSpacing:0.5,textTransform:'uppercase'},
    stampName:{color:MF.black,fontSize:17,fontWeight:'800'},
    stampMeta:{color:MF.muted,fontSize:12,lineHeight:16},
    section:{gap:10},
    sectionTitle:{
      color:MF.black,
      fontSize:20,
      fontWeight:'800',
      letterSpacing:-0.2,
      paddingBottom:8,
      borderBottomWidth:2,
      borderBottomColor:MF.black,
    },
    sectionBody:{gap:12},
    help:{color:MF.muted,fontSize:14,lineHeight:20,marginTop:-2},
    primaryBtn:{
      minHeight:52,
      borderRadius:10,
      backgroundColor:MF.red,
      flexDirection:'row',
      alignItems:'center',
      justifyContent:'center',
      gap:8,
      paddingHorizontal:14,
    },
    primaryBtnText:{color:'#fff',fontWeight:'800',fontSize:16},
    secondaryBtn:{
      minHeight:50,
      borderRadius:10,
      borderWidth:1,
      borderColor:MF.line,
      backgroundColor:MF.paper,
      alignItems:'center',
      justifyContent:'center',
      paddingHorizontal:14,
    },
    secondaryBtnText:{color:MF.ink,fontWeight:'700',fontSize:15},
    linkRow:{alignSelf:'flex-start',paddingVertical:2},
    link:{color:MF.red,fontWeight:'800',fontSize:16},
    card:{
      gap:10,
      padding:16,
      borderWidth:1,
      borderColor:MF.line,
      borderRadius:12,
      backgroundColor:MF.paper,
    },
    cardHeader:{flexDirection:'row',alignItems:'center',justifyContent:'space-between'},
    cardIndex:{color:MF.muted,fontSize:12,fontWeight:'800',letterSpacing:0.4,textTransform:'uppercase'},
    remove:{color:MF.red,fontWeight:'800',fontSize:15},
    identity:{gap:3,paddingBottom:2},
    identityName:{color:MF.black,fontSize:22,fontWeight:'800',letterSpacing:-0.3},
    identityMeta:{color:MF.muted,fontSize:14},
    pair:{flexDirection:'row',gap:10},
    pairCol:{flex:1,gap:6},
    stack:{gap:8},
    flex1:{flex:1},
    segmented:{flexDirection:'row',borderWidth:1,borderColor:MF.line,borderRadius:10,overflow:'hidden',backgroundColor:MF.wash},
    segment:{flex:1,minHeight:46,alignItems:'center',justifyContent:'center'},
    segmentOn:{backgroundColor:MF.black},
    segmentText:{color:MF.ink,fontWeight:'700',fontSize:15},
    segmentTextOn:{color:'#fff'},
    quals:{flexDirection:'row',flexWrap:'wrap',gap:8,minHeight:28,alignItems:'center'},
    qual:{
      flexDirection:'row',
      alignItems:'center',
      gap:4,
      borderWidth:1,
      borderColor:'#666',
      borderRadius:4,
      paddingHorizontal:10,
      paddingVertical:8,
      backgroundColor:MF.paper,
    },
    qualText:{color:MF.ink,fontWeight:'700',fontSize:14},
    qualX:{color:MF.red,fontWeight:'800',fontSize:15},
    qualRow:{flexDirection:'row',gap:8,alignItems:'center'},
    blackBtn:{
      minHeight:50,
      paddingHorizontal:16,
      borderRadius:10,
      backgroundColor:MF.black,
      alignItems:'center',
      justifyContent:'center',
    },
    blackBtnText:{color:'#fff',fontWeight:'800',fontSize:15},
    lockedStack:{gap:4,padding:12,borderRadius:10,backgroundColor:MF.wash,borderWidth:1,borderColor:MF.line},
    lockedTitle:{color:MF.black,fontSize:17,fontWeight:'800'},
    lockedLine:{color:MF.muted,fontSize:14,lineHeight:19},
    selectBtn:{
      minHeight:52,
      borderWidth:1,
      borderColor:MF.line,
      borderRadius:10,
      backgroundColor:MF.paper,
      paddingHorizontal:14,
      flexDirection:'row',
      alignItems:'center',
      justifyContent:'space-between',
      gap:10,
    },
    selectBtnText:{flex:1,color:MF.ink,fontSize:16,fontWeight:'600'},
    selectPlaceholder:{color:MF.muted,fontWeight:'500'},
    exportHint:{color:MF.muted,fontSize:13,lineHeight:18,textAlign:'center'},
    empty:{color:MF.muted,textAlign:'center',paddingVertical:16,fontSize:14},
    hint:{color:MF.muted,fontSize:13},
    disabled:{opacity:0.4},
    pressed:{opacity:0.72},
    bottomSpacer:{height:8},
    exportBar:{
      flexDirection:'row',
      gap:10,
      paddingHorizontal:16,
      paddingTop:10,
      paddingBottom:Platform.OS==='ios'?8:14,
      borderTopWidth:1,
      borderTopColor:MF.line,
      backgroundColor:MF.paper,
    },
    exportPrimary:{
      flex:1.45,
      minHeight:52,
      borderRadius:10,
      backgroundColor:MF.red,
      flexDirection:'row',
      alignItems:'center',
      justifyContent:'center',
      gap:8,
    },
    exportPrimaryText:{color:'#fff',fontWeight:'800',fontSize:16},
    exportSecondary:{
      flex:1,
      minHeight:52,
      borderRadius:10,
      borderWidth:1.5,
      borderColor:MF.black,
      backgroundColor:MF.paper,
      alignItems:'center',
      justifyContent:'center',
    },
    exportSecondaryText:{color:MF.black,fontWeight:'800',fontSize:16},
    modalSafe:{flex:1,backgroundColor:MF.wash},
    modalHeader:{
      flexDirection:'row',
      alignItems:'center',
      paddingHorizontal:16,
      paddingVertical:14,
      borderBottomWidth:1,
      borderBottomColor:MF.line,
      backgroundColor:MF.paper,
    },
    modalCancel:{color:MF.red,fontWeight:'700',fontSize:16,width:72},
    modalTitle:{flex:1,textAlign:'center',color:MF.black,fontWeight:'800',fontSize:16},
    modalSpacer:{width:72},
    modalList:{paddingBottom:40},
    sheetRow:{
      paddingHorizontal:18,
      paddingVertical:16,
      borderBottomWidth:StyleSheet.hairlineWidth,
      borderBottomColor:MF.line,
      backgroundColor:MF.paper,
      gap:3,
    },
    sheetRowTitle:{color:MF.ink,fontSize:17,fontWeight:'700'},
    sheetRowMeta:{color:MF.muted,fontSize:13},
  });
}
