
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
  fuelRate?: number; // km/liter
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

export interface CompanySetting {
  id: string;
  companyName: string;
  warehouseName: string;
  warehouseAddress: string;
  warehouseLatitude?: number;
  warehouseLongitude?: number;
  googleMapsApiKeyReference?: string;
  dieselPrice?: number;
  defaultFuelRate?: number;
  fuelSettingsUpdatedAt?: any;
  fuelSettingsUpdatedBy?: string;
  createdAt?: any;
  updatedAt?: any;
}

export type TripStatus = 'Planned' | 'In Progress' | 'Completed' | 'Cancelled';

export interface TripStop {
  siteId: string;
  siteName: string;
  order: number;
  cargoDetails: string;
  actualCargoDescription?: string;
}

export interface Trip {
  id: string;
  tripId: string;
  tripDate: string;
  driverId: string;
  driverName: string;
  vehicleId: string;
  vehiclePlate: string;
  departureSiteId: string;
  stops: TripStop[];
  status: TripStatus;
  totalDistanceKm?: number;
  totalEstimatedTimeMinutes?: number;
  fuelCost?: number;
  createdAt?: any;
  updatedAt?: any;
}

export interface TripEditLog {
  id: string;
  editedAt: any;
  editedBy: string;
  note: string;
  changes: {
    vehicle?: { from: string; to: string };
    driver?: { from: string; to: string };
    stopsAdded?: string[];
    stopsRemoved?: string[];
    cargoChanged?: boolean;
  };
}

export type UserRole = 'admin' | 'dispatcher' | 'viewer';

export interface UserProfile {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  active: boolean;
  createdAt: any;
  updatedAt: any;
}
