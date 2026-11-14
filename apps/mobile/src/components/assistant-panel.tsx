import {useEffect,useRef} from 'react';
import {Alert,Animated,Easing,Image,KeyboardAvoidingView,Modal,Platform,Pressable,ScrollView,StyleSheet,Text,TextInput,View,AccessibilityInfo,type ScrollViewInstance} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {router} from 'expo-router';
import {
  ASSISTANT_OFFLINE,ASSISTANT_ROUTE_LABELS,ASSISTANT_SUGGESTIONS,assistantDraftLabel,assistantMobileHref,formatAssistantThreadTime,
  type AssistantChatItem,type AssistantDraft,
} from '@fireops/domain';
import {AppSymbol} from '@/components/app-symbol';
import {useAssistant} from '@/providers/assistant-provider';
import {useFireOpsTheme,type FireOpsTheme} from '@/theme';

const MASCOT=require('../../assets/images/assistant-mascot.png');
const CHARCOAL='#121417';

/** The flame mascot with a gentle hop every few seconds (still when Reduce Motion is on). */
function Mascot({size}:{size:number}){
  const hop=useRef(new Animated.Value(0)).current;
  useEffect(()=>{
    let loop:Animated.CompositeAnimation|null=null;
    let cancelled=false;
    void AccessibilityInfo.isReduceMotionEnabled().then(reduce=>{
      if(reduce||cancelled)return;
      loop=Animated.loop(Animated.sequence([
        Animated.timing(hop,{toValue:1,duration:300,easing:Easing.out(Easing.quad),useNativeDriver:true}),
        Animated.timing(hop,{toValue:0,duration:500,easing:Easing.bounce,useNativeDriver:true}),
        Animated.delay(2200),
      ]));
      loop.start();
    }).catch(()=>{});
    return()=>{cancelled=true;loop?.stop()};
  },[hop]);
  const translateY=hop.interpolate({inputRange:[0,1],outputRange:[0,-size*0.16]});
  return <Animated.View style={{transform:[{translateY}]}}>
    <Image source={MASCOT} style={{width:size,height:size,resizeMode:'contain'}} accessibilityIgnoresInvertColors/>
  </Animated.View>;
}

