import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eef6ff",
          100: "#d9eaff",
          200: "#bcd9ff",
          300: "#8ec1ff",
          400: "#599dff",
          500: "#2f7bff",
          600: "#1a5cf5",
          700: "#1547e1",
          800: "#173bb6",
          900: "#19378f",
        },
      },
    },
  },
  plugins: [],
};

export default config;
