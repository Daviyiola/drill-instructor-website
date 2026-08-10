import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          green: "#4B5320",
          darkolive: "#414131",
          olive: "#6B6B4D",
          navy: "#17324D",
          blue: "#2563EB",
          gold: "#E8B44B",
          mist: "#F6F8FB",
        },
      },
      boxShadow: {
        soft: "0 20px 60px rgba(15, 23, 42, 0.08)",
      },
    },
  },
  plugins: [],
};

export default config;
