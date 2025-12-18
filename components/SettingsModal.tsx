
import React, { useState, useEffect } from 'react';
import { X, Save, Server, Key, Box, Link2, CheckCircle2, AlertTriangle, Loader2, RefreshCw } from 'lucide-react';
import { UserConfig } from '../types';
import { connectToOpenAI } from '../services/geminiService';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (config: UserConfig) => void;
  initialConfig: UserConfig;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose, onSave, initialConfig }) => {
  const [config, setConfig] = useState<UserConfig>(initialConfig);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [availableModels, setAvailableModels] = useState<{id: string}[]>([]);
  const [manualMode, setManualMode] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setConfig(initialConfig);
      setError(null);
      setSuccessMsg(null);
      setAvailableModels([]);
      // 如果已经有配置，尝试自动连接一次，或者保持安静
      if (initialConfig.modelId) {
          setManualMode(false);
      }
    }
  }, [isOpen, initialConfig]);

  const handleConnect = async () => {
    if (!config.baseUrl || !config.apiKey) {
        setError("Base URL 和 API Key 不能为空");
        return;
    }

    setIsLoading(true);
    setError(null);
    setSuccessMsg(null);
    setAvailableModels([]);

    try {
        // 调用 Tavern 风格的连接逻辑
        const models = await connectToOpenAI(config);
        
        setAvailableModels(models);
        setSuccessMsg(`连接成功! 获取到 ${models.length} 个模型`);
        setManualMode(false);

        // 如果当前没有选模型，或者选的模型不在列表中，默认选第一个
        if (!config.modelId || !models.find(m => m.id === config.modelId)) {
            if (models.length > 0) {
                setConfig(prev => ({ ...prev, modelId: models[0].id }));
            }
        }

    } catch (err: any) {
        console.error(err);
        setError(err.message || "连接失败");
        setManualMode(true); // 失败自动开启手动模式
    } finally {
        setIsLoading(false);
    }
  };

  const handleSave = () => {
    onSave(config);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
      <div className="bg-[#1a1a1a] border border-white/10 rounded-xl w-full max-w-lg shadow-2xl flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-white/5">
          <h2 className="text-lg font-medium text-white flex items-center gap-2">
            <Link2 className="w-5 h-5 text-blue-500" />
            API Connection
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6 overflow-y-auto custom-scrollbar">
            
            {/* 1. API Configuration */}
            <div className="space-y-4">
                <div className="space-y-1">
                    <label className="text-xs font-mono text-gray-500 uppercase">API Base URL</label>
                    <div className="relative">
                        <Server className="absolute left-3 top-3 w-4 h-4 text-gray-500" />
                        <input 
                            type="text" 
                            className="w-full bg-black/40 border border-white/10 rounded-lg py-2.5 pl-10 pr-4 text-sm text-gray-200 focus:outline-none focus:border-blue-500 transition-colors placeholder:text-gray-700 font-mono"
                            placeholder="https://api.openai.com/v1" 
                            value={config.baseUrl || ''}
                            onChange={e => {
                                setConfig({...config, baseUrl: e.target.value});
                                setError(null);
                            }}
                        />
                    </div>
                    <p className="text-[10px] text-gray-600 pl-1">
                        *请输入类似 OneAPI/NewAPI 的中转地址 (无需 /v1 后缀，系统会自动处理)
                    </p>
                </div>

                <div className="space-y-1">
                    <label className="text-xs font-mono text-gray-500 uppercase">API Key</label>
                    <div className="relative">
                        <Key className="absolute left-3 top-3 w-4 h-4 text-gray-500" />
                        <input 
                            type="password" 
                            className="w-full bg-black/40 border border-white/10 rounded-lg py-2.5 pl-10 pr-4 text-sm text-gray-200 focus:outline-none focus:border-blue-500 transition-colors placeholder:text-gray-700 font-mono"
                            placeholder="sk-..." 
                            value={config.apiKey || ''}
                            onChange={e => {
                                setConfig({...config, apiKey: e.target.value});
                                setError(null);
                            }}
                        />
                    </div>
                </div>

                <button 
                    onClick={handleConnect}
                    disabled={isLoading || !config.baseUrl || !config.apiKey}
                    className={`w-full py-2.5 rounded-lg text-sm font-medium flex items-center justify-center gap-2 transition-all ${
                        isLoading ? 'bg-gray-700 cursor-not-allowed' : 
                        'bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-900/20'
                    }`}
                >
                    {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                    {isLoading ? "Connecting..." : "Connect & Fetch Models"}
                </button>

                {/* Status Messages */}
                {error && (
                    <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 flex items-start gap-2 text-red-400 text-xs">
                        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                        <span className="break-all">{error}</span>
                    </div>
                )}
                {successMsg && (
                    <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-3 flex items-center gap-2 text-emerald-400 text-xs">
                        <CheckCircle2 className="w-4 h-4" />
                        {successMsg}
                    </div>
                )}
            </div>

            <hr className="border-white/5" />

            {/* 2. Model Selection */}
            <div className="space-y-4">
                <div className="flex justify-between items-center">
                    <label className="text-xs font-mono text-gray-500 uppercase">Select Model</label>
                    <button 
                        onClick={() => setManualMode(!manualMode)}
                        className="text-[10px] text-blue-400 hover:underline"
                    >
                        {manualMode ? "Switch to List" : "Manual Input"}
                    </button>
                </div>

                {!manualMode && availableModels.length > 0 ? (
                    <div className="relative">
                         <Box className="absolute left-3 top-3 w-4 h-4 text-gray-500 pointer-events-none" />
                        <select 
                            className="w-full bg-black/40 border border-white/10 rounded-lg py-2.5 pl-10 pr-8 text-sm text-white focus:outline-none focus:border-blue-500 appearance-none cursor-pointer"
                            value={config.modelId || ''}
                            onChange={e => setConfig({...config, modelId: e.target.value})}
                        >
                            {availableModels.map(m => (
                                <option key={m.id} value={m.id}>{m.id}</option>
                            ))}
                        </select>
                         <div className="absolute right-3 top-3 text-gray-500 pointer-events-none text-xs">▼</div>
                    </div>
                ) : (
                    <div className="relative">
                        <Box className="absolute left-3 top-3 w-4 h-4 text-gray-500" />
                        <input 
                            type="text" 
                            className="w-full bg-black/40 border border-white/10 rounded-lg py-2.5 pl-10 pr-4 text-sm text-gray-200 focus:outline-none focus:border-blue-500 transition-colors placeholder:text-gray-700"
                            placeholder="e.g. gemini-1.5-pro" 
                            value={config.modelId || ''}
                            onChange={e => setConfig({...config, modelId: e.target.value})}
                        />
                    </div>
                )}
            </div>

        </div>

        {/* Footer */}
        <div className="p-5 border-t border-white/5 bg-white/[0.02] flex justify-end">
          <button
            onClick={handleSave}
            disabled={!config.modelId}
            className="flex items-center gap-2 bg-white text-black px-6 py-2 rounded-lg text-sm font-medium hover:bg-gray-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Save className="w-4 h-4" />
            Save Configuration
          </button>
        </div>

      </div>
    </div>
  );
};
