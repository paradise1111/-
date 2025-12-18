
import { GoogleGenAI, Type } from "@google/genai";
import { GeneratedContent, UserConfig } from "../types";

// UI Display Fallback
export const PRIMARY_MODEL = 'gemini-3-pro-preview';

// Helper to sanitize model name
const sanitizeModelName = (name: string) => {
    if (!name) return name;
    if (/[^a-zA-Z0-9.\-_]/.test(name)) {
        return encodeURIComponent(name);
    }
    return name;
};

// Helper to clean Base URL
const cleanBaseUrl = (url?: string) => {
    if (!url) return 'https://generativelanguage.googleapis.com';
    let clean = url.trim();
    if (!clean.startsWith('http')) clean = `https://${clean}`;
    // Remove all suffixes to get the root
    clean = clean.replace(/\/$/, '');
    clean = clean.replace(/\/v1beta\/?$/, '');
    clean = clean.replace(/\/v1\/?$/, '');
    return clean;
};

// --- Tavern-Style Connection Logic ---

/**
 * 像酒馆一样，直接请求 OpenAI 标准的 /v1/models 接口
 */
export const connectToOpenAI = async (config: UserConfig): Promise<{ id: string, name?: string }[]> => {
    const apiKey = config.apiKey?.trim();
    const baseUrl = cleanBaseUrl(config.baseUrl);
    
    if (!apiKey) throw new Error("缺少 API Key");

    // 构造标准的 OpenAI 模型列表 URL
    const targetUrl = `${baseUrl}/v1/models`;

    try {
        console.log(`[Connection] Direct fetch: ${targetUrl}`);
        
        // 1. 尝试直连 (Direct Fetch)
        const response = await fetch(targetUrl, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            }
        });

        // 处理非 200 响应
        if (!response.ok) {
            // 如果是 404，可能是路径不对，或者该中转站不支持列表
            // 如果是 401，是 Key 错误
            // 如果是 502/500，是服务器错误
            const errText = await response.text();
            throw new Error(`HTTP ${response.status}: ${errText.substring(0, 100)}`);
        }

        const data = await response.json();
        
        // 解析 OpenAI 标准格式: { data: [{ id: "..." }, ...] }
        let models: any[] = [];
        if (Array.isArray(data.data)) {
            models = data.data;
        } else if (Array.isArray(data.models)) {
            // 兼容部分非标接口
            models = data.models;
        } else if (Array.isArray(data)) {
            // 兼容直接返回数组
            models = data;
        }

        if (models.length === 0) {
            throw new Error("连接成功，但返回的模型列表为空");
        }

        // 映射并排序
        return models
            .map((m: any) => ({ id: m.id, name: m.id }))
            .sort((a, b) => a.id.localeCompare(b.id));

    } catch (error: any) {
        // 2. 如果直连失败（通常是 CORS 跨域问题），尝试通过后端代理转发
        if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
            console.warn(`[Connection] Direct fetch failed (CORS?), trying proxy...`);
            return connectViaProxy(baseUrl, apiKey);
        }
        throw error;
    }
};

/**
 * 通过本地域 API 代理转发请求 (解决 CORS 问题)
 */
const connectViaProxy = async (baseUrl: string, apiKey: string) => {
    try {
        const proxyUrl = `/api/generate?action=list_models`;
        const response = await fetch(proxyUrl, {
            headers: {
                'x-custom-base-url': encodeURIComponent(baseUrl),
                'x-custom-api-key': encodeURIComponent(apiKey)
            }
        });

        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error || `Proxy Error: ${response.status}`);
        }

        const data = await response.json();
        return data.models.map((m: any) => ({ id: m.id, name: m.id }));
    } catch (e: any) {
        throw new Error(`连接失败: ${e.message}`);
    }
};

// --- Generation ---

export const checkConnectivity = async (config?: UserConfig): Promise<boolean> => {
    // 简化版 Check: 只要能列出模型，就认为连接成功
    try {
        if (!config?.apiKey) return false;
        await connectToOpenAI(config);
        return true;
    } catch (e) {
        console.error("Connectivity check failed:", e);
        return false;
    }
};

export const generateBriefing = async (targetDate: string, config?: UserConfig): Promise<GeneratedContent> => {
    const apiKey = config?.apiKey || process.env.API_KEY || '';
    if (!apiKey) throw new Error("API Key is required.");

    const baseUrl = cleanBaseUrl(config?.baseUrl);
    
    // SDK 初始化
    // 注意：即便我们用 OpenAI 格式获取了模型列表，生成时使用的是 Google SDK
    // 大多数中转站 (OneAPI/NewAPI) 会自动根据路径识别请求类型
    const ai = new GoogleGenAI({ 
        apiKey: apiKey, 
        baseUrl: baseUrl,
        apiVersion: 'v1beta' // 默认保持 v1beta，兼容性最好
    } as any);
    
    const modelId = config?.modelId || PRIMARY_MODEL;
    const safeModelId = sanitizeModelName(modelId);
    
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
      1. 搜索昨日（${targetDate}）的新闻。
      2. 精选 6 条重大的全球/政治/经济新闻。
      3. 精选 6 条重大的医学/健康/科学文献突破。
      关键要求：
      - 必须使用 Google Search 工具。
      - 必须提供真实、可访问的 source_url。
      - 为医学板块生成 3 个小红书风格爆款标题 (medical_viral_titles)。
      - 为时政板块生成 3 个小红书风格爆款标题 (viral_titles)。
      - 双语对应。
    `;

    const genConfig: any = {
      tools: [{ googleSearch: {} }],
      responseMimeType: "application/json",
      responseSchema: responseSchema,
    };

    // 如果是 gemini-3/2.5 系列，添加思考配置
    if (modelId.includes('gemini-3') || modelId.includes('gemini-2.5')) {
       // genConfig.thinkingConfig = { thinkingBudget: 1024 }; // 可选开启
    }

    try {
        console.log(`Generating with ${safeModelId} via ${baseUrl}...`);
        
        // 直接调用 SDK
        const result = await ai.models.generateContent({
          model: safeModelId,
          contents: prompt,
          config: genConfig,
        });

        if (!result.text) throw new Error("Empty response from model");
        return JSON.parse(result.text);

    } catch (e: any) {
         // 错误处理: 如果 404，尝试使用原始 ID 重试
         const isNotFound = (err: any) => {
            const msg = err.message || JSON.stringify(err);
            return msg.includes('404') || msg.includes('NOT_FOUND');
         };

        if (isNotFound(e) && safeModelId !== modelId) {
           console.warn("Sanitized ID failed (404), retrying with raw ID...");
           const resultRetry = await ai.models.generateContent({
                model: modelId,
                contents: prompt,
                config: genConfig,
            });
            return JSON.parse(resultRetry.text);
        }
        throw e;
    }
};
