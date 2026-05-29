import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
      },
      colors: {
        brand: {
          50:  "#eff6ff",
          100: "#dbeafe",
          200: "#bfdbfe",
          300: "#93c5fd",
          400: "#60a5fa",
          500: "#3b82f6",
          600: "#2563eb",
          700: "#1d4ed8",
          800: "#1e40af",
          900: "#1e3a8a",
          950: "#172554",
        },
        navy: {
          700: "#1a3280",
          800: "#142572",
          900: "#0f1f59",
          950: "#090f33",
        },
        surface: {
          DEFAULT: "#ffffff",
          secondary: "#f8fafc",
          tertiary: "#f1f5f9",
        },
      },
      boxShadow: {
        card:         "0 1px 3px 0 rgb(0 0 0 / 0.06), 0 1px 2px -1px rgb(0 0 0 / 0.04)",
        "card-md":    "0 4px 6px -1px rgb(0 0 0 / 0.07), 0 2px 4px -2px rgb(0 0 0 / 0.04)",
        "card-lg":    "0 10px 15px -3px rgb(0 0 0 / 0.08), 0 4px 6px -4px rgb(0 0 0 / 0.04)",
        "nav":        "0 4px 24px 0 rgb(9 15 51 / 0.25)",
        "inner-sm":   "inset 0 1px 2px 0 rgb(0 0 0 / 0.05)",
        // Glow effects
        "glow-blue":  "0 0 0 3px rgba(59,130,246,0.18), 0 0 20px 0 rgba(59,130,246,0.09)",
        "glow-blue-md":"0 0 0 4px rgba(59,130,246,0.22), 0 0 32px 0 rgba(59,130,246,0.13)",
        "glow-emerald":"0 0 0 3px rgba(16,185,129,0.18), 0 0 20px 0 rgba(16,185,129,0.09)",
        // Lift — for hover elevate
        "lift":       "0 4px 14px -3px rgba(0,0,0,0.11), 0 2px 6px -2px rgba(0,0,0,0.05)",
        "lift-md":    "0 8px 22px -4px rgba(0,0,0,0.13), 0 3px 8px -2px rgba(0,0,0,0.06)",
        // Card hover glow
        "card-glow":  "0 8px 28px -4px rgba(59,130,246,0.14), 0 3px 10px -2px rgba(0,0,0,0.06)",
      },
      borderRadius: {
        "4xl": "2rem",
      },
      transitionTimingFunction: {
        spring: "cubic-bezier(0.34, 1.56, 0.64, 1)",
        smooth: "cubic-bezier(0.25, 0.1, 0.25, 1)",
      },
      animation: {
        "fade-in":    "fadeIn 0.18s ease-out",
        "slide-up":   "slideUp 0.22s ease-out",
        "scale-in":   "scaleIn 0.15s ease-out",
        "pulse-slow": "pulse 3s cubic-bezier(0.4,0,0.6,1) infinite",
        "shimmer":    "shimmer 1.6s ease-in-out infinite",
        "float":      "float 4s ease-in-out infinite",
        "float-slow": "float 6s ease-in-out infinite",
        "bounce-in":  "bounceIn 0.4s cubic-bezier(0.34,1.56,0.64,1)",
        "spin-slow":  "spin 8s linear infinite",
        "ping-once":  "ping 0.6s cubic-bezier(0,0,0.2,1) forwards",
      },
      keyframes: {
        fadeIn:   { "0%": { opacity: "0" }, "100%": { opacity: "1" } },
        slideUp:  { "0%": { opacity: "0", transform: "translateY(6px)" }, "100%": { opacity: "1", transform: "translateY(0)" } },
        scaleIn:  { "0%": { opacity: "0", transform: "scale(0.96)" }, "100%": { opacity: "1", transform: "scale(1)" } },
        shimmer:  { "0%": { "background-position": "-200% center" }, "100%": { "background-position": "200% center" } },
        float:    { "0%,100%": { transform: "translateY(0px)" }, "50%": { transform: "translateY(-8px)" } },
        bounceIn: {
          "0%":   { transform: "scale(0.9)", opacity: "0" },
          "60%":  { transform: "scale(1.04)", opacity: "1" },
          "100%": { transform: "scale(1)", opacity: "1" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
