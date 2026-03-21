/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: [
    "./index.html",
    "./ui/**/*.{vue,js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        apple: {
          bg: 'var(--apple-bg)',
          sidebar: 'var(--apple-sidebar)',
          card: 'var(--apple-card)',
          text: 'var(--apple-text)',
          textMuted: 'var(--apple-textMuted)',
          border: 'var(--apple-border)',
          accent: '#007AFF',
          success: '#34C759',
          danger: '#FF3B30',
          warning: '#FF9500'
        }
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', '"SF Pro Display"', '"SF Pro Text"', 'sans-serif'],
        mono: ['"SF Mono"', 'Menlo', 'monospace']
      },
      boxShadow: {
        'apple-sm': '0 1px 3px var(--shadow-color, rgba(0,0,0,0.04)), 0 1px 2px var(--shadow-color, rgba(0,0,0,0.06))',
        'apple': '0 4px 12px var(--shadow-color, rgba(0,0,0,0.06)), 0 1px 3px var(--shadow-color, rgba(0,0,0,0.04))',
        'apple-lg': '0 8px 30px var(--shadow-color, rgba(0,0,0,0.08)), 0 2px 8px var(--shadow-color, rgba(0,0,0,0.04))',
      }
    },
  },
  plugins: [],
}
