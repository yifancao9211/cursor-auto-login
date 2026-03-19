/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./ui/**/*.{vue,js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        apple: {
          bg: '#f5f5f7',
          sidebar: '#f0f0f2',
          card: 'rgba(255, 255, 255, 0.72)',
          text: '#1d1d1f',
          textMuted: '#6e6e73',
          border: 'rgba(0,0,0,0.06)',
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
        'apple-sm': '0 1px 3px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.06)',
        'apple': '0 4px 12px rgba(0,0,0,0.06), 0 1px 3px rgba(0,0,0,0.04)',
        'apple-lg': '0 8px 30px rgba(0,0,0,0.08), 0 2px 8px rgba(0,0,0,0.04)',
      }
    },
  },
  plugins: [],
}
