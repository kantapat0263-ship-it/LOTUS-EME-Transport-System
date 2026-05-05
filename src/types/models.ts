export type ProjectType = 'Electrical' | 'Plumbing' | 'HVAC' | 'Mixed';

export interface Site {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  projectType: ProjectType;
  status: 'Active' | 'Inactive';
}

export type VehicleType = 'Pickup' | '4-wheel truck' | '6-wheel truck';

export interface Vehicle {
  id: string;
  licensePlate: string;
  type: VehicleType;
  maxLoadKg: number;
  assignedDriverId?: string;
}

export interface Driver {
  id: string;
  name: string;
  phone: string;
  assignedVehicleId?: string;
}

export type TripStatus = 'Planned' | 'In Progress' | 'Completed' | 'Cancelled';

export interface TripStop {
  id: string;
  siteId: string;
  order: number;
  cargoDescription: string;
}

export interface Trip {
  id: string;
  date: string;
  vehicleId: string;
  driverId: string;
  status: TripStatus;
  stops: TripStop[];
  totalDistanceKm?: number;
  totalTimeMinutes?: number;
  notes?: string;
}