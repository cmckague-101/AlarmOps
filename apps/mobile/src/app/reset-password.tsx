import {useEffect,useState} from 'react';
import * as Linking from 'expo-linking';
import {KeyboardAvoidingView,Platform,Pressable,ScrollView,StyleSheet,Text,View} from 'react-native';
import {router} from 'expo-router';
import {FormField} from '@/components/form-field';
import {completeAuthLink} from '@/lib/auth-link';
import {supabase} from '@/lib/supabase';
import {useFireOpsTheme} from '@/theme';

export default function ResetPassword(){
  const theme=useFireOpsTheme();const url=Linking.useURL();const [verified,setVerified]=useState(false);const [password,setPassword]=useState('');const [confirm,setConfirm]=useState('');const [error,setError]=useState('');const [busy,setBusy]=useState(false);
  useEffect(()=>{if(!url)return;let active=true;void completeAuthLink(url).then(result=>{if(!active)return;if(result.error)setError('Reset link is invalid or expired. Request a new one.');else setVerified(true)});return()=>{active=false}},[url]);
  const submit=async()=>{if(!supabase||busy)return;if(password.length<10){setError('Password must be at least 10 characters.');return}if(password!==confirm){setError('Passwords do not match.');return}setBusy(true);setError('');const {error:updateError}=await supabase.auth.updateUser({password});if(updateError){setError(updateError.message);setBusy(false);return}router.replace('/')};
  return <KeyboardAvoidingView style={[styles.flex,{backgroundColor:theme.canvas}]} behavior={Platform.OS==='ios'?'padding':'height'}><ScrollView automaticallyAdjustKeyboardInsets contentContainerStyle={styles.screen} keyboardDismissMode={Platform.OS==='ios'?'interactive':'on-drag'} keyboardShouldPersistTaps="handled"><View style={[styles.panel,{backgroundColor:theme.paper,borderColor:theme.divider}]}>
    <Text accessibilityRole="header" style={[styles.title,{color:theme.ink}]}>Choose new password</Text>
    {!verified?<Text style={[styles.copy,{color:error?theme.danger:theme.secondary}]}>{error||'Verifying secure link…'}</Text>:<>
      <Text style={[styles.copy,{color:theme.secondary}]}>Use at least 10 characters.</Text><View style={styles.fields}>
        <FormField label="New password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password"/>
        <FormField label="Confirm password" value={confirm} onChangeText={setConfirm} secureTextEntry autoComplete="new-password" onSubmitEditing={()=>void submit()}/>
      </View>{error&&<Text accessibilityRole="alert" style={[styles.error,{color:theme.danger,backgroundColor:theme.dangerSurface}]}>{error}</Text>}
      <Pressable accessibilityRole="button" disabled={busy} onPress={()=>void submit()} style={({pressed})=>[styles.button,{backgroundColor:pressed?theme.emberPressed:theme.ember},busy&&styles.disabled]}><Text style={styles.buttonLabel}>{busy?'Saving…':'Save password'}</Text></Pressable>
    </>}
  </View></ScrollView></KeyboardAvoidingView>;
}
const styles=StyleSheet.create({flex:{flex:1},screen:{flexGrow:1,padding:20,justifyContent:'center'},panel:{width:'100%',maxWidth:440,alignSelf:'center',borderWidth:1,borderRadius:16,padding:22},title:{fontSize:26,fontWeight:'800'},copy:{fontSize:16,lineHeight:23,marginTop:8},fields:{gap:16,marginTop:22,marginBottom:16},error:{padding:12,borderRadius:8,fontSize:14,lineHeight:20,marginBottom:14},button:{minHeight:50,borderRadius:9,justifyContent:'center',alignItems:'center'},buttonLabel:{color:'#fff',fontSize:16,fontWeight:'800'},disabled:{opacity:.6}});
