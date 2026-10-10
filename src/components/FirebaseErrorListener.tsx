'use client';

import { useState, useEffect, useRef } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { errorEmitter } from '@/firebase/error-emitter';
import { FirestorePermissionError } from '@/firebase/errors';
import { useAuth, useFirestore } from '@/firebase/provider';
import { clearPrivateApiCache } from '@/lib/privateCache';

/**
 * An invisible component that listens for globally emitted 'permission-error' events.
 * It throws any received error to be caught by Next.js's global-error.tsx.
 */
export function FirebaseErrorListener() {
  // Use the specific error type for the state for type safety.
  const [error, setError] = useState<FirestorePermissionError | null>(null);
  const auth = useAuth();
  const db = useFirestore();
  const recovering = useRef(false);

  useEffect(() => {
    // The callback now expects a strongly-typed error, matching the event payload.
    const handleError = async (error: FirestorePermissionError) => {
      // บัญชีถูกระงับ/ลบโปรไฟล์ระหว่างใช้งาน → listener ข้อมูลธุรกิจโดน rules ปฏิเสธ
      // ไม่ใช่บั๊กของหน้า — ออกจากระบบ (ล้างแคช API) แล้วกลับหน้า login แทนการ throw ทั้งแอป
      const user = auth.currentUser;
      // ไม่มีบัญชีแล้ว = listener ที่ค้างตอนออกจากระบบโดนปฏิเสธ — ไม่ใช่ข้อผิดพลาดของหน้า
      if (!user) return;
      if (recovering.current) return; // หลาย listener โดนพร้อมกัน — จัดการครั้งเดียว
      recovering.current = true;
      let inactive = false;
      try {
        const profile = await getDoc(doc(db, 'users', user.uid));
        inactive = !profile.exists() || profile.data()?.active !== true;
      } catch {
        // ตรวจโปรไฟล์ไม่ได้ → ทำแบบเดิม (throw)
      }
      // ระหว่างรอ อาจออกจากระบบ/สลับบัญชีไปแล้ว — ห้ามไปกระทบบัญชีใหม่
      if (auth.currentUser?.uid !== user.uid) { recovering.current = false; return; }
      if (inactive) {
        await clearPrivateApiCache();
        // ล้างแคชแล้ว ตรวจอีกรอบว่ายังเป็นบัญชีเดิมก่อนสั่งออก
        if (auth.currentUser?.uid !== user.uid) { recovering.current = false; return; }
        await auth.signOut();
        window.location.assign('/login');
        return;
      }
      recovering.current = false;
      // Set error in state to trigger a re-render.
      setError(error);
    };

    // The typed emitter will enforce that the callback for 'permission-error'
    // matches the expected payload type (FirestorePermissionError).
    errorEmitter.on('permission-error', handleError);

    // Unsubscribe on unmount to prevent memory leaks.
    return () => {
      errorEmitter.off('permission-error', handleError);
    };
  }, [auth, db]);

  // On re-render, if an error exists in state, throw it.
  if (error) {
    throw error;
  }

  // This component renders nothing.
  return null;
}
