import { forwardRef } from 'react';
import { motion } from 'framer-motion';

const variants = {
  primary:  'bg-px-purple-500 hover:bg-px-purple-600 text-white',
  secondary:'bg-px-elevated hover:bg-px-border text-px-text border border-px-border',
  danger:   'bg-px-red-500 hover:bg-px-red-600 text-white',
  ghost:    'bg-transparent hover:bg-px-elevated text-px-muted hover:text-px-text',
  gradient: 'px-gradient text-white hover:opacity-90',
};

const sizes = {
  sm: 'px-3 py-1.5 text-sm rounded-lg',
  md: 'px-4 py-2 text-sm rounded-xl',
  lg: 'px-6 py-3 text-base rounded-xl',
};

const Button = forwardRef(({ variant = 'primary', size = 'md', className = '', loading, disabled, children, ...props }, ref) => {
  return (
    <motion.button
      ref={ref}
      whileTap={{ scale: 0.97 }}
      className={`
        inline-flex items-center justify-center gap-2 font-medium transition-all duration-200
        disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer
        ${variants[variant]} ${sizes[size]} ${className}
      `}
      disabled={disabled || loading}
      {...props}
    >
      {loading && (
        <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      )}
      {children}
    </motion.button>
  );
});

Button.displayName = 'Button';
export default Button;
