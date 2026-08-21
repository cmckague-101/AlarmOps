import AsyncStorage from '@react-native-async-storage/async-storage';

export type GearItem={id:string;name:string;available:number};
export type GearCheckout={id:string;gearId:string;item:string;quantity:number;person:string;checkedOutAt:string;checkedOutBy:string};
const INVENTORY_KEY='fireops.gear.inventory.v1';
const CHECKOUT_KEY='fireops.gear.checkouts.v1';
const listeners=new Set<()=>void>();
const seed:GearItem[]=[
 {id:'nomex-shirts',name:'Nomex Shirts',available:38},
 {id:'nomex-pants',name:'Nomex Pants',available:26},
 {id:'packs',name:'Packs',available:14},
 {id:'hard-hats',name:'Hard Hats',available:20},
 {id:'goggles',name:'Goggles',available:20},
 {id:'radios',name:'Radios',available:12},
 {id:'gloves',name:'Gloves',available:30},
];
async function read<T>(key:string,fallback:T):Promise<T>{try{return JSON.parse((await AsyncStorage.getItem(key))||JSON.stringify(fallback))}catch{return fallback}}
export async function loadGearInventory(){const stored=await read<GearItem[]>(INVENTORY_KEY,seed);return seed.map(item=>({...item,available:stored.find(saved=>saved.id===item.id)?.available??item.available}))}
export async function loadGearCheckouts(){return read<GearCheckout[]>(CHECKOUT_KEY,[])}
export async function saveGearInventory(items:GearItem[]){await AsyncStorage.setItem(INVENTORY_KEY,JSON.stringify(items));notify()}
export async function checkoutGear(gear:GearItem,quantity:number,person:string){const inventory=await loadGearInventory();const checkouts=await loadGearCheckouts();const current=inventory.find(item=>item.id===gear.id);if(!current||quantity<1||quantity>current.available)throw new Error('The requested quantity is not available.');const nextInventory=inventory.map(item=>item.id===gear.id?{...item,available:item.available-quantity}:item);const record:GearCheckout={id:`g${Date.now()}`,gearId:gear.id,item:gear.name,quantity,person,checkedOutAt:new Date().toISOString(),checkedOutBy:'Clint'};await Promise.all([AsyncStorage.setItem(INVENTORY_KEY,JSON.stringify(nextInventory)),AsyncStorage.setItem(CHECKOUT_KEY,JSON.stringify([record,...checkouts]))]);notify()}
export async function checkInGear(record:GearCheckout){const inventory=await loadGearInventory();const checkouts=await loadGearCheckouts();const nextInventory=inventory.map(item=>item.id===record.gearId?{...item,available:item.available+record.quantity}:item);await Promise.all([AsyncStorage.setItem(INVENTORY_KEY,JSON.stringify(nextInventory)),AsyncStorage.setItem(CHECKOUT_KEY,JSON.stringify(checkouts.filter(item=>item.id!==record.id)))]);notify()}
export function subscribeGear(listener:()=>void){listeners.add(listener);return()=>{listeners.delete(listener)}}
function notify(){listeners.forEach(listener=>listener())}
