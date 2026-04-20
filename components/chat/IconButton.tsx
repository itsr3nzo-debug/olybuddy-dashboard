"use client";

import React from 'react';
import { cx } from '@/lib/chat/utils';

interface IconButtonProps {
  icon: React.ComponentType<{ size?: number }>;
  label: string;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  active?: boolean;
  size?: number;
  className?: string;
}

function IconButton({ icon: IconC, label, onClick, active, size = 16, className = '' }: IconButtonProps) {
  return (
    <div className="tooltip-wrap">
      <button
        type="button"
        aria-label={label}
        onClick={onClick}
        className={cx(
          'h-8 w-8 inline-flex items-center justify-center rounded-md transition-colors focus-ring',
          active ? 'bg-hover fg-base' : 'fg-subtle hover:bg-hover hover:fg-base',
          className
        )}
      >
        <IconC size={size} />
      </button>
      <span className="tooltip">{label}</span>
    </div>
  );
}

export default IconButton;
