import React from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  Box,
  ButtonBase,
  Collapse,
  Drawer,
  IconButton,
  Menu,
  MenuItem,
  Stack,
  Tooltip,
  Typography,
  useMediaQuery
} from "@mui/material";
import { api, queryClient } from "../../api/client";
import { useAuthStore } from "../../stores/auth";
import { appTheme, storeColor, storeTextColor, visualTokens } from "../../theme";
import { currentPageLabel, visibleNavigation, type AppNavGroup } from "../../navigation/appNavigation";
import { Icon } from "./icons";

const SIDEBAR_WIDTH = 240;
const SIDEBAR_COLLAPSED = 60;

const isActive = (pathname: string, path: string) =>
  path === "/" ? pathname === "/" : pathname === path || pathname.startsWith(`${path}/`);

// ButtonBase remove o contorno nativo; todo controle clicável precisa deste anel de foco para teclado.
const focusRing = {
  "&.Mui-focusVisible, &:focus-visible": { outline: `2px solid ${visualTokens.blueSoft}`, outlineOffset: 2 }
};

const itemSx = (active: boolean) => ({
  width: "100%",
  justifyContent: "flex-start",
  gap: 1.25,
  px: 1.25,
  py: 0.875,
  borderRadius: "8px",
  fontSize: "0.8125rem",
  fontWeight: 500,
  color: active ? visualTokens.blueSoft : visualTokens.textSecondary,
  bgcolor: active ? "rgba(59, 130, 246, 0.12)" : "transparent",
  border: `1px solid ${active ? "rgba(59, 130, 246, 0.2)" : "transparent"}`,
  textDecoration: "none",
  "&:hover": { bgcolor: active ? "rgba(59, 130, 246, 0.16)" : visualTokens.bg3, color: visualTokens.text },
  ...focusRing
});

function NavGroup({
  group,
  collapsed,
  onNavigate,
  onExpandSidebar
}: {
  group: AppNavGroup;
  collapsed: boolean;
  onNavigate: () => void;
  onExpandSidebar: () => void;
}) {
  const { pathname } = useLocation();
  // Só o filho mais específico fica ativo: em /compras/revisao, "Fila de compras" (/compras) não acende junto.
  const activeChildPath = group.children
    ?.filter((child) => isActive(pathname, child.path))
    .sort((a, b) => b.path.length - a.path.length)[0]?.path;
  const groupActive = group.path
    ? isActive(pathname, group.path)
    : !!group.children?.some((child) => isActive(pathname, child.path));
  const [open, setOpen] = React.useState(groupActive);
  // Ao entrar numa rota do grupo (por qualquer caminho), o submenu abre; ajuste durante o render, sem efeito.
  const [wasActive, setWasActive] = React.useState(groupActive);
  if (groupActive !== wasActive) {
    setWasActive(groupActive);
    if (groupActive) setOpen(true);
  }

  const content = (
    <>
      <Icon name={group.icon} size={16} />
      {!collapsed && (
        <Box component="span" sx={{ flex: 1, textAlign: "left", whiteSpace: "nowrap" }}>
          {group.label}
        </Box>
      )}
      {!collapsed && group.children && (
        <Icon
          name="chevronRight"
          size={14}
          style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform 150ms" }}
        />
      )}
    </>
  );

  if (group.path) {
    return (
      <Tooltip title={collapsed ? group.label : ""} placement="right">
        <ButtonBase
          component={NavLink}
          to={group.path}
          end={group.path === "/"}
          onClick={onNavigate}
          aria-label={collapsed ? group.label : undefined}
          aria-current={groupActive ? "page" : undefined}
          sx={{ ...itemSx(groupActive), justifyContent: collapsed ? "center" : "flex-start" }}
        >
          {content}
        </ButtonBase>
      </Tooltip>
    );
  }

  const listId = `nav-group-${group.key}`;
  return (
    <Box>
      <Tooltip title={collapsed ? group.label : ""} placement="right">
        <ButtonBase
          onClick={() => {
            // Com a lateral recolhida não há onde abrir o submenu: expande a lateral primeiro.
            if (collapsed) {
              onExpandSidebar();
              setOpen(true);
            } else setOpen((value) => !value);
          }}
          aria-expanded={collapsed ? false : open}
          aria-controls={listId}
          aria-label={collapsed ? group.label : undefined}
          sx={{
            ...itemSx(false),
            color: groupActive ? visualTokens.text : visualTokens.textSecondary,
            justifyContent: collapsed ? "center" : "flex-start"
          }}
        >
          {content}
        </ButtonBase>
      </Tooltip>
      <Collapse in={open && !collapsed} unmountOnExit>
        <Stack
          id={listId}
          component="ul"
          sx={{ listStyle: "none", m: 0, mt: 0.25, p: 0, pl: 2.25, gap: 0.25 }}
        >
          {group.children?.map((child) => {
            const active = child.path === activeChildPath;
            return (
              <li key={child.path}>
                <ButtonBase
                  component={NavLink}
                  to={child.path}
                  end
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  sx={{ ...itemSx(active), py: 0.625, borderLeft: `1px solid ${visualTokens.border}`, borderRadius: "0 8px 8px 0" }}
                >
                  {child.label}
                </ButtonBase>
              </li>
            );
          })}
        </Stack>
      </Collapse>
    </Box>
  );
}

