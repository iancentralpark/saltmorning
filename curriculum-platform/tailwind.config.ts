import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: {
          950: "#0f1c17",
          900: "#152820",
          800: "#1e3a2f",
          700: "#2a5242",
          600: "#3d6b56",
        },
        moss: {
          50: "#f3f7f4",
          100: "#e4eee7",
          200: "#c5dccb",
          400: "#6fa882",
          500: "#4d8a63",
          600: "#3a6f4e",
          700: "#2f5840",
        },
        sand: {
          50: "#faf8f4",
          100: "#f2ebe0",
          200: "#e5d6c0",
        },
        coral: {
          500: "#d4654a",
          600: "#b84f36",
        },
      },
      fontFamily: {
        display: ["var(--font-display)", "Georgia", "serif"],
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      boxShadow: {
        panel: "0 18px 50px -24px rgba(15, 28, 23, 0.45)",
      },
    },
  },
  plugins: [],
};

export default config;
