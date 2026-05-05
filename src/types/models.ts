
export type ProjectType = 'LOTUS EME' | 'P-ADVANCED';

export interface Site {
  id: string;
  name: string;
  address: string;
  latitude?: number;
  longitude?: number;
  projectTypeTag: ProjectType;
  status: 'Active' | 'Inactive';
  createdAt?: any;
  updatedAt?: any;
}

export type VehicleType = 'Pickup' | '4-wheel truck' | '6-wheel truck';

export interface Vehicle {
  id: string;
  licensePlate: string;
  type: VehicleType;
  maxLoadCapacityKg: number;
  createdAt?: any;
  updatedAt?: any;
}

export interface Driver {
  id: string;
  name: string;
  phoneNumber: string;
  createdAt?: any;
  updatedAt?: any;
}

export type TripStatus = 'Planned' | 'In Progress' | 'Completed' | 'Cancelled';

export interface TripStop {
  id: string;
  tripId: string;
  siteId: string;
  orderIndex: number;
  plannedCargoDescription: string;
  actualCargoDescription?: string;
  driverId?: string; // Denormalized for security rules
}

export interface Trip {
  id: string;
  tripDate: string;
  driverId: string;
  vehicleId: string;
  departureSiteId: string;
  stopIds: string[];
  status: TripStatus;
  totalDistanceKm?: number;
  totalEstimatedTimeMinutes?: number;
  routePolyline?: string;
  createdAt?: any;
  updatedAt?: any;
}
