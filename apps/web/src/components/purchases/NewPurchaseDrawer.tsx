import * as React from "react";
import { Box, Button, Drawer, IconButton, Stack, Typography } from "@mui/material";
import type { UnifiedPurchaseListItem } from "../../types/unified-purchases";
import { ManualPurchaseForm } from "./ManualPurchaseForm";
import { ExternalPurchaseForm } from "./ExternalPurchaseForm";

type Origin = "manual" | "external" | null;

/**
 * Origens futuras (e-mail, Amazon API, eBay API) existem apenas como
 * possibilidade de evolução deste tipo — nunca como opção visível ou
 * placeholder na interface enquanto não houver mutação real por trás.
 */
export function NewPurchaseDrawer({
  open,
  onClose,
  listItems,
  onPendingChange,
  canSubmit = true
}: {
  open: boolean;
  onClose: () => void;
  listItems: UnifiedPurchaseListItem[];
  onPendingChange?: (pending: boolean) => void;
  canSubmit?: boolean;
}) {
  const [origin, setOrigin] = React.useState<Origin>(null);
  // Reflete isPending do formulário ativo (Manual ou Externa, incluindo a
  // criação contextual de merchant dentro deles). Enquanto uma mutação
  // estiver em voo, o drawer não pode ser fechado nem trocar de origem por
  // nenhum caminho (X, ESC, backdrop, "Trocar origem") — evita desmontar o
  // formulário com a requisição ainda em andamento, o que faria o usuário
  // perder o feedback e arriscar uma segunda submissão duplicada.
  const [isBusy, setIsBusy] = React.useState(false);

  React.useEffect(() => {
    onPendingChange?.(isBusy);
  }, [isBusy, onPendingChange]);

  const handleClose = () => {
    if (isBusy) return;
    onClose();
    setOrigin(null);
  };

  const handleChangeOrigin = () => {
    if (isBusy) return;
    setOrigin(null);
  };

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={isBusy ? undefined : handleClose}
      slotProps={{ paper: { sx: { width: { xs: "100%", sm: 480 }, p: 3 } } }}
    >
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" mb={2}>
        <Box>
          <Typography variant="h6">Nova compra</Typography>
          {origin && (
            <Typography variant="body2" color="text.secondary">
              Origem: {origin === "manual" ? "Manual" : "Externa"}
            </Typography>
          )}
        </Box>
        <IconButton onClick={handleClose} aria-label="Fechar" disabled={isBusy}>
          ✕
        </IconButton>
      </Stack>

      {origin === null && (
        <Stack gap={1.5}>
          <Typography variant="body2" color="text.secondary">
            Selecione a origem da compra.
          </Typography>
          <Button variant="outlined" onClick={() => setOrigin("manual")}>
            Manual
          </Button>
          <Button variant="outlined" onClick={() => setOrigin("external")}>
            Externa
          </Button>
        </Stack>
      )}

      {origin === "manual" && (
        <Stack gap={2}>
          <Button
            size="small"
            sx={{ alignSelf: "flex-start" }}
            onClick={handleChangeOrigin}
            disabled={isBusy}
          >
            ← Trocar origem
          </Button>
          <ManualPurchaseForm
            listItems={listItems}
            onPendingChange={setIsBusy}
            allowSubmit={canSubmit}
          />
        </Stack>
      )}

      {origin === "external" && (
        <Stack gap={2}>
          <Button
            size="small"
            sx={{ alignSelf: "flex-start" }}
            onClick={handleChangeOrigin}
            disabled={isBusy}
          >
            ← Trocar origem
          </Button>
          <ExternalPurchaseForm
            listItems={listItems}
            onPendingChange={setIsBusy}
            allowSubmit={canSubmit}
          />
        </Stack>
      )}
    </Drawer>
  );
}
