/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Brand palette
        primary: {
          50: '#faf5ff',
          100: '#f3e8ff',
          500: '#7e22ce',   // dark purple tone
          600: '#6b21a8',
          700: '#581c87',
        },
        secondary: {
          50: '#fff7ed',
          100: '#ffedd5',
          500: '#f97316',   // orange
          600: '#ea580c',
          700: '#c2410c',
        },
      },
      animation: {
        'enter': 'enter 200ms ease-out',
        'leave': 'leave 150ms ease-in forwards',
      },
      keyframes: {
        enter: {
          '0%': { transform: 'scale(0.9)', opacity: '0' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
        leave: {
          '0%': { transform: 'scale(1)', opacity: '1' },
          '100%': { transform: 'scale(0.9)', opacity: '0' },
        },
      },
    },
  },
  plugins: [],
}
