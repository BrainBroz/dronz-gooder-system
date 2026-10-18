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
import {
  readMutationError,
  type MaterializationSummary,
  type MutationError
} from "./types";

export function MaterializationConfirmDialog({
  purchaseId,
  storeId,
  summary,
  purchaseVersion,
  canMaterialize,
  open,
  onClose,
  onSuccess,
  onRefresh
}: {
  purchaseId: string;
  storeId: string;
  summary: MaterializationSummary;
  purchaseVersion: number;
  canMaterialize: boolean;
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  onRefresh?: () => void;
}) {
  const [error, setError] = React.useState<MutationError | null>(null);
  const [completedSummary, setCompletedSummary] = React.useState<MaterializationSummary | null>(null);
  const { materialize } = useUnifiedPurchaseMutations();
  const submitting = React.useRef(false);

  const handleMaterialize = async () => {
    if (!canMaterialize || submitting.current || materialize.isSuccess) return;
    submitting.current = true;
    setError(null);
    try {
      const result = await materialize.mutateAsync({
        purchaseId,
        storeId,
        expectedPurchaseVersion: purchaseVersion,
        idempotencyKey: newIdempotencyKey()
      });
      const items = result.data?.pedidoCompra?.itens;
      setCompletedSummary(Array.isArray(items) && items.length > 0 && items.every((item) => Number.isInteger(item?.quantidade) && item.quantidade > 0)
        ? {
            ...summary,
            itemCount: items.length,
            totalUnits: items.reduce((total, item) => total + item.quantidade, 0)
          }
        : null);
      onSuccess?.();
    } catch (err) {
      const { status, message, code } = readMutationError(err);

      if (status === 409) {
        if (code === "concurrent_modification") onRefresh?.();
        setError({
          type: "conflict",
          message: code === "supplier_mapping_required"
            ? "Vincule o merchant a um fornecedor da loja no detalhe da compra antes de materializar."
            : code === "concurrent_modification"
              ? "Dados foram atualizados. Confira o detalhe atualizado antes de tentar novamente."
              : `Materialização bloqueada: ${code ?? message ?? "revise as pendências da compra"}.`,
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
    } finally {
      submitting.current = false;
    }
  };
  const displayedSummary = materialize.isSuccess ? completedSummary : summary;

  return (
    <Dialog open={open} onClose={materialize.isPending ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Materializar para {summary.storeName}</DialogTitle>
      <DialogContent>
        <Stack gap={2}>
          {materialize.isSuccess && <Alert severity="success">Materialização concluída. Pedido operacional disponível.</Alert>}
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

          {displayedSummary ? <Stack gap={0.5}>
            <Typography variant="body2">
              Loja: <strong>{displayedSummary.storeName}</strong>
            </Typography>
            <Typography variant="body2">
              Itens elegíveis:{" "}
              <strong>
                {displayedSummary.itemCount} {displayedSummary.itemCount === 1 ? "item" : "itens"}
              </strong>
            </Typography>
            <Typography variant="body2">
              Total de unidades: <strong>{displayedSummary.totalUnits}</strong>
            </Typography>
          </Stack> : <Alert severity="warning">Pedido operacional disponível, mas o resumo da resposta está indisponível. Consulte o pedido operacional.</Alert>}

          <Typography variant="caption" color="text.secondary" sx={{ fontStyle: "italic" }}>
            Ação é idempotente — repetir não duplica.
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={materialize.isPending}>
          {materialize.isSuccess ? "Fechar" : "Cancelar"}
        </Button>
        <Button
          onClick={handleMaterialize}
          variant="contained"
          disabled={!canMaterialize || materialize.isPending || materialize.isSuccess}
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
