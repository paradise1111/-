// api/send-email.js
export default async function handler(request, response) {
  response.setHeader('Access-Control-Allow-Credentials', true);
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  response.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (request.method === 'OPTIONS') {
    response.status(200).end();
    return;
  }

  if (request.method !== 'POST') {
    return response.status(405).json({ error: 'Method Not Allowed' });
  }

  const resendApiKey = process.env.RESEND_API_KEY;
  // 获取自定义发件人地址，如果没有配置则使用 Resend 默认测试地址
  const fromEmail = process.env.EMAIL_FROM || 'Aurora News <onboarding@resend.dev>';

  if (!resendApiKey) {
    return response.status(500).json({ error: 'Server configuration error: Missing Resend API Key' });
  }

  try {
    const { to, subject, html } = request.body;

    if (!to || !subject || !html) {
      return response.status(400).json({ error: 'Missing required fields' });
    }

    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${resendApiKey}`
      },
      body: JSON.stringify({
        from: fromEmail, 
        to: to,
        subject: subject,
        html: html,
      }),
    });

    if (!resendRes.ok) {
      const errorText = await resendRes.text();
      throw new Error(`Resend API rejected: ${errorText}`);
    }

    const data = await resendRes.json();
    return response.status(200).json(data);

  } catch (error) {
    console.error('Email sending failed:', error);
    return response.status(500).json({ error: error.message });
  }
}