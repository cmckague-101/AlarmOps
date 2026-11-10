import {nextOilChangeWarning} from './oil-change';

type SummaryVehicle={status:string;nextOilChangeDue?:string;nextOilChange?:string};

const statusIs=(status:string,expected:string)=>status.trim().toLowerCase()===expected;

/** A vehicle needs attention when it is Out of service or its oil change is due. */
export function vehicleNeedsAttention(vehicle:SummaryVehicle,now=new Date()):boolean{
  return statusIs(vehicle.status,'out of service')||Boolean(nextOilChangeWarning(vehicle,now));
}

/** Fleet summary counts shown at the top of Fleet on web and phone. */
export function fleetSummaryCounts(vehicles:readonly SummaryVehicle[],now=new Date()):{total:number;ready:number;needsAttention:number}{
  return {
    total:vehicles.length,
    ready:vehicles.filter(vehicle=>statusIs(vehicle.status,'ready')).length,
    needsAttention:vehicles.filter(vehicle=>vehicleNeedsAttention(vehicle,now)).length,
  };
}
