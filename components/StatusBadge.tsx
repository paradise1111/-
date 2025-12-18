import React from 'react';

interface StatusBadgeProps {
  status: 'online' | 'offline' | 'busy';
  text?: string;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, text }) => {
  const colorMap = {
    online: 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]',
    offline: 'bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.5)]',
    busy: 'bg-amber-400 shadow-[0_0_10px_rgba(251,191,36,0.5)]',
  };

  const label = text || (status === 'online' ? '系统运转正常' : status === 'busy' ? '正在处理任务...' : '系统离线');

  return (
    <div className="flex items-center gap-3 bg-black/20 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/5">
      <div className="relative flex h-2.5 w-2.5">
        <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${colorMap[status]}`}></span>
        <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${colorMap[status]}`}></span>
      </div>
      <span className="text-xs font-medium tracking-wide text-gray-300 uppercase">{label}</span>
    </div>
  );
};