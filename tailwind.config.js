/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#172026",
        panel: "#f7f8f5",
        line: "#dfe4df",
        mint: "#0f766e",
        amber: "#b45309",
        plum: "#6d28d9"
      },
      boxShadow: {
        soft: "0 18px 50px rgba(23, 32, 38, 0.08)"
      }
    }
  },
  plugins: []
};
