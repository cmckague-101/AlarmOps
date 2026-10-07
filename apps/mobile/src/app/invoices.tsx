import {useEffect,useMemo,useState} from 'react';
import {Pressable,StyleSheet,Text,View} from 'react-native';
import {InvoiceGeneratorScreen} from '@/components/invoice-generator-screen';
import {StoredDocumentsScreen} from '@/components/stored-documents-screen';
import {openFleetFile} from '@/lib/fleet-files';
import {useSession} from '@/providers/session-provider';
import {FireOpsTheme,useFireOpsTheme} from '@/theme';

export default function Screen() {
  const theme=useFireOpsTheme();
  const styles=useMemo(()=>createStyles(theme),[theme]);
  const {access}=useSession();
  const member=access.value?.kind==='member'?access.value:null;
  const isOwner=member?.user.role==='owner';
  const [generatorOpen,setGeneratorOpen]=useState(false);
  const logoPath=member?.company.logoPath;
  const [loadedLogo,setLoadedLogo]=useState({path:'',uri:''});
  useEffect(()=>{
    if(!logoPath)return;
    let active=true;
    void openFleetFile({name:'Company logo',type:'image/*',path:logoPath}).then(uri=>{if(active)setLoadedLogo({path:logoPath,uri})}).catch(()=>{if(active)setLoadedLogo({path:logoPath,uri:''})});
    return()=>{active=false};
  },[logoPath]);
  const logoUri=loadedLogo.path===logoPath?loadedLogo.uri:'';
  if(generatorOpen&&isOwner)return <InvoiceGeneratorScreen companyLogoUri={logoUri} onBack={()=>setGeneratorOpen(false)}/>;
  return <View style={styles.screen}>
    {isOwner?<View style={styles.generatorCard}><View style={styles.copy}><Text style={styles.title}>Invoice Generator</Text><Text style={styles.subtitle}>Build a custom invoice and generate a PDF.</Text></View><Pressable accessibilityRole="button" onPress={()=>setGeneratorOpen(true)} style={({pressed})=>[styles.button,pressed&&styles.pressed]}><Text style={styles.buttonText}>Create invoice</Text></Pressable></View>:null}
    <View style={styles.documents}><StoredDocumentsScreen kind="invoices"/></View>
  </View>;
}
function createStyles(theme:FireOpsTheme){return StyleSheet.create({screen:{flex:1,backgroundColor:theme.canvas},generatorCard:{marginHorizontal:20,marginTop:16,padding:16,borderWidth:1,borderColor:theme.divider,borderRadius:14,backgroundColor:theme.paper,flexDirection:'row',alignItems:'center',gap:14},copy:{flex:1},title:{color:theme.ink,fontSize:17,fontWeight:'800'},subtitle:{color:theme.secondary,fontSize:12,lineHeight:17,marginTop:3},button:{backgroundColor:theme.ember,borderRadius:8,paddingHorizontal:14,paddingVertical:10},buttonText:{color:'#fff',fontSize:13,fontWeight:'800'},pressed:{opacity:.7},documents:{flex:1}})}
