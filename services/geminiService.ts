
import { GeneratedContent, UserConfig } from "../types";

// UI Display Fallback
export const PRIMARY_MODEL = 'gemini-3-pro-preview';
export const FALLBACK_MODEL = 'gemini-3-flash-preview'; 

// Helper to safely encode headers (handles Chinese/Special chars)
const safeEncode = (val?: string) => val ? encodeURIComponent(val.trim()) : undefined;

export const checkConnectivity = async (config?: UserConfig): Promise<boolean> => {
  try {
    const headers: Record<string, string> = {};
    
    // Encode values to prevent "String contains non ISO-8859-1 code point" error
    if (config?.apiKey) headers['x-custom-api-key'] = safeEncode(config.apiKey)!;
    if (config?.baseUrl) headers['x-custom-base-url'] = safeEncode(config.baseUrl)!;
    if (config?.modelId) headers['x-custom-model'] = safeEncode(config.modelId)!;

    // 调用后端 API 进行连通性检查
    const response = await fetch('/api/generate?check=true', { headers });
    if (response.ok) {
        const data = await response.json();
        return data.success;
    }
    return false;
  } catch (error) {
    console.error("Backend connectivity check failed:", error);
    return false;
  }
};

export const generateBriefing = async (targetDate: string, config?: UserConfig): Promise<GeneratedContent> => {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  };
  
  // Encode values to prevent "String contains non ISO-8859-1 code point" error
  if (config?.apiKey) headers['x-custom-api-key'] = safeEncode(config.apiKey)!;
  if (config?.baseUrl) headers['x-custom-base-url'] = safeEncode(config.baseUrl)!;
  if (config?.modelId) headers['x-custom-model'] = safeEncode(config.modelId)!;

  // 调用后端 API 进行生成
  const response = await fetch('/api/generate', {
    method: 'POST',
    headers: headers,
    body: JSON.stringify({ date: targetDate })
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(errData.error || `Server Error: ${response.status}`);
  }

  return await response.json();
};
