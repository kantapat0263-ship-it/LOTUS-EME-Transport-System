import { defineConfig } from 'vitest/config'

// เทสต์ firestore.rules — ต้องรันผ่าน `npm run test:rules` (มี Firestore Emulator)
// แยกจาก vitest.config.ts เพื่อไม่ให้ `npm run test:run` ปกติต้องพึ่ง emulator
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/rules/**/*.test.ts'],
    testTimeout: 20000,
    hookTimeout: 30000,
    fileParallelism: false,
  },
})
