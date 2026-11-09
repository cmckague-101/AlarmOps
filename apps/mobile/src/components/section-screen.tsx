import type {ReactElement,RefObject} from 'react';
import {ScrollView,StyleSheet,Text,View,type RefreshControlProps,type ScrollViewInstance} from 'react-native';
import {useSession} from '@/providers/session-provider';
import {useFireOpsTheme} from '@/theme';
import {HeroTitle} from './hero-title';

type Props={title:string;description?:string;showTitle?:boolean;showHeader?:boolean;children?:React.ReactNode;scrollRef?:RefObject<ScrollViewInstance|null>;refreshControl?:ReactElement<RefreshControlProps>};
export function SectionScreen({title,description,showTitle=true,showHeader=true,children,scrollRef,refreshControl}:Props){
  const theme=useFireOpsTheme();
  const {access}=useSession();
  const company=access.value?.kind==='member'?access.value.company:null;
  return <ScrollView ref={scrollRef} refreshControl={refreshControl} automaticallyAdjustKeyboardInsets keyboardShouldPersistTaps="handled" contentInsetAdjustmentBehavior="automatic" style={{backgroundColor:theme.canvas}} contentContainerStyle={styles.content}>
    {showHeader?<Text style={[styles.company,{color:theme.secondary}]}>{company?.name}</Text>:null}
    {showTitle?<HeroTitle style={styles.title}>{title}</HeroTitle>:null}
    {description?<Text style={[styles.description,{color:theme.secondary},!showTitle&&styles.descriptionWithoutTitle]}>{description}</Text>:null}
    {showHeader?<View style={[styles.rule,{backgroundColor:theme.divider}]}/>:null}
    {children??<Text style={[styles.pending,{color:theme.secondary}]}>Backend data connection comes in next feature pass.</Text>}
  </ScrollView>;
}
const styles=StyleSheet.create({content:{paddingHorizontal:20,paddingTop:20,paddingBottom:40},company:{fontSize:13,fontWeight:'700',marginBottom:6},title:{fontSize:30,lineHeight:35,fontWeight:'800',letterSpacing:-0.7},description:{fontSize:16,lineHeight:23,marginTop:8,maxWidth:560},descriptionWithoutTitle:{marginTop:0},rule:{height:1,marginTop:24,marginBottom:20},pending:{fontSize:15,lineHeight:22}});
