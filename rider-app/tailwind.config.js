/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: {
          50:  '#f4edfe',
          100: '#e6d5fc',
          200: '#cdabf9',
          300: '#b081f2',
          400: '#9b6bf2',
          500: '#7c3aed',
          600: '#6d28d9',
          700: '#5b21b6',
          800: '#4a1a94',
          900: '#3b1577',
        },
        signal: {
          DEFAULT: '#C8E619',
          ink: '#3A4A00',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
