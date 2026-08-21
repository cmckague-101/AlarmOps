import React from 'react';
import {Image,StyleSheet,View} from 'react-native';
import {colors} from '../theme';
export function BrandHeader(){return <View style={s.wrap}><Image source={require('../../assets/wordmark-hd.png')} style={s.logo} resizeMode="contain"/></View>}
const s=StyleSheet.create({wrap:{height:48,backgroundColor:colors.background,paddingHorizontal:16,justifyContent:'center',borderBottomWidth:1,borderBottomColor:colors.border},logo:{width:168,height:38}});
