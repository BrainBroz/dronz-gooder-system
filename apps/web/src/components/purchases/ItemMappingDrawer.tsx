import * as React from "react";
import {
  Button,
  CircularProgress,
  Drawer,
  IconButton,
  InputAdornment,
  Stack,
  TextField,
  Typography,
  Alert,
  List,
  ListItemButton,
  ListItemText,
  Box
} from "@mui/material";
import { useUnifiedPurchaseMutations, newIdempotencyKey } from "../../hooks/useUnifiedPurchases";
import { useProducts } from "../../hooks/useCatalog";
import { useAuthStore } from "../../stores/auth";
import type { UnifiedPurchaseItemDetail } from "../../types/unified-purchases";
import type { MutationError } from "./types";

export function ItemMappingDrawer({
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
  const [searchQuery, setSearchQuery] = React.useState("");
  const [selectedProductId, setSelectedProductId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<MutationError | null>(null);
  const { activeStoreId } = useAuthStore();
  const { products } = useProducts();
  const { setProductMapping } = useUnifiedPurchaseMutations();

  const filteredProducts = React.useMemo(() => {
    if (!searchQuery.trim()) return [];
    const query = searchQuery.toLowerCase();
    return (products ?? []).filter(
      (p) =>
        p.nome.toLowerCase().includes(query) ||
        p.codigo.toString().includes(query)
    );
  }, [searchQuery, products]);

  const handleMutate = async () => {
    if (!selectedProductId || !activeStoreId) return;
    setError(null);

    try {
      // expectedVersion valida contra a versão do mapping existente para esta
      // loja (mapping.version no backend), não a versão da compra (detail.version)
      // nem a versão do item. Se ainda não existe mapping, o backend não valida
      // (campo opcional), então enviamos undefined nesse caso.
      const existingMapping = item.mapeamentos.find(
        (mapping) => mapping.lojaId === activeStoreId
      );

      await setProductMapping.mutateAsync({
        purchaseId,
        itemId: item.id,
        storeId: activeStoreId,
        produtoId: selectedProductId,
        expectedVersion: existingMapping?.version,
        idempotencyKey: newIdempotencyKey()
      });

      setSearchQuery("");
      setSelectedProductId(null);
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
          message: message || "Erro ao mapear produto. Tente novamente.",
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
          <Typography variant="h6">Mapear Produto</Typography>
          <Typography variant="body2" color="text.secondary">
            {item.titulo}
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

        <TextField
          placeholder="Buscar produto..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          fullWidth
          size="small"
          autoFocus
          InputProps={{
            endAdornment: searchQuery && (
              <InputAdornment position="end">
                <Typography variant="caption" color="text.secondary">
                  {filteredProducts.length} resultado(s)
                </Typography>
              </InputAdornment>
            )
          }}
        />

        {searchQuery && filteredProducts.length > 0 && (
          <List sx={{ maxHeight: 300, overflow: "auto", border: "1px solid", borderColor: "divider", borderRadius: 1 }}>
            {filteredProducts.map((product) => (
              <ListItemButton
                key={product.id}
                selected={selectedProductId === product.id}
                onClick={() => setSelectedProductId(product.id)}
              >
                <ListItemText
                  primary={product.nome}
                  secondary={`Código: ${product.codigo}`}
                />
              </ListItemButton>
            ))}
          </List>
        )}

        <Stack gap={2} mt="auto" pt={4}>
          <Button
            variant="contained"
            onClick={handleMutate}
            disabled={!selectedProductId || setProductMapping.isPending}
            fullWidth
          >
            {setProductMapping.isPending ? (
              <>
                <CircularProgress size={16} sx={{ mr: 1 }} />
                Salvando...
              </>
            ) : (
              "Confirmar"
            )}
          </Button>
          <Button variant="outlined" onClick={onClose} fullWidth>
            Cancelar
          </Button>
        </Stack>
      </Stack>
    </Drawer>
  );
}
