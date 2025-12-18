
import { GoogleGenAI, Type } from "@google/genai";

export default async function handler(request, response) {
  // 设置 CORS 头部
  response.setHeader('Access-Control-Allow-Credentials', true);
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  response.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, x-custom-api-key, x-custom-base-url, x-custom-model');

  if (request.method === 'OPTIONS') {
    response.status(200).end();
    return;
  }

  // Helper: Decode Headers
  const getHeader = (key) => {
    const val = request.headers[key];
    if (!val) return undefined;
    try { return decodeURIComponent(val); } catch (e) { return val; }
  };

  const sanitizeModelName = (name) => {
      if (!name) return name;
      if (/[^a-zA-Z0-9.\-_]/.test(name)) return encodeURIComponent(name);
      return name;
  };

  const customApiKey = getHeader('x-custom-api-key');
  const customBaseUrl = getHeader('x-custom-base-url');
  const customModel = getHeader('x-custom-model');

  let apiKey = customApiKey || process.env.API_KEY;
  if (!apiKey) return response.status(400).json({ error: "Configuration Error: API_KEY is missing." });
  
  apiKey = apiKey.trim().replace(/^['"]|['"]$/g, '');

  let baseUrl = 'https://generativelanguage.googleapis.com';
  if (customBaseUrl && customBaseUrl.trim() !== '') {
    let url = customBaseUrl.trim();
    if (!url.startsWith('http')) url = `https://${url}`;
    url = url.replace(/\/$/, '').replace(/\/v1beta\/?$/, '').replace(/\/v1\/?$/, '');
    baseUrl = url;
  }

  // --- 模式 1: 代理获取模型列表 (类似 Tavern 的后端代理) ---
  if (request.method === 'GET' && request.query.action === 'list_models') {
    try {
      // 强制使用 OpenAI 标准路径 /v1/models
      // 这是中转站通用的标准
      const targetUrl = `${baseUrl}/v1/models`;
      console.log(`[Proxy List] Forwarding to: ${targetUrl}`);

      const proxyRes = await fetch(targetUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      });

      if (!proxyRes.ok) {
        const errText = await proxyRes.text();
        return response.status(proxyRes.status).json({ error: `Upstream Error: ${errText}` });
      }

      const data = await proxyRes.json();
      
      // 确保返回格式统一为 { models: [{id: ...}] }
      let models = [];
      if (data.data) models = data.data;
      else if (data.models) models = data.models;
      else if (Array.isArray(data)) models = data;

      return response.status(200).json({ success: true, models: models });

    } catch (error) {
      console.error("List Proxy Failed:", error);
      return response.status(500).json({ error: error.message });
    }
  }

  // --- 模式 2: 连通性检查 (Ping) ---
  if (request.method === 'GET' && request.query.check === 'true') {
    // 这里的 check 主要是给 UI 用的简单 Ping
    return response.status(200).json({ success: true, msg: "Backend Online" });
  }

  // --- 模式 3: 生成简报 (POST) ---
  if (request.method === 'POST') {
    try {
      const { date } = request.body;
      if (!date) return response.status(400).json({ error: "Date is required" });

      // 初始化 SDK
      // Google SDK 默认会追加 /v1beta/models...
      // 大多数 OneAPI 中转站能兼容 Google SDK 的请求结构
      const ai = new GoogleGenAI({ apiKey, baseUrl, apiVersion: 'v1beta' });
      
      const modelId = customModel || process.env.GEMINI_MODEL_ID || 'gemini-3-pro-preview';
      const safeModel = sanitizeModelName(modelId);

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
        你是一位专业的资深新闻编辑和双语内容创作者。
        任务：搜索昨日（${date}）的新闻，精选 6 条全球时政新闻和 6 条医学文献突破。
        要求：使用 Google Search，提供 source_url，双语对应，生成爆款标题。
      `;

      const genConfig = {
        tools: [{ googleSearch: {} }],
        responseMimeType: "application/json",
        responseSchema: responseSchema,
      };

      console.log(`Generating via Backend Proxy: ${safeModel} @ ${baseUrl}`);

      const result = await ai.models.generateContent({
        model: safeModel,
        contents: prompt,
        config: genConfig,
      });

      return response.status(200).json(JSON.parse(result.text));

    } catch (error) {
      console.error("Generation Failed:", error);
      const errorMsg = error.response ? JSON.stringify(error.response) : error.message;
      return response.status(500).json({ error: errorMsg });
    }
  }

  return response.status(405).json({ error: "Method not allowed" });
}
