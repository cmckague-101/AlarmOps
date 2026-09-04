import {useState} from 'react';
import {Pressable,StyleSheet,Text,View} from 'react-native';
import {Redirect,router} from 'expo-router';
import {AuthScreen} from '@/components/auth-screen';
import {FormField} from '@/components/form-field';
import {useSession} from '@/providers/session-provider';
import {supabase} from '@/lib/supabase';
import {useFireOpsTheme} from '@/theme';

export default function SignIn(){
  const theme=useFireOpsTheme();
  const {session}=useSession();
  const [email,setEmail]=useState('');const [password,setPassword]=useState('');const [error,setError]=useState('');const [busy,setBusy]=useState(false);
  if(session)return <Redirect href="/"/>;
  const submit=async()=>{
    if(!supabase||busy)return;
    if(!email.trim()||!password){setError('Enter email and password.');return}
    setBusy(true);setError('');
    const {error:signInError}=await supabase.auth.signInWithPassword({email:email.trim(),password});
    if(signInError){setError(signInError.message==='Invalid login credentials'?'Email or password is incorrect.':signInError.message);setBusy(false);return}
    router.replace('/');
  };
  return <AuthScreen>
    <Text accessibilityRole="header" style={[styles.title,{color:theme.ink}]}>Sign in</Text>
    <Text style={[styles.intro,{color:theme.secondary}]}>Use your invited FireOps account.</Text>
    <View style={styles.fields}>
      <FormField label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" textContentType="emailAddress" autoComplete="email" returnKeyType="next"/>
      <FormField label="Password" value={password} onChangeText={setPassword} secureTextEntry textContentType="password" autoComplete="current-password" returnKeyType="go" onSubmitEditing={()=>void submit()}/>
    </View>
    <Pressable accessibilityRole="link" onPress={()=>router.push('/forgot-password')} style={styles.link}><Text style={[styles.linkLabel,{color:theme.ember}]}>Forgot password?</Text></Pressable>
    {error&&<Text accessibilityRole="alert" style={[styles.error,{backgroundColor:theme.dangerSurface,color:theme.danger}]}>{error}</Text>}
    <Pressable accessibilityRole="button" accessibilityState={{disabled:busy}} disabled={busy} onPress={()=>void submit()} style={({pressed})=>[styles.button,{backgroundColor:pressed?theme.emberPressed:theme.ember},busy&&styles.disabled]}><Text style={styles.buttonLabel}>{busy?'Signing in…':'Sign in'}</Text></Pressable>
  </AuthScreen>;
}
const styles=StyleSheet.create({title:{fontSize:28,fontWeight:'800',letterSpacing:-0.5},intro:{fontSize:16,lineHeight:23,marginTop:6},fields:{gap:16,marginTop:24},link:{minHeight:44,alignSelf:'flex-start',justifyContent:'center'},linkLabel:{fontSize:15,fontWeight:'700'},error:{padding:12,borderRadius:8,fontSize:14,lineHeight:20,marginBottom:14},button:{minHeight:50,borderRadius:9,alignItems:'center',justifyContent:'center'},buttonLabel:{color:'#FFFFFF',fontSize:16,fontWeight:'800'},disabled:{opacity:.6}});
