export type Status = 'Pending' | 'Approved' | 'Paid';
export type EquipmentStatus = 'Available' | 'Assigned' | 'Maintenance';
export type UserRole = 'Owner' | 'Office' | 'Crew Lead' | 'Employee';
export type PayrollRecord = { id:string; employee:string; assignment:string; period:string; hours:number; days:number; status:Status; imageUri?:string; submittedAt:string; submitterId?:string; routedTo?:'Payroll Administrators'; aiConfidence?:number; hoursConfirmed?:boolean };
export type InvoiceRecord = { id:string; vendor:string; date:string; amount:number; category:string; status:'Pending'|'Paid'; imageUri?:string; cloudFileId?:string; storageStatus?:'Cloud Stored' };
export type EquipmentRecord = { id:string; unit:string; type:string; hours:number; nextService:number; status:EquipmentStatus };
export type ChatChannel = { id:string; name:string; kind:'Company'|'Incident'|'Unit'|'Direct'; unread:number; lastMessage:string; members:number };
export type ChatMessage = { id:string; channelId:string; sender:string; body:string; sentAt:string; urgent?:boolean; acknowledgedBy?:string[] };
