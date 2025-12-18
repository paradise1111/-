
import React, { useState, useEffect, useRef } from 'react';
import { Activity, Globe, HeartPulse, RefreshCw, Server, ShieldCheck, Sparkles, Mail, Send, Stethoscope, Settings, Timer } from 'lucide-react';
import { GlassCard } from './components/GlassCard';
import { StatusBadge } from './components/StatusBadge';
import { TypewriterText } from './components/TypewriterText';
import { SettingsModal } from './components/SettingsModal';
import { checkConnectivity, generateBriefing, PRIMARY_MODEL } from './services/geminiService';
import { sendEmail } from './services/emailService';
import { AppStatus, GeneratedContent, NewsItem, UserConfig } from './types';

const NewsCard: React.FC<{ item: NewsItem; idx: number; color: 'blue' | 'emerald' }> = ({ item, idx, color }) => (
  <GlassCard className="h-full flex flex-col" delay={idx * 100}>
    <div className="flex justify-between items-start mb-3">
      <span className={`text-xs font-mono px-2 py-1 rounded border ${color === 'blue' ? 'border-blue-500/30 text-blue-300' : 'border-emerald-500/30 text-emerald-300'}`}>
        {item.source_name || 'Source'}
      </span>
      <a href={item.source_url} target="_blank" rel="noopener noreferrer" className="text-gray-500 hover:text-white transition-colors">
        <Globe size={14} />
      </a>
    </div>
    <h3 className="text-lg font-medium text-white mb-1 leading-snug">{item.title_cn}</h3>
    <p className="text-xs text-gray-500 mb-3 font-light">{item.title_en}</p>
    <p className="text-sm text-gray-300 leading-relaxed flex-grow">{item.summary_cn}</p>
  </GlassCard>
);

