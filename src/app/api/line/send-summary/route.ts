import { NextRequest, NextResponse } from 'next/server'

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://lotus-eme-transport-system.vercel.app'

export async function POST(req: NextRequest) {
  try {
    const { trips, selectedDate } = await req.json()
    const token = process.env.LINE_CHANNEL_ACCESS_TOKEN
    const groupId = process.env.LINE_GROUP_ID

    if (!token || !groupId) {
      console.error('Missing LINE_CHANNEL_ACCESS_TOKEN or LINE_GROUP_ID')
      return NextResponse.json({ error: 'Missing LINE config' }, { status: 500 })
    }

    // ใช้วันที่จาก client (selectedDate: "2026-05-16")
    let dateStr = selectedDate || ""
    if (selectedDate) {
      const [y, m, d] = selectedDate.split('-')
      const dateObj = new Date(Number(y), Number(m) - 1, Number(d))
      dateStr = dateObj.toLocaleDateString('th-TH', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        weekday: 'long'
      })
    }

    const driverLinks = trips.map((trip: any) => {
      let line = `🚛 ${trip.driverName} (${trip.vehiclePlate})`
      // public-safe: แจ้งคนปลายทางว่ามีงาน "รับต่อ" เพิ่ม จะได้ไม่พลาด (ไม่มีคำว่าปฏิเสธ)
      if (trip.incomingCount > 0) {
        const from = Array.isArray(trip.incomingFrom) && trip.incomingFrom.length > 0
          ? ` (จาก ${trip.incomingFrom.join(', ')})`
          : ''
        line += `\n🔄 รับโยกงานต่อเพิ่ม ${trip.incomingCount} จุด${from}`
      }
      // public-safe: แจ้งว่าคันนี้ "โยกงานไปให้" คันอื่น (ฝั่งต้นทาง — ไม่มีคำว่าปฏิเสธ)
      if (trip.outgoingCount > 0) {
        const to = Array.isArray(trip.outgoingTo) && trip.outgoingTo.length > 0
          ? ` (ให้ ${trip.outgoingTo.join(', ')})`
          : ''
        line += `\n🔁 โยกงานไปให้ ${trip.outgoingCount} จุด${to}`
      }
      return `${line}\n🔗 ${trip.driverUrl}`
    }).join('\n\n')

    const message = `📋 ใบคิวรถประจำวัน LOTUS GROUP\n📅 วันที่ปฏิบัติงาน: ${dateStr}\n\n🔗 รายการลิงก์ใบงานดิจิทัลสำหรับคนขับ:\n\n${driverLinks}`

    const response = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        to: groupId,
        messages: [{ type: 'text', text: message }]
      })
    })

    if (!response.ok) {
      const errorData = await response.json()
      console.error('LINE API Error:', errorData)
      return NextResponse.json({ error: 'LINE API failed', details: errorData }, { status: response.status })
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('Server Error in /api/line/send-summary:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
