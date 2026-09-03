import {useState} from 'react';
import * as Linking from 'expo-linking';
import {Pressable,StyleSheet,Text,View} from 'react-native';
import {FormField} from '@/components/form-field';
import {supabase} from '@/lib/supabase';
import {useFireOpsTheme} from '@/theme';

export default function ForgotPassword(){
  const theme=useFireOpsTheme();const [email,setEmail]=useState('');const [error,setError]=useState('');const [sent,setSent]=useState(false);const [busy,setBusy]=useState(false);
  const submit=async()=>{if(!supabase||busy)return;if(!email.trim()){setError('Enter your account email.');return}setBusy(true);setError('');const {error:resetError}=await supabase.auth.resetPasswordForEmail(email.trim(),{redirectTo:Linking.createURL('/reset-password')});if(resetError){setError(resetError.message);setBusy(false);return}setSent(true);setBusy(false)};
  return <View style={[styles.screen,{backgroundColor:theme.canvas}]}><View style={[styles.panel,{backgroundColor:theme.paper,borderColor:theme.divider}]}>
    <Text accessibilityRole="header" style={[styles.title,{color:theme.ink}]}>Reset password</Text>
    {sent?<Text accessibilityRole="alert" style={[styles.copy,{color:theme.secondary}]}>If an account exists for {email.trim()}, a reset link is on its way. Check inbox and spam.</Text>:<>
      <Text style={[styles.copy,{color:theme.secondary}]}>Enter email used for your invited FireOps account.</Text>
      <View style={styles.field}><FormField label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" autoComplete="email" onSubmitEditing={()=>void submit()}/></View>
      {error&&<Text accessibilityRole="alert" style={[styles.error,{color:theme.danger,backgroundColor:theme.dangerSurface}]}>{error}</Text>}
      <Pressable accessibilityRole="button" disabled={busy} onPress={()=>void submit()} style={({pressed})=>[styles.button,{backgroundColor:pressed?theme.emberPressed:theme.ember},busy&&styles.disabled]}><Text style={styles.buttonLabel}>{busy?'Sending…':'Send reset link'}</Text></Pressable>
    </>}
  </View></View>;
}
const styles=StyleSheet.create({screen:{flex:1,padding:20,justifyContent:'center'},panel:{width:'100%',maxWidth:440,alignSelf:'center',borderWidth:1,borderRadius:16,padding:22},title:{fontSize:26,fontWeight:'800'},copy:{fontSize:16,lineHeight:23,marginTop:8},field:{marginTop:22,marginBottom:16},error:{padding:12,borderRadius:8,fontSize:14,lineHeight:20,marginBottom:14},button:{minHeight:50,borderRadius:9,justifyContent:'center',alignItems:'center'},buttonLabel:{color:'#fff',fontSize:16,fontWeight:'800'},disabled:{opacity:.6}});
