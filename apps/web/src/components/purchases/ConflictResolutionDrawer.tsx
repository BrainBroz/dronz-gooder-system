import * as React from "react";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Drawer,
  IconButton,
  Stack,
  TextField,
  Typography
} from "@mui/material";
import { useUnifiedPurchaseMutations, newIdempotencyKey } from "../../hooks/useUnifiedPurchases";
import type { PurchaseConflict } from "../../types/unified-purchases";
import { readMutationError, type MutationError } from "./types";

export function ConflictResolutionDrawer({
  purchaseId,
  conflict,
  open,
  onClose,
  onSuccess
}: {
  purchaseId: string;
  conflict: PurchaseConflict;
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}) {
  const [motivo, setMotivo] = React.useState("");
  const [error, setError] = React.useState<MutationError | null>(null);
  const { resolveConflict } = useUnifiedPurchaseMutations();

  const canSubmit = motivo.trim().length >= 5;

  const handleResolve = async () => {
    if (!canSubmit) return;
    setError(null);

    try {
      await resolveConflict.mutateAsync({
        purchaseId,
        conflictId: conflict.id,
        motivo: motivo.trim(),
        idempotencyKey: newIdempotencyKey()
      });

      setMotivo("");
      onSuccess?.();
    } catch (err) {
      const { status, message } = readMutationError(err);

      if (status === 409) {
        setError({
          type: "conflict",
          message: "Outro usuário resolveu este conflito.",
          statusCode: 409
        });
      } else if (status === 404) {
        setError({
          type: "validation",
          message: "Conflito não encontrado.",
          statusCode: 404
        });
      } else if (status === 401) {
        setError({
          type: "auth",
          message: "Sessão expirada. Fazendo login novamente...",
          statusCode: 401
        });
      } else if (status === 400 || status === 422) {
        setError({
          type: "validation",
          message: message || "Validação falhou. Tente novamente.",
          statusCode: status
        });
      } else {
        setError({
          type: "network",
          message: message || "Erro ao resolver conflito. Tente novamente.",
          statusCode: status
        });
      }
    }
  };

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      slotProps={{ paper: { sx: { width: { xs: "100%", sm: 480 }, p: 3 } } }}
    >
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" mb={2}>
        <Box>
          <Typography variant="h6">Resolver Conflito</Typography>
          <Typography variant="body2" color="text.secondary">
            {conflict.tipo}
          </Typography>
        </Box>
        <IconButton onClick={onClose} aria-label="Fechar">
          ✕
        </IconButton>
      </Stack>

      <Stack gap={2}>
        {error && (
          <Alert severity="error" onClose={() => setError(null)}>
            {error.message}
          </Alert>
        )}

        <Box sx={{ backgroundColor: "action.hover", p: 1.5, borderRadius: 1 }}>
          <Typography variant="caption" color="text.secondary" display="block">
            Tipo de conflito
          </Typography>
          <Typography variant="body2" fontWeight={600}>
            {conflict.tipo}
          </Typography>
        </Box>

        <TextField
          label="Motivo da resolução"
          multiline
          rows={4}
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          placeholder="Explique por que este conflito pode ser ignorado..."
          fullWidth
          autoFocus
          helperText={`${motivo.length} / 1000 caracteres (mínimo 5)`}
          error={motivo.length > 0 && motivo.length < 5}
          disabled={resolveConflict.isPending}
        />

        <Stack gap={2} mt="auto" pt={4}>
          <Button
            variant="contained"
            onClick={handleResolve}
            disabled={!canSubmit || resolveConflict.isPending}
            fullWidth
          >
            {resolveConflict.isPending ? (
              <>
                <CircularProgress size={16} sx={{ mr: 1 }} />
                Resolvendo...
              </>
            ) : (
              "Resolver Conflito"
            )}
          </Button>
          <Button
            variant="outlined"
            onClick={onClose}
            fullWidth
            disabled={resolveConflict.isPending}
          >
            Cancelar
          </Button>
        </Stack>
      </Stack>
    </Drawer>
  );
}
