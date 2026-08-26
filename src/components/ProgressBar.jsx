// src/components/ProgressBar.jsx — thin animated progress bar with optional label.
import React from 'react';

export default function ProgressBar({ value = 0, indeterminate = false, label = null, small = false }) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div className="w-full">
      {(label || !indeterminate) && (
        <div className={`flex justify-between mb-1 ${small ? 'text-[11px]' : 'text-xs'} text-zinc-400`}>
          <span className="truncate pr-2">{label}</span>
          {!indeterminate && <span>{pct}%</span>}
        </div>
      )}
      <div className={`${small ? 'h-1.5' : 'h-2'} w-full bg-neutral-800 rounded-full overflow-hidden`}>
        {indeterminate ? (
          <div className="h-full w-1/3 bg-accent rounded-full animate-[slide_1.2s_ease-in-out_infinite]" />
        ) : (
          <div
            className="h-full bg-accent rounded-full transition-all duration-300"
            style={{ width: `${pct}%` }}
          />
        )}
      </div>
      <style>{`@keyframes slide{0%{transform:translateX(-120%)}100%{transform:translateX(420%)}}`}</style>
    </div>
  );
}
