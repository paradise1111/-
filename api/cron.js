
// api/cron.js
import OpenAI from "openai";

export default async function handler(request, response) {
  console.log("⏰ Cron Job Started: Generating Daily Briefing...");

  let apiKey = process.env.API_KEY;
  let baseUrl = process.env.API_BASE_URL || 'https://api.openai.com/v1'; 
  const resendApiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.EMAIL_FROM || 'Aurora News <onboarding@resend.dev>';
  const modelId = process.env.GEMINI_MODEL_ID || 'gemini-1.5-pro';
  const recipientsEnv = process.env.RECIPIENT_LIST;
  const recipients = recipientsEnv ? recipientsEnv.split(',').map(e => e.trim()) : [];

  if (!apiKey || !resendApiKey || recipients.length === 0) {
    console.error("Missing configuration");
    return response.status(500).json({ error: "Configuration missing" });
  }

  // Clean API Key
  apiKey = apiKey.trim().replace(/^['"]|['"]$/g, '');

  // Normalize Base URL
  baseUrl = baseUrl.replace(/\/$/, '');
  if (!baseUrl.endsWith('/v1') && !baseUrl.includes('openai.azure.com')) {
     baseUrl = `${baseUrl}/v1`;
  }

  // Calculate Date
  const now = new Date();
  const beijingTime = new Date(now.getTime() + (8 * 60 + now.getTimezoneOffset()) * 60 * 1000);
  const yesterday = new Date(beijingTime);
  yesterday.setDate(yesterday.getDate() - 1);
  const targetDateStr = yesterday.toISOString().split('T')[0];

  try {
    const client = new OpenAI({
        apiKey,
        baseURL: baseUrl
    });

    const jsonStructure = `
      {
        "viral_titles": ["String"],
        "medical_viral_titles": ["String"],
        "general_news": [{ "title_cn": "String", "title_en": "String", "summary_cn": "String", "summary_en": "String", "source_url": "String", "source_name": "String" }],
        "medical_news": [{ "title_cn": "String", "title_en": "String", "summary_cn": "String", "summary_en": "String", "source_url": "String", "source_name": "String" }],
        "date": "YYYY-MM-DD"
      }
    `;

    const prompt = `
      任务：搜索 ${targetDateStr} 的新闻。
      1. 精选 6 条全球/政治/经济新闻。
      2. 精选 6 条医学/健康/科学文献突破。
      要求：
      - 提供真实 source_url。
      - 小红书风格标题。
      - 中英双语对照。
      
      IMPORTANT: Return VALID JSON only. No Markdown.
      Structure: ${jsonStructure}
    `;

    console.log(`Generating content for ${targetDateStr} using ${modelId} via ${baseUrl}...`);

    const completion = await client.chat.completions.create({
        model: modelId,
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" }
    });

    // SAFETY CHECK
    if (!completion || !completion.choices || completion.choices.length === 0) {
        throw new Error(`Invalid response structure from model: choices missing. Response: ${JSON.stringify(completion)}`);
    }

    const contentText = completion.choices[0].message.content;
    const content = JSON.parse(contentText);
    console.log("Content generated successfully.");

    // HTML Generation
    const generateHtml = (data) => {
      const listItems = (items, color) => items.map(item => `
        <div style="margin-bottom: 20px; padding: 15px; background-color: #f8f9fa; border-radius: 8px;">
          <div style="font-weight: bold; margin-bottom: 5px;"><a href="${item.source_url}" style="color: #333; text-decoration: none;">${item.title_cn}</a></div>
          <div style="font-size: 14px; color: #666;">${item.title_en}</div>
          <div style="font-size: 14px; color: #444; margin-top: 5px;">${item.summary_cn}</div>
        </div>
      `).join('');

      return `
        <h1>Aurora Daily Briefing - ${data.date}</h1>
        <div style="background:#fff0f6; padding:15px; border-radius:8px; margin-bottom:20px;">
          <b style="color:#c41d7f">🔥 Global Viral:</b><br/>
          ${data.viral_titles.join('<br/>')}
        </div>
        <div style="background:#f6ffed; padding:15px; border-radius:8px; margin-bottom:20px;">
          <b style="color:#52c41a">🩺 Health Viral:</b><br/>
          ${data.medical_viral_titles ? data.medical_viral_titles.join('<br/>') : ''}
        </div>
        <h3 style="color:#1677ff">🌍 Global News</h3>
        ${listItems(data.general_news, '#1677ff')}
        <h3 style="color:#52c41a">🧬 Medical News</h3>
        ${listItems(data.medical_news, '#52c41a')}
      `;
    };

    const htmlContent = generateHtml(content);

    // Send Email
    console.log(`Sending email to ${recipients.length} recipients...`);
    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${resendApiKey}`
      },
      body: JSON.stringify({
        from: fromEmail,
        to: recipients,
        subject: `[Aurora] Daily Briefing - ${targetDateStr}`,
        html: htmlContent,
      }),
    });

    if (!emailRes.ok) throw new Error(await emailRes.text());
    
    console.log("Cron Job Completed.");
    return response.status(200).json({ success: true, date: targetDateStr });

  } catch (error) {
    console.error("Cron Job Failed:", error);
    return response.status(500).json({ success: false, error: error.message });
  }
}
