/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#185FA5',
          light: '#E6F1FB',
          dark: '#0C447C',
        }
      }
    }
  },
  plugins: [],
}
