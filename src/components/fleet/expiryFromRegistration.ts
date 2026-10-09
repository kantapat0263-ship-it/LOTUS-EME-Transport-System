import { collection, doc, serverTimestamp, type DocumentData, type DocumentReference, type Firestore, type SetOptions } from "firebase/firestore"
import type { Vehicle } from "@/types/models"

/** transaction หรือ writeBatch — ใช้แค่ .set */
interface Setter {
  set(ref: DocumentReference, data: DocumentData, options?: SetOptions): unknown
}

/**
 * ตั้งวันหมดอายุภาษี + พ.ร.บ. (วันเดียวกัน) ที่คิดจากวันจดทะเบียน = ยืนยันแล้ว + ประวัติ "ยืนยัน" 2 รายการ
 * ใช้ร่วมกัน: ปุ่มตั้งจากวันจดทะเบียน / นำเข้าจาก Excel / เพิ่มรถใหม่ที่กรอกวันจดทะเบียน
 * ผู้เรียกต้องเช็กก่อนว่ารถยังไม่มีวันหมดอายุ (`expiryToSetFromRegistration`) — ฟังก์ชันนี้เขียนอย่างเดียว
 */
export function writeExpiryFromRegistration(
  w: Setter,
  db: Firestore,
  vehicle: Pick<Vehicle, "id" | "licensePlate">,
  expiry: string,
  by: string,
  nowIso: string
) {
  const item = { expiry, confirmed: true, confirmedBy: by, confirmedAt: nowIso }
  w.set(doc(db, "vehicleCompliance", vehicle.id), { id: vehicle.id, tax: item, act: item, updatedAt: serverTimestamp() }, { merge: true })
  for (const kind of ["tax", "act"] as const) {
    w.set(doc(collection(db, "vehicleComplianceHistory")), {
      vehicleId: vehicle.id,
      licensePlate: vehicle.licensePlate,
      kind,
      action: "confirm",
      prevExpiry: null,
      newExpiry: expiry,
      recordedBy: by,
      recordedAt: nowIso,
    })
  }
}
