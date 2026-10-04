import * as z from "zod"

const EMPLOYEE_CODE_RE = /^(\d{4,6})?$/

/**
 * ฟอร์มคนขับในหน้าฟลีท (แยกไฟล์ไว้ให้ unit test ได้)
 *
 * - คนขับประจำ: รหัสพนักงานไม่บังคับ แต่ถ้ากรอกต้องเป็นตัวเลข 4–6 หลัก · ตัดช่องว่างหัวท้ายก่อนบันทึก
 * - คนขับไม่ประจำ (เรียกมาช่วยขับ / พนักงานที่ขอรถแล้วขับเอง เช่น วิศวกร / คนนอก) = ไม่ตรวจวันลา
 *   → ไม่ตรวจรหัส และบันทึกค่าเดิมกลับตามที่เป็น (ช่องถูกซ่อน แก้ไม่ได้ จึงห้ามบล็อกการบันทึก)
 * - `driverType` บันทึกทุกครั้ง
 */
export const driverSchema = z
  .object({
    name: z.string().min(2, "กรุณาระบุชื่อคนขับ"),
    phoneNumber: z.string().min(9, "กรุณาระบุเบอร์โทรศัพท์"),
    employeeCode: z.string(),
    driverType: z.enum(["regular", "occasional"]),
  })
  .superRefine((v, ctx) => {
    if (v.driverType === "regular" && !EMPLOYEE_CODE_RE.test(v.employeeCode.trim())) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["employeeCode"], message: "รหัสพนักงานเป็นตัวเลข 4–6 หลัก" })
    }
  })
  .transform((v) => (v.driverType === "regular" ? { ...v, employeeCode: v.employeeCode.trim() } : v))
