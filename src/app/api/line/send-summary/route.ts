import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  try {
    const { trips } = await req.json()
    const token = process.env.LINE_CHANNEL_ACCESS_TOKEN
    const groupId = process.env.LINE_GROUP_ID

    if (!token || !groupId) {
      console.error('Missing LINE_CHANNEL_ACCESS_TOKEN or LINE_GROUP_ID')
      return NextResponse.json({ error: 'Missing LINE config' }, { status: 500 })
    }

    const driverLinks = trips.map((trip: any) =>
      `🚛 ${trip.driverName} (${trip.vehiclePlate})\n🔗 ${trip.driverUrl}`
    ).join('\n\n')

    const message = `📋 ใบคิวรถประจำวัน LOTUS GROUP\n\n📌 รายการลิงก์ใบงานดิจิทัลสำหรับคนขับ:\n\n${driverLinks}\n\n* กรุณาเปิดลิงก์เพื่อดูรายละเอียดจุดส่งและนำทาง`

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
