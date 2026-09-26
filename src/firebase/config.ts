// ทดสอบในเครื่องกับ Firebase Emulator (NEXT_PUBLIC_FIREBASE_EMULATOR=1 ใน .env.development.local เท่านั้น)
// → ใช้ project "demo-*" ซึ่ง Firebase การันตีว่าต่อ production ไม่ได้ (กันพลาดเขียนข้อมูลจริง)
export const EMULATOR_PROJECT_ID = "demo-lotus-eme";
export const useFirebaseEmulator = process.env.NEXT_PUBLIC_FIREBASE_EMULATOR === "1";

export const firebaseConfig = {
  "projectId": useFirebaseEmulator ? EMULATOR_PROJECT_ID : "studio-2099625459-19c42",
  "appId": "1:889553695843:web:5b3e3a07855b6bc6417456",
  "apiKey": "AIzaSyAsg5aLRYslfUGCO1TpsButbkB9ipq99Vs",
  "authDomain": "studio-2099625459-19c42.firebaseapp.com",
  "measurementId": "",
  "messagingSenderId": "889553695843"
};
