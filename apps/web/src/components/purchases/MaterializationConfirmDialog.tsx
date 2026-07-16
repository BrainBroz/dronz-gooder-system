import * as React from "react";
import {
  Alert,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography
} from "@mui/material";
import { useUnifiedPurchaseMutations, newIdempotencyKey } from "../../hooks/useUnifiedPurchases";
import type { MutationError } from "./types";

type MaterializationSummary = {
  storeId: string;
  storeName: string;
  itemCount: number;
  totalUnits: number;
};

export function MaterializationConfirmDialog({
  purchaseId,
  storeId,
  summary,
  purchaseVersion,
  open,
  onClose,
  onSuccess
}: {
  purchaseId: string;
  storeId: string;
  summary: MaterializationSummary;
  purchaseVersion: number;
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}) {
  const [error, setError] = React.useState<MutationError | null>(null);
  const { materialize } = useUnifiedPurchaseMutations();

  const handleMaterialize = async () => {
    setError(null);

    try {
      await materialize.mutateAsync({
        purchaseId,
        storeId,
        expectedPurchaseVersion: purchaseVersion,
        idempotencyKey: newIdempotencyKey()
      });

      onSuccess?.();
    } catch (err: any) {
      const status = err.response?.status;
      const message = err.response?.data?.message || err.message;

      if (status === 409) {
        setError({
          type: "conflict",
          message: "Dados foram atualizados. Recarregando...",
          statusCode: 409
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
          message: message || "Erro ao materializar. Tente novamente.",
          statusCode: status
        });
      }
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Materializar para {summary.storeName}</DialogTitle>
      <DialogContent>
        <Stack gap={2}>
          {error && (
            <Alert severity="error" onClose={() => setError(null)}>
              {error.message}
            </Alert>
          )}

          <Alert severity="info" variant="outlined">
            Esta operação materializa <strong>todos os itens elegíveis</strong> desta
            compra para <strong>{summary.storeName}</strong> em um único Pedido de
            Compra — não é possível materializar um item isolado.
          </Alert>

          <Stack gap={0.5}>
            <Typography variant="body2">
              Loja: <strong>{summary.storeName}</strong>
            </Typography>
            <Typography variant="body2">
              Itens elegíveis:{" "}
              <strong>
                {summary.itemCount} {summary.itemCount === 1 ? "item" : "itens"}
              </strong>
            </Typography>
            <Typography variant="body2">
              Total de unidades: <strong>{summary.totalUnits}</strong>
            </Typography>
          </Stack>

          <Typography variant="caption" color="text.secondary" sx={{ fontStyle: "italic" }}>
            Ação é idempotente — repetir não duplica.
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={materialize.isPending}>
          Cancelar
        </Button>
        <Button
          onClick={handleMaterialize}
          variant="contained"
          disabled={materialize.isPending}
        >
          {materialize.isPending ? (
            <>
              <CircularProgress size={16} sx={{ mr: 1 }} />
              Materializando...
            </>
          ) : (
            "Materializar"
          )}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
