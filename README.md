# LOTUS GROUP Transport Management

ระบบบริหารจัดการคิวรถและการขนส่งวัสดุสำหรับ LOTUS GROUP

## การตั้งค่าระบบ (Manual Configuration)

เพื่อให้ระบบทำงานได้อย่างถูกต้องตามนโยบายความปลอดภัยและป้องกันบัญชีซ้ำซ้อน **ต้องดำเนินการตั้งค่าใน Firebase Console** ดังนี้:

### Firebase Authentication Settings
1. ไปที่ **Authentication** → **Settings** → **User account linking**
2. เลือกตัวเลือก **"Prevent creation of multiple accounts with the same email address"** (หรือ "One account per email address")
   - *เหตุผล: เพื่อป้องกันไม่ให้ผู้ใช้นำอีเมลเดียวกันไปสมัครหลายบัญชีผ่าน Provider ที่ต่างกัน*

## การเข้าใช้งานเบื้องต้น
- **Admin Email:** `ownchang@hotmail.com` (ได้รับสิทธิ์ดูแลระบบโดยอัตโนมัติ)
- **User Role:** ผู้ที่สมัครสมาชิกใหม่จะได้รับสิทธิ์เป็น `Viewer` (ดูข้อมูลได้อย่างเดียว) จนกว่า Admin จะเปลี่ยนบทบาทให้

---
*รายงานและข้อมูลในระบบนี้ถือเป็นความลับของ LOTUS GROUP*
