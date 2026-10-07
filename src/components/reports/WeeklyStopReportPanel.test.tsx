import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { WeeklyStopReportPanel } from './WeeklyStopReportPanel'
import type { User } from 'firebase/auth'
const user = { uid: 'local-admin', getIdToken: async () => 'local-token' } as User
it('renders the private weekly report controls only for an active admin', () => {
  expect(renderToStaticMarkup(<WeeklyStopReportPanel user={user} isAdmin />)).toContain('สรุปรายสัปดาห์ต่อคนขับ')
  expect(renderToStaticMarkup(<WeeklyStopReportPanel user={user} isAdmin={false} />)).toBe('')
  expect(renderToStaticMarkup(<WeeklyStopReportPanel user={null} isAdmin />)).toBe('')
})