function SidebarContent({
  collapsed,
  onNavigate,
  onExpandSidebar,
  onToggleCollapse
}: {
  collapsed: boolean;
  onNavigate: () => void;
  onExpandSidebar: () => void;
  onToggleCollapse?: () => void;
}) {
  const permissions = useAuthStore((state) => state.permissions);
  const groups = visibleNavigation(permissions);
  return (
    <Stack sx={{ height: "100%", bgcolor: visualTokens.bg2 }}>
      <Stack
        direction="row"
        alignItems="center"
        gap={1.25}
        sx={{ height: 56, px: collapsed ? 0 : 2, justifyContent: collapsed ? "center" : "flex-start", borderBottom: `1px solid ${visualTokens.border}` }}
      >
        <Box
          sx={{ width: 30, height: 30, borderRadius: "8px", bgcolor: visualTokens.blue, color: "#fff", display: "grid", placeItems: "center", flexShrink: 0 }}
        >
          <Icon name="plane" size={16} />
        </Box>
        {!collapsed && (
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontWeight: 700, fontSize: "0.9rem", lineHeight: 1.2 }}>Dronz & Gooder</Typography>
            <Typography sx={{ fontSize: "0.6875rem", color: visualTokens.textMuted }}>Gestão de importação</Typography>
          </Box>
        )}
      </Stack>
      <Box component="nav" aria-label="Navegação principal" sx={{ flex: 1, overflowY: "auto", p: 1.25 }}>
        <Stack gap={0.375}>
          {groups.map((group) => (
            <NavGroup
              key={group.key}
              group={group}
              collapsed={collapsed}
              onNavigate={onNavigate}
              onExpandSidebar={onExpandSidebar}
            />
          ))}
        </Stack>
      </Box>
      {onToggleCollapse && (
        <Box sx={{ p: 1.25, borderTop: `1px solid ${visualTokens.border}` }}>
          <ButtonBase
            onClick={onToggleCollapse}
            aria-label={collapsed ? "Expandir menu lateral" : "Recolher menu lateral"}
            sx={{ ...itemSx(false), justifyContent: collapsed ? "center" : "flex-start" }}
          >
            <Icon name={collapsed ? "chevronRight" : "chevronLeft"} size={16} />
            {!collapsed && <span>Recolher</span>}
          </ButtonBase>
        </Box>
      )}
    </Stack>
  );
}

