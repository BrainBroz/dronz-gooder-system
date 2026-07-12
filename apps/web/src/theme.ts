import { createTheme } from "@mui/material/styles";

export const visualTokens = {
  bg: "#0d1117",
  bg2: "#161b27",
  bg3: "#1e2535",
  bg4: "#252d40",
  border: "#2a3347",
  text: "#e8edf5",
  textSecondary: "#8b99b5",
  blue: "#4f9cf9",
  green: "#3ecf8e",
  amber: "#f5a623",
  red: "#f06565",
  dronz: "#a78bfa",
  gooder: "#2dd4bf"
} as const;

export const appTheme = createTheme({
  palette: {
    mode: "dark",
    primary: { main: visualTokens.blue },
    success: { main: visualTokens.green },
    warning: { main: visualTokens.amber },
    error: { main: visualTokens.red },
    background: {
      default: visualTokens.bg,
      paper: visualTokens.bg2
    },
    text: {
      primary: visualTokens.text,
      secondary: visualTokens.textSecondary
    },
    divider: visualTokens.border
  },
  shape: { borderRadius: 12 },
  typography: {
    fontFamily:
      'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    h4: {
      fontSize: "clamp(1.75rem, 3vw, 2.25rem)",
      fontWeight: 700,
      letterSpacing: "-0.03em"
    },
    h6: { fontWeight: 650 },
    button: { fontWeight: 600, textTransform: "none" }
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: { backgroundColor: visualTokens.bg }
      }
    },
    MuiCard: {
      styleOverrides: {
        root: {
          backgroundImage: "none",
          border: `1px solid ${visualTokens.border}`,
          boxShadow: "0 14px 36px rgba(0, 0, 0, 0.16)"
        }
      }
    }
  }
});
