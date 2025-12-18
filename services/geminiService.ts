import { GeneratedContent } from "../types";

// UI Display Fallback
// 前端仅用于显示默认的模型名称，不再处理实际逻辑
export const PRIMARY_MODEL = 'gemini-3-pro-preview';
export const FALLBACK_MODEL = 'gemini-3-flash-preview'; 

export const checkConnectivity = async (): Promise<boolean> => {
  try {
    // 调用后端 API 进行连通性检查
    const response = await fetch('/api/generate?check=true');
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

export const generateBriefing = async (targetDate: string): Promise<GeneratedContent> => {
  // 调用后端 API 进行生成，API Key 存储在后端环境中
  const response = await fetch('/api/generate', {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json'
    },
    body: JSON.stringify({ date: targetDate })
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(errData.error || `Server Error: ${response.status}`);
  }

  return await response.json();
};
