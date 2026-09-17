/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        /* Primary teal — used by both the consumer flow and the admin portal. */
        brand: {
          50: '#effafa',
          100: '#d2f2f3',
          200: '#a6e6e8',
          300: '#6fd3d8',
          400: '#2fb7bf',
          500: '#12a0a8',
          600: '#0a828c',
          700: '#0d6873',
          800: '#11545f',
          900: '#14404c',
          950: '#0a2a33',
        },
        /* Coral call-to-action. */
        accent: {
          50: '#fff4f2',
          100: '#ffe5e0',
          200: '#ffcbc1',
          300: '#ffa898',
          400: '#ff8873',
          500: '#fb6a55',
          600: '#e8523c',
          700: '#c33f2c',
        },
        /* Logo gold. */
        gold: {
          400: '#ffdc4a',
          500: '#ffd406',
          600: '#e0b900',
        },
        /* Deep navy-teal used for headings and body copy. */
        ink: {
          500: '#3d6474',
          700: '#17505f',
          900: '#0b3b49',
        },
      },
      fontFamily: {
        sans: ['Inter', 'Segoe UI', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        '4xl': '2rem',
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'pop-in': {
          '0%': { opacity: '0', transform: 'scale(0.82)' },
          '60%': { transform: 'scale(1.04)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.35s ease-out both',
        'pop-in': 'pop-in 0.4s cubic-bezier(0.22, 1, 0.36, 1) both',
      },
    },
  },
  plugins: [],
};
