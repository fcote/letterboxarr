/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Brand colors from logo
        brand: {
          orange: '#FFD035',
          green: '#00E676', 
          blue: '#40C4FF',
          dark: '#2C3E50',
        },
        // Dark theme colors
        dark: {
          bg: {
            primary: '#0F172A',    // Very dark slate
            secondary: '#1E293B',  // Dark slate
            tertiary: '#334155',   // Medium slate
          },
          text: {
            primary: '#F8FAFC',    // Near white
            secondary: '#E2E8F0',  // Light slate
            muted: '#94A3B8',      // Slate gray
          },
          border: '#475569',       // Slate border
        }
      },
    },
  },
  plugins: [],
}