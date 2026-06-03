
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

/**
 * Actual outcome of a stop after the daily report is posted to LINE.
 * An unset (undefined) outcome means the stop ran as planned (= delivered),
 * so the dispatcher only needs to mark the exceptions.
 *   - delivered     : ส่ง/ปฏิบัติงานตามแผน
 *   - reassigned    : โยกงานไปให้รถคันอื่นทำแทน (กม. ตามไปลงคันที่ทำจริง)
 *   - postponed     : เลื่อนวัน / ลูกค้าเลื่อน (เหตุภายนอก)
 *   - driver-refused: คนขับไม่รับงาน (เก็บไว้ดู pattern เงียบ ๆ)
 */
export type StopOutcome = 'delivered' | 'reassigned' | 'postponed' | 'driver-refused';

export interface TripStop {
  siteId: string;
  siteName: string;
  order: number;
  cargoDetails: string;
  actualCargoDescription?: string;
  lat?: number;
  lng?: number;
  requestedBy?: string;
  requestedByPhone?: string;
  requestTime?: string;
  address?: string;
  note?: string;
  dispatcherNote?: string;
  dispatcherName?: string;
  // --- Actual-outcome reconciliation (filled in by the dispatcher in the evening) ---
  outcome?: StopOutcome;
  /** Free-text reason, mainly for `driver-refused`. */
  outcomeReason?: string;
  /** When `outcome === 'reassigned'`, the trip/vehicle that actually did the job. */
  reassignedToTripId?: string;
  reassignedToVehiclePlate?: string;
  reassignedToDriverName?: string;
  /** Who recorded the outcome, and when (ISO string — Firestore forbids serverTimestamp inside arrays). */
  outcomeRecordedBy?: string;
  outcomeAt?: string;
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
  vehicleType?: string;
  departurePoint?: string;
  originLat?: number;
  originLng?: number;
  sourceVRIds?: string[];
  requestedBy?: string;
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