/** Floating FireOps Assistant button and chat sheet, shown on the main tabs when the company has the add-on. */
export function AssistantHost(){
  const theme=useFireOpsTheme();
  const insets=useSafeAreaInsets();
  const styles=createStyles(theme);
  const scrollRef=useRef<ScrollViewInstance>(null);
  const {
    voiceEnabled,phase,talk,endVoice,finishListening,enabled,offline,autofillEnabled,user,open,setOpen,view,setView,messages,threads,threadId,busy,error,input,setInput,
    send,startNewChat,openThread,removeThread,clearAll,
  }=useAssistant();
  if(!enabled||!user)return null;

  const go=(href:string,params?:Record<string,string>)=>{setOpen(false);router.push((params?{pathname:href,params}:href) as never)};
  const openDraft=(draft:AssistantDraft)=>{
    if(draft.kind==='invoice')go('/invoices',{assistant:autofillEnabled?'scan':'new'});
    else if(draft.kind==='receipt')go('/receipt/capture');
    else go('/tasks',{assistantDraft:String(Date.now()),subject:draft.subject,description:draft.description,dueDate:draft.dueDate});
  };
  const confirmClear=()=>Alert.alert('Delete all chats?','This removes every assistant chat saved on this phone.',[{text:'Cancel',style:'cancel'},{text:'Delete all',style:'destructive',onPress:clearAll}]);

  const bubble=(item:AssistantChatItem)=>{
    const href=item.role==='assistant'?assistantMobileHref(item.navigate,user.role):null;
    return <View key={item.id} style={[styles.bubble,item.role==='user'?styles.userBubble:styles.assistantBubble]}>
      <Text selectable style={item.role==='user'?styles.userText:styles.assistantText}>{item.text}</Text>
      {href||item.draft?<View style={styles.actions}>
        {href&&item.navigate?<Pressable accessibilityRole="button" onPress={()=>go(href)} style={styles.action}><Text style={styles.actionText}>Open {ASSISTANT_ROUTE_LABELS[item.navigate]} →</Text></Pressable>:null}
        {item.draft?<Pressable accessibilityRole="button" onPress={()=>openDraft(item.draft!)} style={[styles.action,styles.actionPrimary]}><Text style={styles.actionPrimaryText}>{assistantDraftLabel(item.draft,autofillEnabled)}</Text></Pressable>:null}
      </View>:null}
    </View>;
  };

  return <>
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={offline?'FireOps Assistant, needs a network connection':'Open FireOps Assistant'}
      onPress={()=>setOpen(true)}
      style={[styles.fab,{bottom:Math.max(insets.bottom,8)+58},offline&&styles.fabOffline]}
    >
      <Mascot size={76}/>
      {offline?<View style={styles.offlineBadge}><AppSymbol name={{ios:'wifi.slash',android:'wifi_off'} as never} color={theme.danger} size={12}/></View>:null}
    </Pressable>

    <Modal visible={open} animationType="slide" transparent onRequestClose={()=>setOpen(false)}>
      <KeyboardAvoidingView style={styles.modalRoot} behavior={Platform.OS==='ios'?'padding':undefined}>
        <Pressable accessibilityLabel="Close assistant" style={styles.backdrop} onPress={()=>setOpen(false)}/>
        <View style={[styles.sheet,{paddingBottom:Math.max(insets.bottom,12)}]}>
          <View style={styles.header}>
            <Mascot size={36}/>
            <View style={styles.headerCopy}>
              <Text accessibilityRole="header" style={styles.headerTitle}>FireOps Assistant</Text>
              <Text style={styles.headerMeta}>{view==='history'?'Saved on this phone':offline?ASSISTANT_OFFLINE:'Ask about FireOps and your company'}</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel={view==='history'?'Back to chat':'Chat history'} disabled={phase!=='idle'} onPress={()=>setView(view==='history'?'chat':'history')} style={styles.headerBtn}>
              <AppSymbol name={{ios:'clock.arrow.circlepath',android:'history'} as never} color="#F7F8F6" size={18}/>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="New chat" onPress={startNewChat} style={styles.headerBtn}>
              <AppSymbol name={{ios:'plus',android:'add'} as never} color="#F7F8F6" size={18}/>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Close assistant" onPress={()=>setOpen(false)} style={styles.headerBtn}>
              <AppSymbol name={{ios:'xmark',android:'close'} as never} color="#F7F8F6" size={18}/>
            </Pressable>
          </View>

          {view==='history'?<ScrollView contentContainerStyle={styles.history}>
            <View style={styles.historyToolbar}>
              <Text style={styles.historyCount}>{threads.length?`${threads.length} saved chat${threads.length===1?'':'s'}`:'No saved chats yet'}</Text>
              <Pressable accessibilityRole="button" disabled={!threads.length} onPress={confirmClear} style={[styles.resetBtn,!threads.length&&styles.disabled]}>
                <Text style={styles.resetText}>Delete all</Text>
              </Pressable>
            </View>
            {!threads.length?<Text style={styles.historyEmpty}>Chats are saved on this phone only, so you can reopen them later. No one else can see them.</Text>:null}
            {threads.map(thread=><View key={thread.id} style={styles.historyRow}>
              <Pressable accessibilityRole="button" onPress={()=>openThread(thread)} style={[styles.historyItem,thread.id===threadId&&styles.historyItemActive]}>
                <Text style={styles.historyTitle} numberOfLines={1}>{thread.title}</Text>
                <Text style={styles.historyMeta}>{formatAssistantThreadTime(thread.updatedAt)} · {thread.messages.filter(item=>item.id!=='welcome').length} messages</Text>
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel={`Delete ${thread.title}`} onPress={()=>removeThread(thread.id)} style={styles.historyDelete}>
                <AppSymbol name={{ios:'trash',android:'delete'} as never} color={theme.danger} size={18}/>
              </Pressable>
            </View>)}
          </ScrollView>:<ScrollView ref={scrollRef} contentContainerStyle={styles.messages} keyboardShouldPersistTaps="handled" onContentSizeChange={()=>scrollRef.current?.scrollToEnd({animated:true})}>
            {messages.map(bubble)}
            {messages.length<=1&&!offline?<View style={styles.chips}>
              {ASSISTANT_SUGGESTIONS.map(suggestion=><Pressable key={suggestion} accessibilityRole="button" disabled={busy||phase!=='idle'} onPress={()=>void send(suggestion)} style={styles.chip}>
                <Text style={styles.chipText}>{suggestion}</Text>
              </Pressable>)}
            </View>:null}
            {busy?<View style={[styles.bubble,styles.assistantBubble]}><Text accessibilityLiveRegion="polite" style={styles.assistantText}>Thinking…</Text></View>:null}
            {error?<Text accessibilityRole="alert" style={styles.error}>{error}</Text>:null}
          </ScrollView>}

          {view==='chat'?<View style={styles.composer}>
            {offline?<View style={styles.offline}><AppSymbol name={{ios:'wifi.slash',android:'wifi_off'} as never} color={theme.danger} size={16}/><Text style={styles.offlineText}>{ASSISTANT_OFFLINE}</Text></View>:null}
            {phase!=='idle'?<View style={styles.row}><Text style={styles.hint}>{phase==='listening'?'Listening':phase==='thinking'?'Thinking':'Speaking'}</Text><Pressable onPress={endVoice}><Text style={styles.error}>End</Text></Pressable>{phase==='listening'?<Pressable onPress={finishListening}><Text style={styles.hint}>Done talking</Text></Pressable>:null}</View>:null}
            <View style={styles.row}>
              {voiceEnabled?<Pressable accessibilityRole="button" accessibilityLabel="Talk to assistant" disabled={offline||busy&&phase==='idle'} onPress={()=>void talk()} style={styles.send}><AppSymbol name={{ios:'mic.fill',android:'mic'} as never} color="#fff" size={18}/></Pressable>:null}
              <TextInput
                value={input}
                onChangeText={setInput}
                placeholder={offline?'Needs a network connection':'Ask the assistant…'}
                placeholderTextColor={theme.secondary}
                editable={!offline&&phase==='idle'}
                maxLength={2000}
                returnKeyType="send"
                enablesReturnKeyAutomatically
                onSubmitEditing={()=>void send(input)}
                accessibilityLabel="Message the FireOps Assistant"
                style={styles.input}
              />
              <Pressable accessibilityRole="button" accessibilityLabel="Send" disabled={busy||phase!=='idle'||offline||!input.trim()} onPress={()=>void send(input)} style={[styles.send,(busy||offline||!input.trim())&&styles.disabled]}>
                <AppSymbol name={{ios:'paperplane.fill',android:'send'} as never} color="#fff" size={18}/>
              </Pressable>
            </View>
            <Text style={styles.hint}>The assistant can make mistakes. It never saves or submits anything; you review drafts first.</Text>
          </View>:null}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  </>;
}

