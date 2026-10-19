import { createTheme } from "@mui/material/styles";

// Paleta e tipografia da referência visual aprovada (Bolt, SISTEMA BOLT/project/src/index.css).
// Dronz em verde e Gooder em roxo, como na referência.
export const visualTokens = {
  bg: "#0B0F1A",
  bg2: "#131929",
  bg3: "#1E2A3A",
  bg4: "#253345",
  border: "rgba(255, 255, 255, 0.07)",
  borderStrong: "rgba(255, 255, 255, 0.12)",
  text: "#E2E8F0",
  textSecondary: "#94A3B8",
  // Mais claro que o "muted" do Bolt (#64748B): mantém contraste AA (≥ 4,5:1) sobre fundo, cards e menus.
  textMuted: "#8794AA",
  blue: "#3B82F6",
  blueSoft: "#60A5FA",
  // Fundo dos botões preenchidos: branco sobre #3B82F6 fica em 3,68:1; sobre #2563EB, 5,17:1.
  // O #3B82F6 continua como cor de texto/links, onde #2563EB perderia contraste no fundo escuro.
  blueSolid: "#2563EB",
  blueSolidHover: "#1D4ED8",
  green: "#22C55E",
  amber: "#F59E0B",
  red: "#EF4444",
  dronz: "#22C55E",
  gooder: "#A855F7"
} as const;

export const fontMono =
  '"IBM Plex Mono", ui-monospace, "SFMono-Regular", Menlo, monospace';

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
      // Um tom acima do "muted" da referência para manter contraste AA no fundo escuro.
      secondary: visualTokens.textSecondary
    },
    divider: visualTokens.border
  },
  shape: { borderRadius: 10 },
  typography: {
    fontFamily:
      '"Plus Jakarta Sans", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    h4: {
      fontSize: "1.25rem",
      fontWeight: 700,
      letterSpacing: "-0.01em"
    },
    h5: { fontSize: "1.125rem", fontWeight: 700 },
    h6: { fontSize: "0.95rem", fontWeight: 600 },
    body1: { fontSize: "0.875rem" },
    body2: { fontSize: "0.8125rem" },
    button: { fontWeight: 600, textTransform: "none", fontSize: "0.8125rem" }
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        html: { colorScheme: "dark" },
        body: {
          backgroundColor: visualTokens.bg,
          WebkitFontSmoothing: "antialiased"
        },
        "*": {
          scrollbarWidth: "thin",
          scrollbarColor: `${visualTokens.bg3} ${visualTokens.bg}`
        }
      }
    },
    MuiPaper: {
      styleOverrides: { root: { backgroundImage: "none" } }
    },
    MuiCard: {
      styleOverrides: {
        root: {
          backgroundImage: "none",
          backgroundColor: visualTokens.bg2,
          border: `1px solid ${visualTokens.border}`,
          borderRadius: 12,
          boxShadow: "none"
        }
      }
    },
    MuiButton: {
      styleOverrides: {
        root: { borderRadius: 8 },
        contained: { boxShadow: "none", "&:hover": { boxShadow: "none" } },
        containedPrimary: {
          backgroundColor: visualTokens.blueSolid,
          color: "#FFFFFF",
          "&:hover": { backgroundColor: visualTokens.blueSolidHover }
        }
      }
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          backgroundColor: visualTokens.bg,
          "& .MuiOutlinedInput-notchedOutline": {
            borderColor: visualTokens.borderStrong
          }
        }
      }
    },
    MuiTableCell: {
      styleOverrides: {
        head: {
          fontSize: "0.6875rem",
          fontWeight: 600,
          color: visualTokens.textMuted,
          textTransform: "uppercase",
          letterSpacing: "0.06em"
        },
        root: { borderBottomColor: visualTokens.border, fontSize: "0.8125rem" }
      }
    },
    MuiTooltip: {
      styleOverrides: {
        tooltip: {
          backgroundColor: visualTokens.bg3,
          border: `1px solid ${visualTokens.borderStrong}`,
          fontSize: "0.75rem"
        }
      }
    }
  }
});

// Cor de identificação da loja pelo slug real; loja sem cor definida usa o azul neutro.
export function storeColor(slug: string | undefined) {
  if (slug === "dronz") return visualTokens.dronz;
  if (slug === "gooder") return visualTokens.gooder;
  return visualTokens.blue;
}
