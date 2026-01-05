import { cn } from '@/lib/utils';

interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  color?: 'violet' | 'orange' | 'blue' | 'green';
  className?: string;
  text?: string;
}

const sizeClasses = {
  sm: 'w-4 h-4',
  md: 'w-6 h-6',
  lg: 'w-8 h-8',
};

const colorClasses = {
  violet: 'text-violet-500',
  orange: 'text-orange-500',
  blue: 'text-blue-500',
  green: 'text-green-500',
};

export function Spinner({ size = 'md', color = 'violet', className, text }: SpinnerProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center', className)}>
      <svg 
        className={cn('animate-spin', colorClasses[color], sizeClasses[size])} 
        fill="none" 
        viewBox="0 0 24 24"
      >
        <circle 
          className="opacity-25" 
          cx="12" 
          cy="12" 
          r="10" 
          stroke="currentColor" 
          strokeWidth="4" 
        />
        <path 
          className="opacity-75" 
          fill="currentColor" 
          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" 
        />
      </svg>
      {text && <p className="text-slate-400 mt-2 text-sm">{text}</p>}
    </div>
  );
}

// Full page loading state
export function LoadingState({ text = 'Đang tải...', color = 'violet' }: { text?: string; color?: 'violet' | 'orange' | 'blue' | 'green' }) {
  return (
    <div className="h-full flex items-center justify-center">
      <Spinner size="lg" color={color} text={text} />
    </div>
  );
}