function createStyles(theme:FireOpsTheme){
  return StyleSheet.create({
    fab:{position:'absolute',right:14,zIndex:40,width:88,height:88,alignItems:'center',justifyContent:'center'},
    fabOffline:{opacity:.7},
    offlineBadge:{position:'absolute',right:2,bottom:2,width:22,height:22,borderRadius:11,alignItems:'center',justifyContent:'center',backgroundColor:theme.paper},
    modalRoot:{flex:1,justifyContent:'flex-end'},
    backdrop:{position:'absolute',top:0,right:0,bottom:0,left:0,backgroundColor:'rgba(12,20,16,0.42)'},
    sheet:{maxHeight:'88%',backgroundColor:theme.paper,borderTopLeftRadius:18,borderTopRightRadius:18,overflow:'hidden'},
    header:{flexDirection:'row',alignItems:'center',gap:10,paddingHorizontal:14,paddingVertical:14,backgroundColor:CHARCOAL},
    headerCopy:{flex:1,gap:2},
    headerTitle:{color:'#fff',fontWeight:'800',fontSize:17},
    headerMeta:{color:'#C5CEC8',fontSize:11},
    headerBtn:{width:40,height:40,borderRadius:20,alignItems:'center',justifyContent:'center',backgroundColor:'rgba(255,255,255,0.14)'},
    messages:{padding:16,gap:12,paddingBottom:24},
    bubble:{maxWidth:'92%',paddingHorizontal:13,paddingVertical:11,borderRadius:14},
    assistantBubble:{alignSelf:'flex-start',backgroundColor:CHARCOAL},
    userBubble:{alignSelf:'flex-end',backgroundColor:theme.surfaceAlt,borderWidth:1,borderColor:theme.divider},
    assistantText:{color:'#F4F6F4',fontSize:15,lineHeight:21},
    userText:{color:theme.ink,fontSize:15,lineHeight:21},
    actions:{flexDirection:'row',flexWrap:'wrap',gap:8,marginTop:10},
    action:{minHeight:40,justifyContent:'center',paddingHorizontal:12,borderRadius:10,borderWidth:1,borderColor:'#46525E'},
    actionText:{color:'#F7F8F6',fontSize:13,fontWeight:'800'},
    actionPrimary:{backgroundColor:theme.ember,borderColor:theme.ember},
    actionPrimaryText:{color:'#fff',fontSize:13,fontWeight:'800'},
    chips:{flexDirection:'row',flexWrap:'wrap',gap:8},
    chip:{borderWidth:1,borderColor:theme.divider,borderRadius:999,backgroundColor:theme.paper,paddingHorizontal:12,paddingVertical:9},
    chipText:{color:theme.ink,fontSize:13,fontWeight:'700'},
    error:{color:theme.danger,fontSize:13,fontWeight:'600'},
    composer:{gap:8,paddingHorizontal:14,paddingTop:12,borderTopWidth:1,borderTopColor:theme.divider,backgroundColor:theme.paper},
    offline:{flexDirection:'row',alignItems:'center',gap:8,padding:10,borderRadius:10,backgroundColor:theme.surfaceAlt},
    offlineText:{color:theme.ink,fontSize:13,fontWeight:'700'},
    row:{flexDirection:'row',gap:8},
    input:{flex:1,minHeight:48,borderWidth:1,borderColor:theme.divider,borderRadius:12,paddingHorizontal:12,paddingVertical:10,color:theme.ink,backgroundColor:theme.canvas,fontSize:16},
    send:{width:52,minHeight:48,alignItems:'center',justifyContent:'center',borderRadius:12,backgroundColor:theme.ember},
    disabled:{opacity:0.45},
    hint:{color:theme.secondary,fontSize:11,lineHeight:15},
    history:{padding:16,gap:10,paddingBottom:28},
    historyToolbar:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:10},
    historyCount:{color:theme.secondary,fontSize:12,fontWeight:'700'},
    resetBtn:{minHeight:36,justifyContent:'center',paddingHorizontal:10,borderRadius:10,borderWidth:1,borderColor:theme.divider},
    resetText:{color:theme.danger,fontSize:12,fontWeight:'700'},
    historyEmpty:{color:theme.secondary,fontSize:14,lineHeight:20},
    historyRow:{flexDirection:'row',gap:6},
    historyItem:{flex:1,gap:4,borderWidth:1,borderColor:theme.divider,borderRadius:12,backgroundColor:theme.paper,paddingHorizontal:12,paddingVertical:11},
    historyItemActive:{borderColor:theme.ember},
    historyTitle:{color:theme.ink,fontSize:14,fontWeight:'700'},
    historyMeta:{color:theme.secondary,fontSize:11},
    historyDelete:{width:44,alignItems:'center',justifyContent:'center',borderWidth:1,borderColor:theme.divider,borderRadius:12,backgroundColor:theme.paper},
  });
}