function StoreSwitcher() {
  const { stores, activeStoreId, setActiveStoreId, viewAll, setViewAll } = useAuthStore();
  return (
    <Stack
      direction="row"
      role="group"
      aria-label="Loja ativa"
      alignItems="center"
      gap={0.5}
      sx={{ p: 0.375, borderRadius: "10px", bgcolor: visualTokens.bg, border: `1px solid ${visualTokens.border}`, minWidth: 0, overflowX: "auto" }}
    >
      <Tooltip title="Mostra todas as lojas nas telas que permitem (Compras). As outras telas continuam na última loja escolhida.">
        <ButtonBase
          onClick={() => setViewAll(true)}
          aria-pressed={viewAll}
          aria-label="Todas as lojas"
          sx={{
            px: 1.25, py: 0.5, borderRadius: "7px", fontSize: "0.75rem", fontWeight: 600, whiteSpace: "nowrap",
            color: viewAll ? visualTokens.text : visualTokens.textSecondary,
            bgcolor: viewAll ? visualTokens.bg3 : "transparent",
            border: `1px solid ${viewAll ? visualTokens.borderStrong : "transparent"}`,
            ...focusRing
          }}
        >
          Todos
        </ButtonBase>
      </Tooltip>
      {stores.map((store) => {
        const active = !viewAll && store.id === activeStoreId;
        const color = storeColor(store.slug);
        const textColor = storeTextColor(store.slug);
        return (
          <ButtonBase
            key={store.id}
            onClick={() => setActiveStoreId(store.id)}
            aria-pressed={active}
            sx={{
              px: 1.25,
              py: 0.5,
              borderRadius: "7px",
              fontSize: "0.75rem",
              fontWeight: 600,
              whiteSpace: "nowrap",
              color: active ? textColor : visualTokens.textSecondary,
              bgcolor: active ? `${color}26` : "transparent",
              border: `1px solid ${active ? `${color}4D` : "transparent"}`,
              "&:hover": { color: textColor },
              ...focusRing
            }}
          >
            <Box component="span" sx={{ width: 6, height: 6, borderRadius: "50%", bgcolor: color, mr: 0.75 }} />
            {store.nome}
          </ButtonBase>
        );
      })}
    </Stack>
  );
}

