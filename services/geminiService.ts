import { GoogleGenAI, Type, Schema } from "@google/genai";
import { GeneratedContent, NewsItem } from "../types";

// Initialize the client
// 支持自定义 Base URL (用于中转/代理 API)
// 如果 process.env.GEMINI_BASE_URL 存在，SDK 将使用该地址替代默认的 googleapis.com
const ai = new GoogleGenAI({ 
  apiKey: process.env.API_KEY,
  baseUrl: process.env.GEMINI_BASE_URL || undefined
});

// Using the PRO model for complex reasoning and JSON formatting
const PRIMARY_MODEL = 'gemini-3-pro-preview';
// Fallback to Flash for better stability/speed if Pro fails
const FALLBACK_MODEL = 'gemini-3-flash-preview'; 

export const checkConnectivity = async (): Promise<boolean> => {
  try {
    // Simple handshake
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview', // Use flash for quick check
      contents: 'ping',
    });
    return !!response.text;
  } catch (error) {
    console.error("Connectivity check failed:", error);
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

      // Only add thinking config if explicitly requested
      if (useThinking) {
        config.thinkingConfig = { thinkingBudget: 1024 }; // Reduced budget to avoid timeouts
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
        return executeGeneration(model, useThinking, retryCount - 1);
      }
      throw error;
    }
  };

  // Stability Priority Strategy
  try {
    return await executeGeneration(PRIMARY_MODEL, true, 0); 
  } catch (e1) {
    console.warn("Primary strategy failed. Attempting failover 1 (Pro without thinking)...", e1);
    try {
      return await executeGeneration(PRIMARY_MODEL, false, 1); 
    } catch (e2) {
      console.warn("Failover 1 failed. Attempting failover 2 (Flash)...", e2);
      return await executeGeneration(FALLBACK_MODEL, false, 1); 
    }
  }
};