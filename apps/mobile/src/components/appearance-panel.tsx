import {useMemo} from 'react';
import {Pressable,StyleSheet,Text,View} from 'react-native';
import {THEME_PREFERENCE_LABELS,THEME_PREFERENCES} from '@/lib/theme-preference';
import {type FireOpsTheme,useFireOpsTheme,useThemePreference} from '@/theme';

/** Settings: System / Light / Dark, saved on this device. */
export function AppearancePanel(){
  const theme=useFireOpsTheme();const styles=useMemo(()=>createStyles(theme),[theme]);
  const {preference,setPreference}=useThemePreference();
  return <View style={styles.panel}>
    <View style={styles.copy}><Text accessibilityRole="header" style={styles.title}>Appearance</Text><Text style={styles.subtitle}>Use light or dark mode on this device, or follow your device setting.</Text></View>
    <View accessibilityRole="radiogroup" accessibilityLabel="Appearance" style={styles.segments}>
      {THEME_PREFERENCES.map(option=>{
        const selected=option===preference;
        return <Pressable key={option} accessibilityRole="radio" accessibilityState={{checked:selected}} accessibilityLabel={THEME_PREFERENCE_LABELS[option]} onPress={()=>setPreference(option)} style={({pressed})=>[styles.segment,selected&&styles.segmentSelected,pressed&&!selected&&styles.segmentPressed]}>
          <Text style={[styles.segmentText,selected&&styles.segmentTextSelected]}>{THEME_PREFERENCE_LABELS[option]}</Text>
        </Pressable>;
      })}
    </View>
  </View>;
}

function createStyles(theme:FireOpsTheme){return StyleSheet.create({
  panel:{backgroundColor:theme.paper,borderWidth:1,borderColor:theme.divider,borderRadius:14,padding:17,gap:13},
  copy:{gap:2},
  title:{color:theme.ink,fontSize:19,fontWeight:'800'},
  subtitle:{color:theme.secondary,fontSize:12},
  segments:{flexDirection:'row',gap:3,padding:3,borderRadius:12,borderWidth:1,borderColor:theme.divider,backgroundColor:theme.surfaceAlt},
  segment:{flex:1,minHeight:44,alignItems:'center',justifyContent:'center',borderRadius:9},
  segmentSelected:{backgroundColor:theme.paper,shadowColor:'#000',shadowOpacity:.12,shadowRadius:3,shadowOffset:{width:0,height:1},elevation:1},
  segmentPressed:{opacity:.65},
  segmentText:{color:theme.secondary,fontSize:15,fontWeight:'700'},
  segmentTextSelected:{color:theme.ink},
})}
