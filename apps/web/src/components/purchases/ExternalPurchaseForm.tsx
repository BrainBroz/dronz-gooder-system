import * as React from "react";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  MenuItem,
  Stack,
  TextField
} from "@mui/material";
import {
  useUnifiedPurchaseMutations,
  newIdempotencyKey
} from "../../hooks/useUnifiedPurchases";
import { useAuthStore } from "../../stores/auth";
import type { PurchaseProvider, UnifiedPurchaseListItem } from "../../types/unified-purchases";
import { EntityPicker } from "./EntityPicker";
import { ContextualMerchantCreator, externalPlatforms } from "./ContextualMerchantCreator";
import { accountSuggestions, merchantSuggestions } from "./entitySuggestions";
import { readMutationError } from "./types";

export function ExternalPurchaseForm({
  listItems,
  onPendingChange,
  allowSubmit = true
}: {
  listItems: UnifiedPurchaseListItem[];
  onPendingChange?: (pending: boolean) => void;
  allowSubmit?: boolean;
}) {
  const canCreateMerchant = useAuthStore((state) =>
    state.permissions.includes("MAPPING_FORNECEDOR_GERENCIAR")
  );
  const { importPurchase } = useUnifiedPurchaseMutations();
  const [contextualMerchantPending, setContextualMerchantPending] = React.useState(false);
  const pending = importPurchase.isPending || contextualMerchantPending;
  const submittingRef = React.useRef(false);

  React.useEffect(() => {
    onPendingChange?.(pending);
  }, [pending, onPendingChange]);

  const [plataforma, setPlataforma] = React.useState<Exclude<PurchaseProvider, "MANUAL">>(
    "AMAZON"
  );
  const [contaExternaId, setContaExternaId] = React.useState("");
  const [merchantExternoId, setMerchantExternoId] = React.useState("");
  const [externalOrderId, setExternalOrderId] = React.useState("");
  const [referencia, setReferencia] = React.useState("");
  const [dataPedido, setDataPedido] = React.useState(
    new Date().toISOString().slice(0, 10)
  );
  const [moeda, setMoeda] = React.useState("USD");
  const [titulo, setTitulo] = React.useState("");
  const [externalLineId, setExternalLineId] = React.useState("");
  const [quantidade, setQuantidade] = React.useState(1);
  const [precoUnitario, setPrecoUnitario] = React.useState(0);
  const [creatingMerchant, setCreatingMerchant] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState(false);

  // Sugestões restritas à plataforma selecionada — o backend rejeita
  // contaExternaId/merchantExternoId cuja plataforma real não bate com a da
  // compra (invalid_external_account/invalid_external_merchant).
  const accounts = accountSuggestions(listItems, plataforma);
  const merchants = merchantSuggestions(listItems, plataforma);

  const canSubmit =
    Boolean(contaExternaId) &&
    Boolean(externalOrderId) &&
    Boolean(referencia) &&
    Boolean(dataPedido) &&
    moeda.length === 3 &&
    Boolean(titulo) &&
    quantidade > 0 &&
    precoUnitario >= 0;

  const handlePlataformaChange = (value: Exclude<PurchaseProvider, "MANUAL">) => {
    setPlataforma(value);
    // Conta/merchant já selecionados podem não existir na nova plataforma —
    // nunca envia uma combinação que o backend rejeitaria.
    setContaExternaId("");
    setMerchantExternoId("");
  };

  const handleSubmit = async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setError(null);
    setSuccess(false);
    try {
      await importPurchase.mutateAsync({
        idempotencyKey: newIdempotencyKey(),
        payload: {
          plataforma,
          contaExternaId,
          merchantExternoId: merchantExternoId || undefined,
          externalOrderId,
          referencia,
          dataPedido: new Date(`${dataPedido}T12:00:00.000Z`).toISOString(),
          moeda,
          origem: "API",
          itens: [
            {
              externalLineId: externalLineId || undefined,
              titulo,
              quantidade,
              precoUnitario,
              moeda
            }
          ]
        }
      });
      setSuccess(true);
    } catch (err) {
      const { message } = readMutationError(err);
      setError(message ?? "Erro ao registrar compra externa. Tente novamente.");
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
      {success && (
        <Alert severity="success" onClose={() => setSuccess(false)}>
          Compra registrada.
        </Alert>
      )}

      <TextField
        select
        label="Plataforma"
        value={plataforma}
        onChange={(event) =>
          handlePlataformaChange(event.target.value as Exclude<PurchaseProvider, "MANUAL">)
        }
        disabled={pending}
      >
        {externalPlatforms.map((p) => (
          <MenuItem key={p} value={p}>
            {p}
          </MenuItem>
        ))}
      </TextField>

      <EntityPicker
        label="Conta externa"
        suggestions={accounts}
        value={contaExternaId}
        onChange={setContaExternaId}
        required
        disabled={pending}
      />

      {creatingMerchant ? (
        <ContextualMerchantCreator
          defaultPlataforma={plataforma}
          plataformaLocked={plataforma}
          onCreated={(id) => {
            setMerchantExternoId(id);
            setCreatingMerchant(false);
            // Ver comentário equivalente em ManualPurchaseForm: o unmount do
            // criador contextual pode acontecer no mesmo commit em que
            // isPending vira false, sem o efeito interno rodar antes.
            setContextualMerchantPending(false);
          }}
          onCancel={() => setCreatingMerchant(false)}
          onPendingChange={setContextualMerchantPending}
        />
      ) : (
        <Box>
          <EntityPicker
            label="Merchant (opcional)"
            suggestions={merchants}
            value={merchantExternoId}
            onChange={setMerchantExternoId}
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
        label="Número externo"
        value={externalOrderId}
        onChange={(event) => setExternalOrderId(event.target.value)}
        disabled={pending}
      />
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
        label="Moeda"
        value={moeda}
        onChange={(event) => setMoeda(event.target.value.toUpperCase())}
        inputProps={{ maxLength: 3 }}
        disabled={pending}
      />
      <TextField
        label="Item"
        value={titulo}
        onChange={(event) => setTitulo(event.target.value)}
        disabled={pending}
      />
      <TextField
        label="ID externo da linha (opcional)"
        value={externalLineId}
        onChange={(event) => setExternalLineId(event.target.value)}
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
          label="Preço unitário"
          value={precoUnitario}
          onChange={(event) => setPrecoUnitario(Number(event.target.value))}
          disabled={pending}
        />
      </Stack>

      <Button
        variant="contained"
        onClick={handleSubmit}
        disabled={!canSubmit || pending || !allowSubmit}
      >
        {importPurchase.isPending ? (
          <>
            <CircularProgress size={16} sx={{ mr: 1 }} />
            Salvando...
          </>
        ) : (
          "Registrar compra externa"
        )}
      </Button>
    </Stack>
  );
}
