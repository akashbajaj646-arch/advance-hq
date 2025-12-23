import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#fdf4f0',
          100: '#fbe8e0',
          200: '#f7d1c1',
          300: '#f0b199',
          400: '#e78a6b',
          500: '#dc6b47',
          600: '#cf5331',
          700: '#ac4328',
          800: '#8b3824',
          900: '#713221',
          950: '#3d170f',
        },
      },
    },
  },
  plugins: [],
};
export default config;
