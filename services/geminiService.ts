import { GoogleGenAI, Type, Schema } from "@google/genai";
import { GeneratedContent, NewsItem } from "../types";

// Initialize the client
const ai = new GoogleGenAI({ 
  apiKey: process.env.API_KEY
});

// 配置模型: 优先使用环境变量中指定的模型 ID
// 如果没有指定，则默认使用 gemini-3-pro-preview
export const PRIMARY_MODEL = process.env.GEMINI_MODEL_ID || 'gemini-3-pro-preview';
// 备用模型也可以配置，默认 gemini-3-flash-preview
export const FALLBACK_MODEL = process.env.GEMINI_FALLBACK_MODEL_ID || 'gemini-3-flash-preview'; 

export const checkConnectivity = async (): Promise<boolean> => {
  try {
    // 使用主模型进行握手，确保你选择的那个模型是可用的
    const response = await ai.models.generateContent({
      model: PRIMARY_MODEL, 
      contents: 'ping',
    });
    return !!response.text;
  } catch (error) {
    console.error(`Connectivity check failed for model ${PRIMARY_MODEL}:`, error);
    return false;
  }
};

const newsItemSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    title_cn: { type: Type.STRING, description: "新闻中文标题" },
    title_en: { type: Type.STRING, description: "新闻英文标题" },
    summary_cn: { type: Type.STRING, description: "简洁的中文摘要" },
    summary_en: { type: Type.STRING, description: "简洁的英文摘要" },
    source_url: { type: Type.STRING, description: "必须是真实可访问的来源链接 (URL)" },
    source_name: { type: Type.STRING, description: "发布媒体名称 (如 BBC, Xinhua, CNN)" },
  },
  required: ["title_cn", "title_en", "summary_cn", "summary_en", "source_url", "source_name"],
};

const responseSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    viral_titles: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: "3个针对'全球时政'的小红书风格标题（情绪化+利益导向）",
    },
    medical_viral_titles: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: "3个专门针对'医学/健康'板块的小红书爆款标题（例如：'警告：这种习惯正在...'，'最新研究：...'）",
    },
    general_news: {
      type: Type.ARRAY,
      items: newsItemSchema,
      description: "6条热门全球/政治新闻，必须包含真实链接",
    },
    medical_news: {
      type: Type.ARRAY,
      items: newsItemSchema,
      description: "6条医学/健康/科学新闻，必须包含真实链接",
    },
    date: { type: Type.STRING, description: "新闻日期 (YYYY-MM-DD)" },
  },
  required: ["viral_titles", "medical_viral_titles", "general_news", "medical_news", "date"],
};

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const generateBriefing = async (targetDate: string): Promise<GeneratedContent> => {
  const prompt = `
    你是一位专业的资深新闻编辑和双语内容创作者。
    
    当前任务：
    1. 搜索昨日（${targetDate}）的新闻。
    2. 精选 6 条重大的全球/政治/经济新闻。
    3. 精选 6 条重大的医学/健康/科学文献突破。
    
    关键要求：
    - **链接验证**：你必须使用 Google Search 工具。对于每一条新闻，必须提供一个真实、有效、可点击的原始新闻链接 (source_url)。严禁捏造链接。如果找不到链接，就换一条新闻。
    - **医学爆款标题**：请根据搜索到的医学/健康新闻，总结出 3 个极具吸引力、符合"小红书"调性的爆款标题（medical_viral_titles）。
    - **全球爆款标题**：请根据搜索到的时政新闻，总结出 3 个全球新闻的爆款标题（viral_titles）。
    - **双语对应**：输出必须是严格的双语（中文和英文）。

    请严格遵守提供的 JSON 架构返回数据。
  `;

  // Helper function to handle generation with retries
  const executeGeneration = async (
    model: string, 
    useThinking: boolean, 
    retryCount: number
  ): Promise<GeneratedContent> => {
    try {
      const config: any = {
        tools: [{ googleSearch: {} }],
        responseMimeType: "application/json",
        responseSchema: responseSchema,
      };

      // 只有显式指定的 Gemini 2.5/3 系列模型才开启 Thinking
      // 如果使用自定义模型 (如 gpt-4o, claude)，通常不支持 thinkingConfig 参数，需要通过逻辑判断关闭
      // 这里简单处理：只有当 useThinking 为 true 且不是自定义模型时才加，或者依赖 try-catch 回退
      if (useThinking) {
        config.thinkingConfig = { thinkingBudget: 1024 }; 
      }

      const response = await ai.models.generateContent({
        model: model,
        contents: prompt,
        config: config,
      });

      const text = response.text;
      if (!text) throw new Error("未生成任何内容");

      return JSON.parse(text) as GeneratedContent;

    } catch (error) {
      if (retryCount > 0) {
        console.warn(`Generation failed with model ${model} (Thinking: ${useThinking}). Retrying in 1s...`, error);
        await delay(1000);
        // Retry with thinking disabled if it failed initially
        return executeGeneration(model, false, retryCount - 1);
      }
      throw error;
    }
  };

  // Stability Priority Strategy
  try {
    // 默认首选尝试：使用主模型。如果是 Gemini 原生模型，尝试开启 Thinking (需自行判断模型是否支持，这里先默认开启尝试)
    // 如果是第三方模型，Thinking 可能会导致报错，catch 住后会回退到 false
    // 为了稳妥，如果用户设置了自定义 ID，我们默认先不开启 Thinking，除非确认支持
    const isGeminiNative = PRIMARY_MODEL.includes('gemini-3') || PRIMARY_MODEL.includes('gemini-2.5');
    return await executeGeneration(PRIMARY_MODEL, isGeminiNative, 0); 
  } catch (e1) {
    console.warn(`Primary strategy (${PRIMARY_MODEL}) failed. Attempting retry...`, e1);
    try {
       // 重试主模型，关闭 Thinking
      return await executeGeneration(PRIMARY_MODEL, false, 1); 
    } catch (e2) {
      console.warn(`Retry failed. Attempting fallback model (${FALLBACK_MODEL})...`, e2);
      // 只有当主模型彻底失败，才使用备用模型
      return await executeGeneration(FALLBACK_MODEL, false, 1); 
    }
  }
};