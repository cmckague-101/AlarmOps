import {useState} from 'react';
import {Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import {Redirect, Stack} from 'expo-router';
import DateTimePicker from '@react-native-community/datetimepicker';
import {SafeAreaView} from 'react-native-safe-area-context';
import {canManagePersonalTasks} from '@fireops/domain';
import {useSession} from '@/providers/session-provider';
import {usePersonalTasks} from '@/lib/use-personal-tasks';
import {FormField} from '@/components/form-field';
import {useFireOpsTheme} from '@/theme';

export default function TasksScreen() {
  const {session,access} = useSession();
  const member = access.value?.kind==='member'?access.value:null;
  const allowed = member && canManagePersonalTasks(member.user.role);
  const theme = useFireOpsTheme();
  const {tasks,loading,busy,error,save,remove,retry,connected} = usePersonalTasks(allowed?member.company.id:undefined,allowed?member.user.id:undefined);
  const [subject,setSubject] = useState('');
  const [description,setDescription] = useState('');
  const [dueDate,setDueDate] = useState('');
  const [pickerOpen,setPickerOpen] = useState(false);
  const styles = StyleSheet.create({safe:{flex:1,backgroundColor:theme.canvas},content:{padding:20,paddingBottom:48,gap:20},title:{color:theme.ink,fontSize:30,fontWeight:'800'},copy:{color:theme.secondary,fontSize:16,lineHeight:23},card:{padding:18,gap:16,borderWidth:1,borderColor:theme.divider,borderRadius:16,backgroundColor:theme.paper},heading:{color:theme.ink,fontSize:20,fontWeight:'800'},body:{color:theme.ink,fontSize:16,lineHeight:24},button:{minHeight:48,padding:13,borderRadius:10,alignItems:'center',justifyContent:'center',backgroundColor:theme.ember},buttonText:{color:'#fff',fontWeight:'800',fontSize:16},secondary:{backgroundColor:theme.surfaceAlt},secondaryText:{color:theme.ink,fontWeight:'700',fontSize:16},disabled:{opacity:.5},error:{color:theme.danger,fontSize:16},actions:{gap:10}});
  async function submit() {
    if(await save({subject,description,dueDate})){setSubject('');setDescription('');setDueDate('');setPickerOpen(false);}
  }
  if (!session || access.status==='error') return <Redirect href="/"/>;
  if (!allowed) return <SafeAreaView style={styles.safe}><Text style={styles.copy}>Task List is available to owners, admins, and techs.</Text></SafeAreaView>;
  return <SafeAreaView style={styles.safe} edges={['bottom']}><Stack.Screen options={{title:'Task List'}}/><KeyboardAvoidingView style={{flex:1}} behavior={Platform.OS==='ios'?'padding':undefined}><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
    <Text accessibilityRole="header" style={styles.title}>Task List</Text><Text style={styles.copy}>Your personal tasks. Completing a task removes it permanently.</Text>
    {error&&<View><Text accessibilityRole="alert" style={styles.error}>{error}</Text><Pressable accessibilityRole="button" disabled={busy} style={[styles.button,styles.secondary]} onPress={retry}><Text style={styles.secondaryText}>Retry</Text></Pressable></View>}
    <View style={styles.card}><Text accessibilityRole="header" style={styles.heading}>New task</Text>
      <FormField label="Subject" value={subject} onChangeText={setSubject} maxLength={200} editable={!busy&&connected}/>
      <FormField label="Description" value={description} onChangeText={setDescription} maxLength={5000} multiline editable={!busy&&connected} style={{minHeight:110,paddingTop:12,textAlignVertical:'top'}}/>
      <Text style={styles.copy}>Due date</Text><Pressable accessibilityRole="button" accessibilityLabel="Select due date" disabled={busy} style={[styles.button,styles.secondary]} onPress={()=>setPickerOpen(value=>!value)}><Text style={styles.secondaryText}>{dueDate?new Date(`${dueDate}T12:00:00`).toLocaleDateString():'Select due date'}</Text></Pressable>
      {pickerOpen&&<><DateTimePicker value={dueDate?new Date(`${dueDate}T12:00:00`):new Date()} mode="date" display={Platform.OS==='ios'?'inline':'default'} onChange={(event,date)=>{if(Platform.OS!=='ios')setPickerOpen(false);if(event.type==='set'&&date)setDueDate(`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`)}}/>{Platform.OS==='ios'&&<Pressable accessibilityRole="button" style={[styles.button,styles.secondary]} onPress={()=>setPickerOpen(false)}><Text style={styles.secondaryText}>Done</Text></Pressable>}</>}
      <Pressable accessibilityRole="button" disabled={busy||!connected} style={[styles.button,(busy||!connected)&&styles.disabled]} onPress={()=>void submit()}><Text style={styles.buttonText}>{busy?'Saving…':'Save task'}</Text></Pressable>
    </View>
    {loading?<Text style={styles.copy}>Loading tasks…</Text>:<>{tasks.map(task=><View key={task.id} style={styles.card}><Text accessibilityRole="header" style={styles.heading}>{task.subject}</Text><Text style={styles.copy}>Due {new Date(`${task.due_date}T12:00:00`).toLocaleDateString()}</Text>{task.description?<Text style={styles.body}>{task.description}</Text>:null}<View style={styles.actions}><Pressable accessibilityRole="button" accessibilityLabel={`Mark ${task.subject} as completed`} disabled={busy} style={[styles.button,busy&&styles.disabled]} onPress={()=>void remove(task.id)}><Text style={styles.buttonText}>Mark completed</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel={`Delete ${task.subject}`} disabled={busy} style={[styles.button,styles.secondary,busy&&styles.disabled]} onPress={()=>Alert.alert('Delete task?',task.subject,[{text:'Cancel',style:'cancel'},{text:'Delete',style:'destructive',onPress:()=>void remove(task.id)}])}><Text style={styles.secondaryText}>Delete</Text></Pressable></View></View>)}{connected&&!error&&!tasks.length&&<Text style={styles.copy}>No tasks yet. Create one above.</Text>}</>}
  </ScrollView></KeyboardAvoidingView></SafeAreaView>;
}
