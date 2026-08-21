import AsyncStorage from '@react-native-async-storage/async-storage';
export type CompanyBranding={logoUri?:string;signatureUri?:string;representativeName:string;companyPhone:string;updatedAt?:string};
const KEY='fireops.company.branding.v1';
export const defaultCompanyBranding:CompanyBranding={representativeName:'Clint McKague',companyPhone:'208-376-9731'};
export async function loadCompanyBranding():Promise<CompanyBranding>{try{return{...defaultCompanyBranding,...JSON.parse((await AsyncStorage.getItem(KEY))||'{}')}}catch{return defaultCompanyBranding}}
export async function saveCompanyBranding(value:CompanyBranding){await AsyncStorage.setItem(KEY,JSON.stringify({...value,updatedAt:new Date().toISOString()}))}
