
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

  // Helper to safely decode headers
  const getHeader = (key) => {
    const val = request.headers[key];
    if (!val) return undefined;
    try {
        return decodeURIComponent(val);
    } catch (e) {
        return val; // Fallback to raw value if decoding fails
    }
  };

  // 1. 获取配置
  const customApiKey = getHeader('x-custom-api-key');
  const customBaseUrl = getHeader('x-custom-base-url');
  const customModel = getHeader('x-custom-model');

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
    let url = customBaseUrl.trim();
    if (!url.startsWith('http')) url = `https://${url}`;
    // 去掉末尾的 /，防止双重斜杠问题
    if (url.endsWith('/')) url = url.slice(0, -1);
    clientOptions.baseUrl = url;
  }

  const ai = new GoogleGenAI(clientOptions);
  
  // 模型配置
  const PRIMARY_MODEL = customModel || process.env.GEMINI_MODEL_ID || 'gemini-3-pro-preview';
  const FALLBACK_MODEL = process.env.GEMINI_FALLBACK_MODEL_ID || 'gemini-3-flash-preview';

  // Helper: 安全处理模型名称
  // 如果模型名称包含特殊字符（如 [] 或中文），而 SDK 没有进行编码，可能会导致 HTTP 400 错误。
  // 我们检测如果包含非URL安全字符，则进行编码。
  const sanitizeModelName = (name) => {
      if (!name) return name;
      // 检查是否包含除了字母、数字、点、横线、下划线以外的字符
      if (/[^a-zA-Z0-9.\-_]/.test(name)) {
          console.log(`Model name '${name}' contains special characters. Applying URI encoding.`);
          return encodeURIComponent(name);
      }
      return name;
  };

  // --- 模式 1: 连通性检查 (GET) ---
  if (request.method === 'GET' && request.query.check === 'true') {
    try {
      const safeModel = sanitizeModelName(PRIMARY_MODEL);
      await ai.models.generateContent({
        model: safeModel,
        contents: 'ping',
      });
      return response.status(200).json({ success: true, model: PRIMARY_MODEL });
    } catch (error) {
      console.error("Connectivity check failed:", error);
      // 返回详细错误
      return response.status(500).json({ success: false, error: error.toString() });
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

      // 内部函数：执行生成
      const executeGeneration = async (modelName, useThinking, retries = 0) => {
        try {
          // 应用 URL 编码以修复 [channel] 格式的 400 错误
          const safeModel = sanitizeModelName(modelName);

          console.log(`Generating with model: ${safeModel} (raw: ${modelName}), thinking: ${useThinking}`);
          const config = {
            tools: [{ googleSearch: {} }],
            responseMimeType: "application/json",
            responseSchema: responseSchema,
          };
          
          if (useThinking) {
             config.thinkingConfig = { thinkingBudget: 1024 };
          }

          const result = await ai.models.generateContent({
            model: safeModel,
            contents: prompt,
            config: config,
          });

          return JSON.parse(result.text);
        } catch (err) {
          if (retries > 0) {
            console.warn(`Retry needed for ${modelName}. Error: ${err.message}. Remaining: ${retries - 1}`);
            await new Promise(r => setTimeout(r, 1000));
            return executeGeneration(modelName, false, retries - 1);
          }
          throw err;
        }
      };

      // 稳定性策略
      let data;
      try {
        const isNative = PRIMARY_MODEL.includes('gemini-3') || PRIMARY_MODEL.includes('gemini-2.5');
        data = await executeGeneration(PRIMARY_MODEL, isNative, 0);
      } catch (e1) {
        console.warn("Primary attempt failed, retrying without thinking...", e1);
        try {
            data = await executeGeneration(PRIMARY_MODEL, false, 1);
        } catch (e2) {
            console.warn("Primary model failed completely, switching to fallback...", e2);
            // 这里 Fallback 模型通常是标准的 'gemini-3-flash-preview'，不需要编码
            data = await executeGeneration(FALLBACK_MODEL, false, 1);
        }
      }

      return response.status(200).json(data);

    } catch (error) {
      console.error("Generation API Failed:", error);
      // 透传上游错误信息
      const errorMsg = error.response ? JSON.stringify(error.response) : error.message;
      return response.status(500).json({ error: errorMsg || "Internal Server Error" });
    }
  }

  return response.status(405).json({ error: "Method not allowed" });
}
