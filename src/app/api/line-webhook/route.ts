import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'

/**
 * LINE Webhook API Route
 * This endpoint handles incoming events from LINE Messaging API.
 * It verifies the signature and logs Group IDs for notification configuration.
 */

export async function POST(req: NextRequest) {
  try {
    const body = await req.text()
    const signature = req.headers.get('x-line-signature') || ''
    const channelSecret = process.env.LINE_CHANNEL_SECRET || ''

    if (!channelSecret) {
      console.error('ERROR: LINE_CHANNEL_SECRET is not defined in environment variables.')
      return NextResponse.json({ error: 'Configuration Error' }, { status: 500 })
    }

    // 1. Verify Signature
    const hash = crypto
      .createHmac('SHA256', channelSecret)
      .update(body)
      .digest('base64')

    if (hash !== signature) {
      console.warn('Unauthorized request: Invalid LINE signature.')
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }

    // 2. Parse Events
    const data = JSON.parse(body)
    const events = data.events || []

    for (const event of events) {
      // Log Group ID if the event comes from a group
      if (event.source?.groupId) {
        console.log('--- LINE GROUP ID DETECTED ---')
        console.log('Group ID:', event.source.groupId)
        console.log('Event Type:', event.type)
        console.log('------------------------------')
      }

      // Log User ID if the event comes from a private chat
      if (event.source?.type === 'user' && event.source?.userId) {
        console.log('--- LINE USER ID DETECTED ---')
        console.log('User ID:', event.source.userId)
        console.log('-----------------------------')
      }
    }

    return NextResponse.json({ status: 'ok' })
  } catch (error) {
    console.error('Webhook Error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

export async function GET() {
  return NextResponse.json({ 
    status: 'LINE Webhook OK',
    message: 'Please set this URL in your LINE Developers Console under Messaging API -> Webhook URL'
  })
}