function UserMenu() {
  const { user, stores, activeStoreId, clear } = useAuthStore();
  const navigate = useNavigate();
  const [anchor, setAnchor] = React.useState<HTMLElement | null>(null);
  const activeStore = stores.find((store) => store.id === activeStoreId);
  const name = user?.name || user?.email || "";
  const logout = async () => {
    setAnchor(null);
    try {
      await api.post("/auth/logout");
    } catch {
      // A intenção de sair deve encerrar a sessão local mesmo sem resposta da API.
    } finally {
      queryClient.clear();
      clear();
      navigate("/login");
    }
  };
  return (
    <>
      <ButtonBase
        onClick={(event) => setAnchor(event.currentTarget)}
        aria-label="Menu do usuário"
        aria-haspopup="menu"
        aria-expanded={!!anchor}
        sx={{ gap: 1, borderRadius: "8px", px: 0.75, py: 0.5, "&:hover": { bgcolor: visualTokens.bg3 }, ...focusRing }}
      >
        <Box
          sx={{ width: 28, height: 28, borderRadius: "50%", bgcolor: "rgba(59, 130, 246, 0.2)", color: visualTokens.blueSoft, display: "grid", placeItems: "center", fontSize: "0.75rem", fontWeight: 700 }}
        >
          {name.charAt(0).toUpperCase()}
        </Box>
        <Box sx={{ display: { xs: "none", lg: "block" }, textAlign: "left", maxWidth: 180 }}>
          <Typography noWrap sx={{ fontSize: "0.75rem", fontWeight: 600 }}>{name}</Typography>
          {user?.name && (
            <Typography noWrap sx={{ fontSize: "0.6875rem", color: visualTokens.textMuted }}>{user.email}</Typography>
          )}
        </Box>
      </ButtonBase>
      <Menu
        anchorEl={anchor}
        open={!!anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        slotProps={{ paper: { sx: { bgcolor: visualTokens.bg3, border: `1px solid ${visualTokens.borderStrong}`, minWidth: 220 } } }}
      >
        <Box sx={{ px: 2, py: 1 }}>
          <Typography sx={{ fontSize: "0.8125rem", fontWeight: 600 }}>{name}</Typography>
          {user?.name && <Typography sx={{ fontSize: "0.75rem", color: visualTokens.textMuted }}>{user.email}</Typography>}
          {activeStore && (
            <Typography sx={{ fontSize: "0.75rem", color: visualTokens.textSecondary, mt: 0.5 }}>
              Loja ativa: <Box component="span" sx={{ color: storeTextColor(activeStore.slug), fontWeight: 600 }}>{activeStore.nome}</Box>
            </Typography>
          )}
        </Box>
        <MenuItem onClick={logout} sx={{ gap: 1, fontSize: "0.8125rem", mt: 0.5 }}>
          <Icon name="logout" size={15} />
          Sair
        </MenuItem>
      </Menu>
    </>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
  const desktop = useMediaQuery(appTheme.breakpoints.up("md"), { noSsr: true });
  const [collapsed, setCollapsed] = React.useState(false);
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const page = currentPageLabel(pathname);
  const sidebarWidth = collapsed ? SIDEBAR_COLLAPSED : SIDEBAR_WIDTH;

  return (
    <Box sx={{ display: "flex", minHeight: "100vh", bgcolor: visualTokens.bg }}>
      {desktop ? (
        <Box
          component="aside"
          sx={{ width: sidebarWidth, flexShrink: 0, position: "sticky", top: 0, height: "100vh", borderRight: `1px solid ${visualTokens.border}`, transition: "width 180ms ease", overflow: "hidden" }}
        >
          <SidebarContent
            collapsed={collapsed}
            onNavigate={() => undefined}
            onExpandSidebar={() => setCollapsed(false)}
            onToggleCollapse={() => setCollapsed((value) => !value)}
          />
        </Box>
      ) : (
        <Drawer
          variant="temporary"
          open={mobileOpen}
          onClose={() => setMobileOpen(false)}
          slotProps={{ paper: { sx: { width: SIDEBAR_WIDTH, borderRight: `1px solid ${visualTokens.border}` } } }}
        >
          <SidebarContent collapsed={false} onNavigate={() => setMobileOpen(false)} onExpandSidebar={() => undefined} />
        </Drawer>
      )}
      <Box sx={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <Box
          component="header"
          sx={{ height: 56, position: "sticky", top: 0, zIndex: 10, display: "flex", alignItems: "center", gap: 1.5, px: { xs: 1.5, md: 2.5 }, bgcolor: visualTokens.bg2, borderBottom: `1px solid ${visualTokens.border}` }}
        >
          {!desktop && (
            <IconButton aria-label="Abrir menu" onClick={() => setMobileOpen(true)} sx={{ color: visualTokens.textSecondary }}>
              <Icon name="menu" size={18} />
            </IconButton>
          )}
          {page && (
            <Typography noWrap sx={{ display: { xs: "none", sm: "block" }, fontSize: "0.8125rem", color: visualTokens.textMuted }}>
              {page.group !== page.label && <>{page.group} <Box component="span" sx={{ mx: 0.5 }}>/</Box></>}
              <Box component="span" sx={{ color: visualTokens.text, fontWeight: 600 }}>{page.label}</Box>
            </Typography>
          )}
          <Box sx={{ ml: "auto", display: "flex", alignItems: "center", gap: 1, minWidth: 0 }}>
            <StoreSwitcher />
            <UserMenu />
          </Box>
        </Box>
        <Box component="main" sx={{ flex: 1, minWidth: 0 }}>
          {children}
        </Box>
      </Box>
    </Box>
  );
}
