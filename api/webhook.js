const crypto = require('crypto');
const { Client } = require('@line/bot-sdk');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const client = new Client({
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
});

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  const signature = req.headers['x-line-signature'];
  const bodyString = JSON.stringify(req.body);

  const hash = crypto
    .createHmac('SHA256', process.env.LINE_CHANNEL_SECRET)
    .update(bodyString)
    .digest('base64');

  if (hash !== signature) {
    return res.status(401).send('Invalid signature');
  }

  const events = req.body.events;

  for (const event of events) {
    if (event.type === 'message' && event.message.type === 'text') {
      const replyToken = event.replyToken;
      const userMessage = event.message.text;
      const userId = event.source.userId;

      // 1. เรียกใช้งาน Google Gemini API
      let aiReplyText = "ขออภัยครับ ระบบ AI กำลังขัดข้องชั่วคราว";
      try {
        const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              parts: [{ text: `คุณคือแอดมินผู้ช่วยอัจฉริยะของร้านค้า ตอบคำถามลูกค้าด้วยความสุภาพ เป็นกันเอง และให้ข้อมูลที่ถูกต้อง ลูกค้าพิมพ์มาว่า: ${userMessage}` }]
            }]
          })
        });
        const geminiData = await geminiRes.json();
        aiReplyText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || aiReplyText;
      } catch (err) {
        console.error("Gemini Error:", err);
      }

      // 2. บันทึกลงฐานข้อมูล Database (Supabase PostgreSQL)
      try {
        await pool.query(
          'INSERT INTO chat_logs (line_user_id, user_message, ai_response) VALUES ($1, $2, $3)',
          [userId, userMessage, aiReplyText]
        );
      } catch (dbErr) {
        console.error("Database Error:", dbErr);
      }

      // 3. ส่งคำตอบกลับหาลูกค้าทาง LINE
      await client.replyMessage(replyToken, {
        type: 'text',
        text: aiReplyText,
      });
    }
  }

  return res.status(200).json({ status: 'success' });
}
