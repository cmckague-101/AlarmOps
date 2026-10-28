import * as ImagePicker from 'expo-image-picker';
import {useEffect,useMemo,useState} from 'react';
import {Alert,Image,Pressable,StyleSheet,Text,View} from 'react-native';
import {userRoleLabel} from '@fireops/domain';
import {AppSymbol} from '@/components/app-symbol';
import {loadProfilePhotoPath,profilePhotoUrl,saveProfilePhoto} from '@/lib/profile-photo';
import {useSession} from '@/providers/session-provider';
import {FireOpsTheme,useFireOpsTheme} from '@/theme';

export function MyProfilePanel(){
  const {access,demoMode}=useSession();const member=access.value?.kind==='member'?access.value:null;const userId=member?.user.id;
  const theme=useFireOpsTheme();const styles=useMemo(()=>createStyles(theme),[theme]);
  const [path,setPath]=useState<string|null>(null);const [uri,setUri]=useState('');const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  useEffect(()=>{if(!userId||demoMode)return;let active=true;void loadProfilePhotoPath(userId).then(async saved=>{if(!active)return;setPath(saved);setUri(saved?await profilePhotoUrl(saved):'')}).catch(loadError=>{if(active)setError(loadError instanceof Error?loadError.message:'Profile photo could not be loaded.')});return()=>{active=false}},[demoMode,userId]);
  if(!member)return null;
  const save=async(file:{uri:string;name:string;type:string|null}|null)=>{if(!userId||busy)return;setBusy(true);setError('');try{const next=await saveProfilePhoto(userId,file,path);setPath(next);setUri(file?.uri??'')}catch(saveError){setError(saveError instanceof Error?saveError.message:'Profile photo could not be saved.')}finally{setBusy(false)}};
  const choose=async()=>{const permission=await ImagePicker.requestMediaLibraryPermissionsAsync();if(!permission.granted){Alert.alert('Photo access required','Allow photo access to upload a profile photo.');return}const result=await ImagePicker.launchImageLibraryAsync({mediaTypes:['images'],allowsEditing:true,aspect:[1,1],quality:.8});if(result.canceled)return;const asset=result.assets[0];await save({uri:asset.uri,name:asset.fileName??`profile-${Date.now()}.jpg`,type:asset.mimeType??'image/jpeg'})};
  const remove=()=>Alert.alert('Remove profile photo?','Your initials will be shown instead.',[{text:'Cancel',style:'cancel'},{text:'Remove',style:'destructive',onPress:()=>void save(null)}]);
  const initials=member.user.name.split(' ').map(part=>part[0]).filter(Boolean).slice(0,2).join('').toUpperCase();
  return <View style={styles.panel}>
    <View style={styles.row}><View style={styles.avatar}>{uri?<Image accessibilityLabel="Your profile photo" source={{uri}} style={styles.avatarImage}/>:<Text style={styles.initials}>{initials}</Text>}</View><View style={styles.copy}><Text accessibilityRole="header" style={styles.name}>{member.user.name}</Text><Text style={styles.role}>{userRoleLabel(member.user.role)}</Text></View></View>
    {demoMode?<Text style={styles.hint}>Profile photo uploads are disabled in demo mode.</Text>:<View style={styles.actions}>
      <Pressable accessibilityRole="button" disabled={busy} onPress={()=>void choose()} style={({pressed})=>[styles.button,busy&&styles.disabled,pressed&&styles.pressed]}><AppSymbol name="photo" color={theme.commandForeground} size={19}/><Text style={styles.buttonText}>{busy?'Saving…':uri?'Change photo':'Upload photo'}</Text></Pressable>
      {uri?<Pressable accessibilityRole="button" disabled={busy} onPress={remove} style={({pressed})=>[styles.remove,pressed&&styles.pressed]}><Text style={styles.removeText}>Remove</Text></Pressable>:null}
    </View>}
    {error?<Text accessibilityRole="alert" style={styles.error}>{error}</Text>:null}
  </View>;
}

function createStyles(theme:FireOpsTheme){return StyleSheet.create({panel:{backgroundColor:theme.paper,borderWidth:1,borderColor:theme.divider,borderRadius:14,padding:17,gap:14},row:{flexDirection:'row',alignItems:'center',gap:14},avatar:{width:72,height:72,borderRadius:36,overflow:'hidden',backgroundColor:theme.command,alignItems:'center',justifyContent:'center'},avatarImage:{width:'100%',height:'100%'},initials:{color:theme.commandText,fontSize:24,fontWeight:'800'},copy:{flex:1,gap:3},name:{color:theme.ink,fontSize:21,fontWeight:'800'},role:{color:theme.secondary,fontSize:13},actions:{flexDirection:'row',gap:10},button:{flex:1,minHeight:48,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:8,borderWidth:1,borderColor:theme.divider,borderRadius:10,backgroundColor:theme.canvas},buttonText:{color:theme.commandForeground,fontSize:14,fontWeight:'700'},remove:{minHeight:48,paddingHorizontal:16,alignItems:'center',justifyContent:'center'},removeText:{color:theme.danger,fontSize:14,fontWeight:'700'},hint:{color:theme.secondary,fontSize:12},error:{color:theme.danger,backgroundColor:theme.dangerSurface,borderRadius:9,padding:12,fontSize:13,lineHeight:18},disabled:{opacity:.45},pressed:{opacity:.65}})}
