
import { GoogleGenAI, Type } from "@google/genai";

// 这是一个 Serverless Function，运行在服务器端，可以安全访问 API Key
export default async function handler(request, response) {
  // 设置 CORS 头部，允许前端调用
  response.setHeader('Access-Control-Allow-Credentials', true);
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  response.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, x-custom-api-key, x-custom-base-url, x-custom-model');

  if (request.method === 'OPTIONS') {
    response.status(200).end();
    return;
  }

  // 1. 获取配置：优先使用 Header 中的自定义配置，其次使用环境变量
  const customApiKey = request.headers['x-custom-api-key'];
  const customBaseUrl = request.headers['x-custom-base-url'];
  const customModel = request.headers['x-custom-model'];

  let apiKey = customApiKey || process.env.API_KEY;
  
  if (!apiKey) {
    return response.status(500).json({ error: "Configuration Error: API_KEY is missing (Server env or Custom header)." });
  }

  // 清洗 API Key
  apiKey = apiKey.trim();
  if ((apiKey.startsWith('"') && apiKey.endsWith('"')) || (apiKey.startsWith("'") && apiKey.endsWith("'"))) {
    apiKey = apiKey.slice(1, -1);
  }

  // 2. 初始化 SDK
  const clientOptions = { apiKey };
  if (customBaseUrl && customBaseUrl.trim() !== '') {
    // 确保 URL 格式正确，处理末尾斜杠
    let url = customBaseUrl.trim();
    if (!url.startsWith('http')) url = `https://${url}`;
    clientOptions.baseUrl = url;
  }

  const ai = new GoogleGenAI(clientOptions);
  
  // 模型配置
  const PRIMARY_MODEL = customModel || process.env.GEMINI_MODEL_ID || 'gemini-3-pro-preview';
  const FALLBACK_MODEL = process.env.GEMINI_FALLBACK_MODEL_ID || 'gemini-3-flash-preview';

  // --- 模式 1: 连通性检查 (GET) ---
  if (request.method === 'GET' && request.query.check === 'true') {
    try {
      // 简单的 Ping 测试
      await ai.models.generateContent({
        model: PRIMARY_MODEL,
        contents: 'ping',
      });
      return response.status(200).json({ success: true, model: PRIMARY_MODEL, baseUrl: clientOptions.baseUrl || 'Default' });
    } catch (error) {
      console.error("Connectivity check failed:", error);
      return response.status(500).json({ success: false, error: error.message });
    }
  }

  // --- 模式 2: 生成简报 (POST) ---
  if (request.method === 'POST') {
    try {
      const { date } = request.body;
      if (!date) return response.status(400).json({ error: "Date is required" });

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
        任务：
        1. 搜索昨日（${date}）的新闻。
        2. 精选 6 条重大的全球/政治/经济新闻。
        3. 精选 6 条重大的医学/健康/科学文献突破。
        关键要求：
        - 必须使用 Google Search 工具。
        - 必须提供真实、可访问的 source_url。
        - 为医学板块生成 3 个小红书风格爆款标题 (medical_viral_titles)。
        - 为时政板块生成 3 个小红书风格爆款标题 (viral_titles)。
        - 双语对应。
      `;

      // 内部函数：执行生成，支持重试和降级
      const executeGeneration = async (model, useThinking, retries = 0) => {
        try {
          console.log(`Generating with model: ${model}, thinking: ${useThinking}`);
          const config = {
            tools: [{ googleSearch: {} }],
            responseMimeType: "application/json",
            responseSchema: responseSchema,
          };
          
          if (useThinking) {
             config.thinkingConfig = { thinkingBudget: 1024 };
          }

          const result = await ai.models.generateContent({
            model: model,
            contents: prompt,
            config: config,
          });

          return JSON.parse(result.text);
        } catch (err) {
          if (retries > 0) {
            console.warn(`Retry needed for ${model}. Remaining: ${retries - 1}`);
            await new Promise(r => setTimeout(r, 1000));
            // 递归重试，关闭 Thinking 以提高稳定性
            return executeGeneration(model, false, retries - 1);
          }
          throw err;
        }
      };

      // 稳定性策略
      let data;
      try {
        const isNative = PRIMARY_MODEL.includes('gemini-3') || PRIMARY_MODEL.includes('gemini-2.5');
        // 如果用户自定义了 BaseURL，通常意味着使用代理，可能对 Thinking 参数支持不一，建议默认不开启 Thinking 或视情况而定
        // 这里保持原逻辑，尝试开启
        data = await executeGeneration(PRIMARY_MODEL, isNative, 0);
      } catch (e1) {
        console.warn("Primary attempt failed, retrying without thinking...", e1);
        try {
            data = await executeGeneration(PRIMARY_MODEL, false, 1);
        } catch (e2) {
            console.warn("Primary model failed completely, switching to fallback...", e2);
            // 如果使用了自定义 Key/Model，切换到默认 Fallback Model 可能会因为权限问题失败(如果Key不通用)
            // 但如果 Fallback 也是 Gemini 系列，通常是通用的
            data = await executeGeneration(FALLBACK_MODEL, false, 1);
        }
      }

      return response.status(200).json(data);

    } catch (error) {
      console.error("Generation API Failed:", error);
      return response.status(500).json({ error: error.message || "Internal Server Error" });
    }
  }

  return response.status(405).json({ error: "Method not allowed" });
}
