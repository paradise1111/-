
import React, { useState, useEffect } from 'react';
import { X, Save, Server, Key, Box } from 'lucide-react';
import { UserConfig } from '../types';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (config: UserConfig) => void;
  initialConfig: UserConfig;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose, onSave, initialConfig }) => {
  const [config, setConfig] = useState<UserConfig>(initialConfig);

  useEffect(() => {
    if (isOpen) {
      setConfig(initialConfig);
    }
  }, [isOpen, initialConfig]);

  if (!isOpen) return null;

  const handleChange = (key: keyof UserConfig, value: string) => {
    setConfig(prev => ({ ...prev, [key]: value }));
  };

  const handleSave = () => {
    onSave(config);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-[#111] border border-white/10 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl animate-scanline">
        
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-white/5 bg-white/5">
          <h2 className="text-xl font-light text-white flex items-center gap-2">
            <Server className="w-5 h-5 text-blue-400" />
            API Gateway Config
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5">
          
          <div className="space-y-2">
            <label className="text-xs uppercase tracking-wider text-gray-500 font-mono flex items-center gap-2">
              <Key className="w-3 h-3" /> Custom API Key
            </label>
            <input
              type="password"
              placeholder="sk-..."
              value={config.apiKey || ''}
              onChange={(e) => handleChange('apiKey', e.target.value)}
              className="w-full bg-black/50 border border-white/10 rounded-lg px-4 py-3 text-sm text-white focus:outline-none focus:border-blue-500/50 transition-colors placeholder:text-gray-700"
            />
            <p className="text-[10px] text-gray-600">Leave empty to use server default.</p>
          </div>

          <div className="space-y-2">
            <label className="text-xs uppercase tracking-wider text-gray-500 font-mono flex items-center gap-2">
              <Server className="w-3 h-3" /> Base URL (Optional)
            </label>
            <input
              type="text"
              placeholder="https://generativelanguage.googleapis.com"
              value={config.baseUrl || ''}
              onChange={(e) => handleChange('baseUrl', e.target.value)}
              className="w-full bg-black/50 border border-white/10 rounded-lg px-4 py-3 text-sm text-white focus:outline-none focus:border-blue-500/50 transition-colors placeholder:text-gray-700"
            />
            <p className="text-[10px] text-gray-600">Compatible with NewAPI / OneAPI proxies.</p>
          </div>

          <div className="space-y-2">
            <label className="text-xs uppercase tracking-wider text-gray-500 font-mono flex items-center gap-2">
              <Box className="w-3 h-3" /> Model ID
            </label>
            <input
              type="text"
              placeholder="gemini-3-pro-preview"
              value={config.modelId || ''}
              onChange={(e) => handleChange('modelId', e.target.value)}
              className="w-full bg-black/50 border border-white/10 rounded-lg px-4 py-3 text-sm text-white focus:outline-none focus:border-blue-500/50 transition-colors placeholder:text-gray-700"
            />
          </div>

        </div>

        {/* Footer */}
        <div className="p-6 border-t border-white/5 bg-white/2 flex justify-end">
          <button
            onClick={handleSave}
            className="flex items-center gap-2 bg-white text-black px-6 py-2 rounded-lg text-sm font-medium hover:bg-gray-200 transition-colors"
          >
            <Save className="w-4 h-4" />
            Save Configuration
          </button>
        </div>

      </div>
    </div>
  );
};
