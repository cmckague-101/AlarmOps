import AsyncStorage from '@react-native-async-storage/async-storage';

export type AssignmentAvailability='Available'|'Unavailable';
export type AvailabilityRecord={userId:string;status:AssignmentAvailability;updatedAt:string};

const STORAGE_KEY='fireops.assignment.availability.v1';
const listeners=new Set<()=>void>();

export async function loadAvailability():Promise<Record<string,AvailabilityRecord>>{
 try{return JSON.parse((await AsyncStorage.getItem(STORAGE_KEY))||'{}')}catch{return{}}
}

export async function setAvailability(userId:string,status:AssignmentAvailability):Promise<void>{
 const records=await loadAvailability();
 records[userId]={userId,status,updatedAt:new Date().toISOString()};
 await AsyncStorage.setItem(STORAGE_KEY,JSON.stringify(records));
 listeners.forEach(listener=>listener());
}

export function subscribeAvailability(listener:()=>void){listeners.add(listener);return()=>{listeners.delete(listener)}}
