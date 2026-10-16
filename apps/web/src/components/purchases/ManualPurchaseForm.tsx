import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  MenuItem,
  Stack,
  TextField,
  Typography
} from "@mui/material";
import { useAuthStore } from "../../stores/auth";
import { catalogQueryKeys } from "../../queryKeys";
import {
  useUnifiedPurchaseMutations,
  newIdempotencyKey
} from "../../hooks/useUnifiedPurchases";
import type { UnifiedPurchaseListItem } from "../../types/unified-purchases";
import { fetchProducts } from "../../hooks/useCatalog";
import { EntityPicker } from "./EntityPicker";
import { ContextualMerchantCreator } from "./ContextualMerchantCreator";
import { merchantSuggestions } from "./entitySuggestions";
import { readMutationError } from "./types";
import { localDateString } from "./dateUtils";

export function ManualPurchaseForm({
  listItems,
  onPendingChange,
  allowSubmit = true
}: {
  listItems: UnifiedPurchaseListItem[];
  onPendingChange?: (pending: boolean) => void;
  allowSubmit?: boolean;
}) {
  const stores = useAuthStore((state) => state.stores);
  const activeStoreId = useAuthStore((state) => state.activeStoreId);
  const canCreateMerchant = useAuthStore((state) =>
    state.permissions.includes("MAPPING_FORNECEDOR_GERENCIAR")
  );
  const { createManualPurchase } = useUnifiedPurchaseMutations();
  const [contextualMerchantPending, setContextualMerchantPending] = React.useState(false);
  const pending = createManualPurchase.isPending || contextualMerchantPending;
  const submittingRef = React.useRef(false);
  const attemptRef = React.useRef<{ payload: string; key: string } | null>(null);

  React.useEffect(() => {
    onPendingChange?.(pending);
  }, [pending, onPendingChange]);

  const [lojaId, setLojaId] = React.useState(activeStoreId ?? "");
  const [merchantExternoId, setMerchantExternoId] = React.useState("");
  const [produtoId, setProdutoId] = React.useState("");
  const [referencia, setReferencia] = React.useState("");
  const [dataPedido, setDataPedido] = React.useState(localDateString);
  const [titulo, setTitulo] = React.useState("");
  const [quantidade, setQuantidade] = React.useState(1);
  const [precoUnitario, setPrecoUnitario] = React.useState(0);
  const [creatingMerchant, setCreatingMerchant] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState(false);

  // Troca global da loja ativa (fora deste formulário) invalida a loja e o
  // produto selecionados aqui — produto pertence à loja anterior e não pode
  // seguir junto para a nova.
  const previousActiveStoreIdRef = React.useRef(activeStoreId);
  React.useEffect(() => {
    if (activeStoreId !== previousActiveStoreIdRef.current) {
      previousActiveStoreIdRef.current = activeStoreId;
      setLojaId(activeStoreId ?? "");
      setProdutoId("");
    }
  }, [activeStoreId]);

  const products = useQuery({
    queryKey: catalogQueryKeys.products(lojaId || null),
    enabled: Boolean(lojaId),
    queryFn: () => fetchProducts(lojaId)
  });
  const availableProducts = (products.data ?? []).filter((product) => product.ativo);
  const selectedProductId = availableProducts.some((product) => product.id === produtoId)
    ? produtoId
    : "";

  const merchants = merchantSuggestions(listItems);

  const canSubmit =
    !creatingMerchant &&
    Boolean(lojaId) &&
    Boolean(merchantExternoId) &&
    Boolean(selectedProductId) &&
    Boolean(referencia) &&
    Boolean(dataPedido) &&
    Boolean(titulo) &&
    quantidade > 0 &&
    precoUnitario >= 0;

  const resetPurchaseFields = () => {
    setMerchantExternoId("");
    setProdutoId("");
    setReferencia("");
    setTitulo("");
    setQuantidade(1);
    setPrecoUnitario(0);
    setDataPedido(localDateString());
    // lojaId preservado: é contexto de trabalho, não conteúdo da compra.
  };

  const handleSubmit = async () => {
    // Trava síncrona: mesmo que o re-render que desabilita o botão ainda não
    // tenha acontecido, um segundo clique real (fireEvent duplo, síncrono)
    // não passa daqui. Repetições do mesmo payload mantêm a idempotency key.
    if (submittingRef.current) return;
    submittingRef.current = true;
    setError(null);
    setSuccess(false);
    const payload = {
      referencia,
      lojaId,
      merchantExternoId,
      dataPedido: new Date(`${dataPedido}T12:00:00.000Z`).toISOString(),
      moeda: "USD",
      itens: [{ titulo, quantidade, precoUnitario, moeda: "USD", produtoId }]
    };
    const serialized = JSON.stringify(payload);
    if (attemptRef.current?.payload !== serialized)
      attemptRef.current = { payload: serialized, key: newIdempotencyKey() };
    try {
      await createManualPurchase.mutateAsync({
        storeId: lojaId,
        idempotencyKey: attemptRef.current.key,
        payload
      });
      attemptRef.current = null;
      resetPurchaseFields();
      setSuccess(true);
    } catch (err) {
      const { message } = readMutationError(err);
      setError(message ?? "Erro ao criar compra manual. Tente novamente.");
    } finally {
      submittingRef.current = false;
    }
  };

  return (
    <Stack gap={2}>
      {error && (
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {products.isError && (
        <Alert severity="error" action={<Button onClick={() => void products.refetch()}>Tentar novamente</Button>}>
          Não foi possível carregar os produtos da loja.
        </Alert>
      )}
      {success && (
        <Alert severity="success" onClose={() => setSuccess(false)}>
          Compra manual criada.
        </Alert>
      )}

      <TextField
        select
        label="Loja"
        value={lojaId}
        onChange={(event) => {
          setLojaId(event.target.value);
          setProdutoId("");
        }}
        disabled={pending}
      >
        {stores.map((store) => (
          <MenuItem key={store.id} value={store.id}>
            {store.nome}
          </MenuItem>
        ))}
      </TextField>

      {creatingMerchant ? (
        <ContextualMerchantCreator
          onCreated={(id) => {
            setMerchantExternoId(id);
            setCreatingMerchant(false);
            // O sucesso desmonta o criador contextual no mesmo commit em que
            // isPending vira false — o efeito interno dele pode não chegar a
            // rodar antes do unmount, então zeramos aqui explicitamente para
            // nunca deixar o formulário travado em "pending" para sempre.
            setContextualMerchantPending(false);
          }}
          onCancel={() => setCreatingMerchant(false)}
          onPendingChange={setContextualMerchantPending}
        />
      ) : (
        <Box>
          <EntityPicker
            label="Merchant"
            suggestions={merchants}
            value={merchantExternoId}
            onChange={setMerchantExternoId}
            required
            disabled={pending}
          />
          {canCreateMerchant && (
            <Button size="small" onClick={() => setCreatingMerchant(true)} disabled={pending}>
              Criar novo merchant
            </Button>
          )}
        </Box>
      )}

      <TextField
        select
        label="Produto"
        value={selectedProductId}
        onChange={(event) => setProdutoId(event.target.value)}
        disabled={!lojaId || pending}
      >
        {availableProducts.map((product) => (
          <MenuItem key={product.id} value={product.id}>
            {product.codigo} — {product.nome}
          </MenuItem>
        ))}
      </TextField>

      <TextField
        label="Referência"
        value={referencia}
        onChange={(event) => setReferencia(event.target.value)}
        disabled={pending}
      />
      <TextField
        type="date"
        label="Data"
        InputLabelProps={{ shrink: true }}
        value={dataPedido}
        onChange={(event) => setDataPedido(event.target.value)}
        disabled={pending}
      />
      <TextField
        label="Item"
        value={titulo}
        onChange={(event) => setTitulo(event.target.value)}
        disabled={pending}
      />
      <Stack direction="row" gap={2}>
        <TextField
          type="number"
          label="Quantidade"
          value={quantidade}
          onChange={(event) => setQuantidade(Number(event.target.value))}
          disabled={pending}
        />
        <TextField
          type="number"
          label="Preço unitário (USD)"
          value={precoUnitario}
          onChange={(event) => setPrecoUnitario(Number(event.target.value))}
          disabled={pending}
        />
      </Stack>

      <Typography variant="caption" color="text.secondary">
        Moeda fixa em USD para compras manuais, conforme o contrato atual.
      </Typography>

      <Button
        variant="contained"
        onClick={handleSubmit}
        disabled={!canSubmit || pending || !allowSubmit}
      >
        {createManualPurchase.isPending ? (
          <>
            <CircularProgress size={16} sx={{ mr: 1 }} />
            Salvando...
          </>
        ) : (
          "Criar compra manual"
        )}
      </Button>
    </Stack>
  );
}
