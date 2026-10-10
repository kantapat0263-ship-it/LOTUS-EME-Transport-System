import { describe, it, expect } from 'vitest'
import { isToastTarget } from './toast'

// จำลอง element แบบ duck-typing (เทสต์รันใน node ไม่มี DOM)
const el = (insideToast: boolean) =>
  ({ closest: (sel: string) => (insideToast && sel === '[data-app-toast-viewport]' ? {} : null) }) as unknown as EventTarget

describe('isToastTarget — dialog ใช้แยกว่าคลิกอยู่ในกล่อง toast', () => {
  it('คลิกในกล่อง toast (เช่น ปุ่มปิดข้อความ) → true', () => {
    expect(isToastTarget(el(true))).toBe(true)
  })
  it('คลิกพื้นหลัง/ที่อื่น → false (dialog ปิดเมื่อคลิกนอกกรอบตามเดิม)', () => {
    expect(isToastTarget(el(false))).toBe(false)
    expect(isToastTarget(null)).toBe(false)
    expect(isToastTarget({} as EventTarget)).toBe(false)
  })
})
