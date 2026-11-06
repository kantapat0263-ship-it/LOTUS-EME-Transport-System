import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Calendar, formatThaiCaption, formatThaiWeekday } from './calendar'

const NOV_2026 = new Date(2026, 10, 1)

describe('Calendar (react-day-picker v9 + ภาษาไทย)', () => {
  it('หัวปฏิทินเป็นเดือนไทยปี พ.ศ. · ชื่อวันสั้นไม่มีจุด เริ่มวันจันทร์', () => {
    expect(formatThaiCaption(NOV_2026)).toBe('พฤศจิกายน 2569')
    expect([2, 3, 4, 5, 6, 7, 8].map(d => formatThaiWeekday(new Date(2026, 10, d)))).toEqual(['จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส', 'อา'])
    const html = renderToStaticMarkup(<Calendar mode="single" month={NOV_2026} />)
    expect(html).toContain('พฤศจิกายน 2569')
    const heads = [...html.matchAll(/<th[^>]*>([^<]*)<\/th>/g)].map(m => m[1])
    expect(heads).toEqual(['จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส', 'อา'])
  })

  it('ใช้ชื่อคลาสของ v9: ช่องวันไม่มีคลาสปุ่ม (inline-flex) — สาเหตุที่ตารางเคยพัง "Mo ……… TuWeThFrSaSu"', () => {
    const html = renderToStaticMarkup(<Calendar mode="single" month={NOV_2026} />)
    const cells = [...html.matchAll(/<td[^>]*class="([^"]*)"/g)].map(m => m[1])
    expect(cells.length).toBeGreaterThanOrEqual(35)
    for (const cls of cells) expect(cls).not.toContain('inline-flex')
    // ปุ่มวันอยู่ในช่อง (day_button) และหัวตารางเป็นแถวเดียวกับช่องวัน (flex ทั้งสองแถว)
    expect(html).toMatch(/<td[^>]*><button[^>]*class="[^"]*inline-flex/)
    expect(html).toMatch(/<tr[^>]*class="flex w-full"/)
  })

  it('วันที่กดไม่ได้: ปุ่ม disabled จริง (ส่ง props disabled เดิมผ่านได้)', () => {
    const html = renderToStaticMarkup(<Calendar mode="single" month={NOV_2026} disabled={(d) => d.getDay() === 0} />)
    const sunday = html.match(/<td[^>]*data-day="2026-11-08"[^>]*>(.*?)<\/td>/)?.[0] ?? ''
    expect(sunday).toContain('data-disabled="true"')
    expect(sunday).toMatch(/<button[^>]*disabled=""/)
    const monday = html.match(/<td[^>]*data-day="2026-11-09"[^>]*>(.*?)<\/td>/)?.[0] ?? ''
    expect(monday).not.toContain('data-disabled')
  })
})
