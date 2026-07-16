import * as React from "react";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Drawer,
  IconButton,
  Slider,
  Stack,
  Typography
} from "@mui/material";
import {
  useUnifiedPurchaseMutations,
  useUnifiedPurchaseDetail,
  newIdempotencyKey
} from "../../hooks/useUnifiedPurchases";
import { useAuthStore } from "../../stores/auth";
import type { UnifiedPurchaseItemDetail } from "../../types/unified-purchases";
import { readMutationError, type MutationError } from "./types";

type StoreKey = "dronz" | "gooder";

export function ItemAssignmentDrawer({
  purchaseId,
  item,
  open,
  onClose,
  onSuccess
}: {
  purchaseId: string;
  item: UnifiedPurchaseItemDetail;
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}) {
  const [assignments, setAssignments] = React.useState<Record<StoreKey, number>>({
    dronz: 0,
    gooder: 0
  });
  const [error, setError] = React.useState<MutationError | null>(null);
  const { setAssignment } = useUnifiedPurchaseMutations();
  const [isLoading, setIsLoading] = React.useState(false);
  const stores = useAuthStore((state) => state.stores);
  const dronzStoreId = stores.find((store) => store.slug === "dronz")?.id;
  const gooderStoreId = stores.find((store) => store.slug === "gooder")?.id;
  // Usado para reler item.version entre as duas chamadas sequenciais (ver handleMutate).
  const detailQuery = useUnifiedPurchaseDetail(purchaseId);

  const pendente = item.quantidade - assignments.dronz - assignments.gooder;
  const changed = assignments.dronz > 0 || assignments.gooder > 0;

  const handleSliderChange = (store: StoreKey, value: number) => {
    setAssignments((prev) => {
      const newAssignments = { ...prev, [store]: value };
      const used = newAssignments.dronz + newAssignments.gooder;
      if (used > item.quantidade) {
        return prev;
      }
      return newAssignments;
    });
  };

  const handleMutate = async () => {
    setError(null);
    setIsLoading(true);

    try {
      // Executa sequencialmente: Dronz → Gooder.
      // Motivo: expectedVersion valida contra item.version no backend (não
      // detail.version, que é a versão da compra). Cada atribuição bem-sucedida
      // incrementa item.version no servidor, então a segunda chamada precisa da
      // versão atualizada — por isso a releitura via refetch entre as chamadas,
      // em vez de reenviar a mesma versão (o que causaria 409 sistemático).
      if (!dronzStoreId && assignments.dronz > 0) {
        throw new Error("store_not_found:dronz");
      }
      if (!gooderStoreId && assignments.gooder > 0) {
        throw new Error("store_not_found:gooder");
      }

      let currentItemVersion = item.version;

      if (assignments.dronz > 0 && dronzStoreId) {
        await setAssignment.mutateAsync({
          purchaseId,
          itemId: item.id,
          storeId: dronzStoreId,
          payload: {
            quantidade: assignments.dronz,
            expectedVersion: currentItemVersion
          },
          idempotencyKey: newIdempotencyKey()
        });

        if (assignments.gooder > 0) {
          const refetched = await detailQuery.refetch();
          const refreshedItem = refetched.data?.itens.find((i) => i.id === item.id);
          if (!refreshedItem) throw new Error("item_not_found_after_refetch");
          currentItemVersion = refreshedItem.version;
        }
      }

      if (assignments.gooder > 0 && gooderStoreId) {
        await setAssignment.mutateAsync({
          purchaseId,
          itemId: item.id,
          storeId: gooderStoreId,
          payload: {
            quantidade: assignments.gooder,
            expectedVersion: currentItemVersion
          },
          idempotencyKey: newIdempotencyKey()
        });
      }

      setAssignments({ dronz: 0, gooder: 0 });
      onSuccess?.();
    } catch (err) {
      const { status, message } = readMutationError(err);

      if (message === "store_not_found:dronz" || message === "store_not_found:gooder") {
        setError({
          type: "validation",
          message: "Loja não encontrada na sessão atual. Recarregue a página e tente novamente."
        });
      } else if (status === 409) {
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
          message: message || "Erro ao atribuir. Tente novamente.",
          statusCode: status
        });
      }
    } finally {
      setIsLoading(false);
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
          <Typography variant="h6">Atribuir Quantidade</Typography>
          <Typography variant="body2" color="text.secondary">
            {item.titulo} · {item.quantidade} un
          </Typography>
        </Box>
        <IconButton onClick={onClose} aria-label="Fechar">
          ✕
        </IconButton>
      </Stack>

      <Stack gap={3}>
        {error && (
          <Alert severity="error" onClose={() => setError(null)}>
            {error.message}
          </Alert>
        )}

        <Box sx={{ border: "1px solid", borderColor: "divider", borderRadius: 1, p: 2 }}>
          <Stack gap={3}>
            {/* Dronz Slider */}
            <Box>
              <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1}>
                <Typography variant="subtitle2" fontWeight={600}>
                  Dronz
                </Typography>
                <Typography variant="body2" fontWeight={600}>
                  {assignments.dronz} un
                </Typography>
              </Stack>
              <Slider
                aria-label="Quantidade para Dronz"
                min={0}
                max={item.quantidade}
                value={assignments.dronz}
                onChange={(_, value) => handleSliderChange("dronz", value as number)}
                marks={[
                  { value: 0, label: "0" },
                  { value: item.quantidade, label: item.quantidade.toString() }
                ]}
                disabled={isLoading}
              />
            </Box>

            {/* Gooder Slider */}
            <Box>
              <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1}>
                <Typography variant="subtitle2" fontWeight={600}>
                  Gooder
                </Typography>
                <Typography variant="body2" fontWeight={600}>
                  {assignments.gooder} un
                </Typography>
              </Stack>
              <Slider
                aria-label="Quantidade para Gooder"
                min={0}
                max={item.quantidade}
                value={assignments.gooder}
                onChange={(_, value) => handleSliderChange("gooder", value as number)}
                marks={[
                  { value: 0, label: "0" },
                  { value: item.quantidade, label: item.quantidade.toString() }
                ]}
                disabled={isLoading}
              />
            </Box>

            {/* Pendente Summary */}
            <Box sx={{ backgroundColor: "action.hover", p: 1.5, borderRadius: 1 }}>
              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Typography variant="subtitle2">Pendente</Typography>
                <Typography variant="body2" fontWeight={600}>
                  {pendente} un
                </Typography>
              </Stack>
              <Typography variant="caption" color="text.secondary" display="block" mt={0.5}>
                Atribuído: {assignments.dronz + assignments.gooder} /{" "}
                {item.quantidade}
              </Typography>
            </Box>
          </Stack>
        </Box>

        <Stack gap={2} mt="auto" pt={4}>
          <Button
            variant="contained"
            onClick={handleMutate}
            disabled={!changed || isLoading}
            fullWidth
          >
            {isLoading ? (
              <>
                <CircularProgress size={16} sx={{ mr: 1 }} />
                Atribuindo...
              </>
            ) : (
              "Confirmar"
            )}
          </Button>
          <Button variant="outlined" onClick={onClose} fullWidth disabled={isLoading}>
            Cancelar
          </Button>
        </Stack>
      </Stack>
    </Drawer>
  );
}
