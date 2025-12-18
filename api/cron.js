
// api/cron.js
// 这是一个由 Vercel Cron 触发的后端任务
// 它不依赖前端浏览器，完全在服务器端运行

import { GoogleGenAI, Schema, Type } from "@google/genai";

export default async function handler(request, response) {
  // 1. 安全验证: 确保只有 Vercel Cron 能调用此接口
  // const authHeader = request.headers.get('authorization');
  // if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
  //   return response.status(401).json({ success: false });
  // }
  
  console.log("⏰ Cron Job Started: Generating Daily Briefing...");

  // 2. 准备环境变量
  let apiKey = process.env.API_KEY;
  const resendApiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.EMAIL_FROM || 'Aurora News <onboarding@resend.dev>';
  
  // 获取配置的模型ID，默认 gemini-3-pro-preview
  const modelId = process.env.GEMINI_MODEL_ID || 'gemini-3-pro-preview';

  // 从环境变量获取收件人列表 (逗号分隔)
  const recipientsEnv = process.env.RECIPIENT_LIST;
  const recipients = recipientsEnv ? recipientsEnv.split(',').map(e => e.trim()) : [];

  if (!apiKey || !resendApiKey || recipients.length === 0) {
    console.error("Missing configuration (API_KEY, RESEND_API_KEY, or RECIPIENT_LIST)");
    return response.status(500).json({ error: "Configuration missing" });
  }

  // 清洗 API Key
  apiKey = apiKey.trim();
  if ((apiKey.startsWith('"') && apiKey.endsWith('"')) || (apiKey.startsWith("'") && apiKey.endsWith("'"))) {
    apiKey = apiKey.slice(1, -1);
  }

  // 3. 计算日期 (北京时间昨天)
  const now = new Date();
  // UTC+8
  const beijingTime = new Date(now.getTime() + (8 * 60 + now.getTimezoneOffset()) * 60 * 1000);
  const yesterday = new Date(beijingTime);
  yesterday.setDate(yesterday.getDate() - 1);
  const targetDateStr = yesterday.toISOString().split('T')[0];
  const todayDateStr = beijingTime.toISOString().split('T')[0];

  try {
    // 4. 调用 Gemini 生成内容
    const ai = new GoogleGenAI({ apiKey });
    
    const newsItemSchema = {
      type: Type.OBJECT,
      properties: {
        title_cn: { type: Type.STRING },
        title_en: { type: Type.STRING },
        summary_cn: { type: Type.STRING },
        summary_en: { type: Type.STRING },
        source_url: { type: Type.STRING },
        source_name: { type: Type.STRING },
      },
    };

    const responseSchema = {
      type: Type.OBJECT,
      properties: {
        viral_titles: { type: Type.ARRAY, items: { type: Type.STRING } },
        medical_viral_titles: { type: Type.ARRAY, items: { type: Type.STRING } },
        general_news: { type: Type.ARRAY, items: newsItemSchema },
        medical_news: { type: Type.ARRAY, items: newsItemSchema },
        date: { type: Type.STRING },
      },
    };

    const prompt = `
      任务：搜索 ${targetDateStr} 的新闻。
      1. 精选 6 条全球/政治/经济新闻。
      2. 精选 6 条医学/健康/科学文献突破。
      要求：
      - 必须使用 Google Search 工具。
      - 必须提供真实、可访问的 source_url。
      - 为医学板块生成 3 个小红书风格爆款标题 (medical_viral_titles)。
      - 为时政板块生成 3 个小红书风格爆款标题 (viral_titles)。
      - 中英双语对照。
    `;

    console.log(`Generating content for date: ${targetDateStr} using model: ${modelId}...`);
    
    const config = {
        tools: [{ googleSearch: {} }],
        responseMimeType: "application/json",
        responseSchema: responseSchema,
    };

    const genResponse = await ai.models.generateContent({
      model: modelId,
      contents: prompt,
      config: config,
    });

    const content = JSON.parse(genResponse.text);
    console.log("Content generated successfully.");

    // 5. 生成 HTML
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

    // 6. 发送邮件
    console.log(`Sending email to ${recipients.length} recipients via Resend...`);
    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${resendApiKey}`
      },
      body: JSON.stringify({
        from: fromEmail,
        to: recipients,
        subject: `[Aurora] Daily Briefing - ${todayDateStr}`,
        html: htmlContent,
      }),
    });

    if (!emailRes.ok) {
        const errText = await emailRes.text();
        throw new Error(errText);
    }
    
    console.log("Cron Job Completed Successfully.");
    return response.status(200).json({ success: true, date: todayDateStr });

  } catch (error) {
    console.error("Cron Job Failed:", error);
    return response.status(500).json({ success: false, error: error.message });
  }
}
