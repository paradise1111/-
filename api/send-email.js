
// api/send-email.js
export default async function handler(request, response) {
  response.setHeader('Access-Control-Allow-Credentials', true);
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (request.method === 'OPTIONS') {
    return response.status(200).end();
  }

  if (request.method !== 'POST') {
    return response.status(405).json({ error: 'Method Not Allowed' });
  }

  // 1. Sanitize Config
  const resendApiKey = (process.env.RESEND_API_KEY || '').replace(/['"]/g, '').trim();
  
  // Clean From Email
  // Resend requires a specific format: "Name <email@domain.com>" or "email@domain.com"
  let fromEmailRaw = (process.env.EMAIL_FROM || 'Aurora News <onboarding@resend.dev>').replace(/['"]/g, '').trim();
  
  // Safety check: ensure fromEmail has a valid look
  if (!fromEmailRaw.includes('<') && fromEmailRaw.includes(' ')) {
      // If it looks like "Aurora News onboarding@resend.dev" fix it to "Aurora News <onboarding@resend.dev>"
      const parts = fromEmailRaw.split(' ');
      const emailPart = parts.pop();
      fromEmailRaw = `${parts.join(' ')} <${emailPart}>`;
  }
  
  if (!fromEmailRaw.includes('@')) {
      fromEmailRaw = 'Aurora News <onboarding@resend.dev>';
  }

  if (!resendApiKey) {
    return response.status(500).json({ error: 'Missing RESEND_API_KEY' });
  }

  try {
    const { to, subject, html } = request.body;

    if (!to || !subject || !html) {
      return response.status(400).json({ error: 'Missing fields' });
    }

    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${resendApiKey}`
      },
      body: JSON.stringify({
        from: fromEmailRaw, 
        to: Array.isArray(to) ? to : [to],
        subject: subject,
        html: html,
      }),
    });

    if (!resendRes.ok) {
      const errorText = await resendRes.text();
      try {
          const errObj = JSON.parse(errorText);
          return response.status(resendRes.status).json({ error: errObj.message || errorText });
      } catch (e) {
          return response.status(resendRes.status).json({ error: errorText });
      }
    }

    const data = await resendRes.json();
    return response.status(200).json(data);

  } catch (error) {
    return response.status(500).json({ error: error.message });
  }
}
