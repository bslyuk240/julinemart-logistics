/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: {
          50:  '#f7e6fb',
          100: '#efd1f7',
          200: '#dfaaee',
          300: '#c86bdc',
          400: '#b033c8',
          500: '#77088a',
          600: '#670779',
          700: '#50055d',
          800: '#3c0445',
          900: '#2d0334',
          950: '#1a021f',
        },
        secondary: {
          50:  '#fff3e8',
          100: '#ffe3cc',
          200: '#ffc899',
          300: '#ffad66',
          400: '#ff914d',
          500: '#ff7a29',
          600: '#f86600',
          700: '#d65500',
          800: '#a84200',
          900: '#7d3200',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        card:       '0 2px 8px rgba(119, 8, 138, 0.10)',
        'card-hover':'0 4px 16px rgba(119, 8, 138, 0.18)',
      },
    },
  },
  plugins: [],
};