export default function App() {
  const [status, setStatus] = useState<AppStatus>(AppStatus.IDLE);
  const [data, setData] = useState<GeneratedContent | null>(null);
  const [progressLog, setProgressLog] = useState<string[]>([]);
  const [emails, setEmails] = useState<string[]>(['', '', '']);
  const [isSendingEmail, setIsSendingEmail] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [userConfig, setUserConfig] = useState<UserConfig>({});
  const [cooldown, setCooldown] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const today = new Date();
  const beijingTime = new Date(today.getTime() + (8 * 60 + today.getTimezoneOffset()) * 60 * 1000);
  const yesterday = new Date(beijingTime);
  yesterday.setDate(yesterday.getDate() - 1);
  const targetDateStr = yesterday.toISOString().split('T')[0];

  useEffect(() => {
    const saved = localStorage.getItem('aurora_config');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setUserConfig(parsed);
        initConnection(parsed);
      } catch {
        initConnection({});
      }
    } else {
        initConnection({});
    }
  }, []);

  // Cooldown Timer
  useEffect(() => {
    if (cooldown > 0) {
      const timer = setInterval(() => setCooldown(c => c - 1), 1000);
      return () => clearInterval(timer);
    }
  }, [cooldown]);

  const initConnection = async (config: UserConfig) => {
    setStatus(AppStatus.CONNECTING);
    addLog(`🌐 正在检测节点连接性...`);
    const isConnected = await checkConnectivity(config);
    if (isConnected) {
      setStatus(AppStatus.IDLE);
      addLog(`✅ 节点就绪。`);
    } else {
      setStatus(AppStatus.ERROR);
      addLog(`❌ 节点离线。请检查 API Key 或 Base URL。`);
    }
  };

  const addLog = (msg: string) => {
    setProgressLog(prev => [...prev.slice(-49), `[${new Date().toLocaleTimeString()}] ${msg}`]);
    setTimeout(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }), 50);
  };

  const handleGenerate = async () => {
    if (status === AppStatus.GENERATING || status === AppStatus.SEARCHING || cooldown > 0) return;

    setStatus(AppStatus.SEARCHING);
    addLog(`🚀 启动生成序列 | 目标日期: ${targetDateStr}`);
    
    try {
      addLog("🔍 正在检索实时新闻数据 (可能需要 15-30 秒)...");
      const result = await generateBriefing(targetDateStr, userConfig);
      setData(result);
      setStatus(AppStatus.COMPLETED);
      addLog("✅ 生成成功！");
    } catch (e: any) {
      setStatus(AppStatus.ERROR);
      const isRateLimit = e.message.includes("429");
      addLog(`❌ 失败: ${e.message}`);
      
      if (isRateLimit) {
        addLog("⚠️ 系统过载。已触发安全冷却机制 (30秒)。");
        setCooldown(30);
      }
    }
  };

  const executeEmailSend = async (content: GeneratedContent | null) => {
    const activeEmails = emails.filter(e => e.trim() !== '');
    if (activeEmails.length === 0 || !content) return;
    setIsSendingEmail(true);
    addLog(`📧 正在推送至 ${activeEmails.length} 个地址...`);
    const result = await sendEmail(activeEmails, content);
    addLog(result.success ? `✅ ${result.message}` : `❌ ${result.message}`);
    setIsSendingEmail(false);
  };

  return (
    <div className="min-h-screen relative text-gray-200 selection:bg-indigo-500/30 font-sans">
      <SettingsModal 
        isOpen={isSettingsOpen} 
        onClose={() => setIsSettingsOpen(false)}
        onSave={(c) => { setUserConfig(c); localStorage.setItem('aurora_config', JSON.stringify(c)); initConnection(c); }}
        initialConfig={userConfig}
      />

      <div className="fixed inset-0 pointer-events-none z-0 aurora-gradient"></div>

      <div className="relative z-10 max-w-7xl mx-auto px-4 py-8">
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-12">
          <div>
            <h1 className="text-4xl font-light text-white mb-2">Aurora <span className="font-semibold text-transparent bg-clip-text bg-gradient-to-r from-blue-300 to-purple-300">News</span></h1>
            <p className="text-gray-500 text-sm flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-emerald-500" />多源检索验证系统</p>
          </div>
          <div className="flex items-center gap-4">
            <StatusBadge status={status === AppStatus.ERROR ? 'offline' : (status === AppStatus.IDLE || status === AppStatus.COMPLETED ? 'online' : 'busy')} />
            <button onClick={() => setIsSettingsOpen(true)} className="p-2 rounded-full bg-white/5 hover:bg-white/10 transition-colors"><Settings className="w-5 h-5" /></button>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* Controls */}
          <div className="lg:col-span-4 space-y-6">
            <GlassCard>
              <h2 className="text-lg font-medium text-white mb-6 flex items-center gap-2"><Server className="w-5 h-5 text-blue-400" />系统控制</h2>
              <div className="space-y-4">
                <div className="bg-black/40 rounded-lg p-4 text-sm font-mono space-y-2">
                  <div className="flex justify-between"><span className="text-gray-500">日期:</span><span>{targetDateStr}</span></div>
                  <div className="flex justify-between"><span className="text-gray-500">当前节点:</span><span className="text-emerald-400 truncate max-w-[120px]">{userConfig.modelId || PRIMARY_MODEL}</span></div>
                </div>

                <button
                  onClick={handleGenerate}
                  disabled={status === AppStatus.SEARCHING || status === AppStatus.GENERATING || cooldown > 0}
                  className={`w-full py-4 rounded-xl flex items-center justify-center gap-2 transition-all relative overflow-hidden ${
                    cooldown > 0 || status === AppStatus.SEARCHING || status === AppStatus.GENERATING 
                    ? 'bg-gray-800 text-gray-500 cursor-not-allowed' 
                    : 'bg-white text-black hover:bg-blue-50'
                  }`}
                >
                  {cooldown > 0 ? (
                    <><Timer className="w-5 h-5" /><span>冷却中 ({cooldown}s)</span></>
                  ) : status === AppStatus.SEARCHING || status === AppStatus.GENERATING ? (
                    <><RefreshCw className="w-5 h-5 animate-spin" /><span>处理中...</span></>
                  ) : (
                    <><Sparkles className="w-5 h-5" /><span>开始生成简报</span></>
                  )}
                </button>
              </div>
            </GlassCard>

            {/* Log */}
            <GlassCard className="h-[250px] flex flex-col">
              <div className="flex items-center gap-2 mb-4 text-xs font-mono uppercase text-gray-500 border-b border-white/5 pb-2">
                <Activity className="w-4 h-4 text-emerald-500" />系统日志
              </div>
              <div ref={scrollRef} className="flex-grow overflow-y-auto font-mono text-[10px] space-y-1.5 text-gray-400 pr-2">
                {progressLog.map((log, i) => <div key={i} className="animate-scanline"><span className="text-blue-500 mr-2">›</span>{log}</div>)}
              </div>
            </GlassCard>

            {/* Email */}
            <GlassCard className="space-y-4">
              <div className="flex items-center gap-2 text-white font-medium text-sm"><Mail className="w-4 h-4 text-purple-400" />推送列表</div>
              <div className="space-y-2">
                {emails.map((e, idx) => (
                  <input key={idx} type="email" placeholder={`邮箱 ${idx + 1}`} value={e} onChange={(ev) => { const n = [...emails]; n[idx] = ev.target.value; setEmails(n); }} className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm text-gray-300 focus:border-blue-500/50 outline-none transition-colors" />
                ))}
              </div>
              <button onClick={() => executeEmailSend(data)} disabled={isSendingEmail || !data} className="w-full py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-xs text-gray-300 transition-colors flex items-center justify-center gap-2 disabled:opacity-50">
                {isSendingEmail ? <RefreshCw className="w-3 h-3 animate-spin"/> : <Send className="w-3 h-3" />}发送预览邮件
              </button>
            </GlassCard>
          </div>

          {/* Result Content */}
          <div className="lg:col-span-8 space-y-6">
            {!data ? (
              <GlassCard className="h-full min-h-[500px] flex flex-col items-center justify-center text-center p-12">
                <div className="w-20 h-20 bg-white/5 rounded-full flex items-center justify-center mb-6 relative">
                  <Globe className="w-10 h-10 text-gray-600" />
                </div>
                <h3 className="text-xl font-light text-white mb-2">等待同步指令</h3>
                <p className="text-gray-500 text-sm max-w-sm">点击左侧“开始生成简报”，系统将通过 Gemini 模型进行全球实时新闻检索与双语摘要合成。</p>
              </GlassCard>
            ) : (
              <div className="space-y-6 animate-scanline">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <GlassCard className="bg-pink-500/5 border-pink-500/20">
                    <h3 className="text-pink-400 font-bold mb-3 flex items-center gap-2 text-sm"><Sparkles className="w-4 h-4" />全球热点</h3>
                    <ul className="space-y-2 text-sm">{data.viral_titles.map((t, i) => <li key={i} className="border-l-2 border-pink-500/30 pl-3 py-1"><TypewriterText text={t} speed={20} /></li>)}</ul>
                  </GlassCard>
                  <GlassCard className="bg-emerald-500/5 border-emerald-500/20">
                    <h3 className="text-emerald-400 font-bold mb-3 flex items-center gap-2 text-sm"><Stethoscope className="w-4 h-4" />健康趋势</h3>
                    <ul className="space-y-2 text-sm">{data.medical_viral_titles?.map((t, i) => <li key={i} className="border-l-2 border-emerald-500/30 pl-3 py-1"><TypewriterText text={t} speed={20} /></li>)}</ul>
                  </GlassCard>
                </div>

                <div className="space-y-8">
                  <section>
                    <h3 className="text-blue-400 font-light mb-4 flex items-center gap-2"><Globe className="w-5 h-5" /> 全球时政</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">{data.general_news.map((item, i) => <NewsCard key={i} item={item} idx={i} color="blue" />)}</div>
                  </section>
                  <section>
                    <h3 className="text-emerald-400 font-light mb-4 flex items-center gap-2"><HeartPulse className="w-5 h-5" /> 医学前沿</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">{data.medical_news.map((item, i) => <NewsCard key={i} item={item} idx={i} color="emerald" />)}</div>
                  </section>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
