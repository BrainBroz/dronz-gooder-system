import * as React from "react";
import { Alert, Button, CircularProgress, MenuItem, Stack, TextField } from "@mui/material";
import {
  useUnifiedPurchaseMutations,
  newIdempotencyKey
} from "../../hooks/useUnifiedPurchases";
import { useAuthStore } from "../../stores/auth";
import { readMutationError } from "./types";
import type { PurchaseProvider } from "../../types/unified-purchases";

export const externalPlatforms: Exclude<PurchaseProvider, "MANUAL">[] = [
  "AMAZON",
  "EBAY",
  "WALMART",
  "BEST_BUY",
  "APPLE",
  "OUTRA"
];

/**
 * Criação contextual de merchant dentro de Nova Compra. Só aparece para quem
 * tem MAPPING_FORNECEDOR_GERENCIAR. Ao suceder, devolve o ID criado para o
 * formulário pai preencher automaticamente — o usuário nunca copia o ID.
 */
export function ContextualMerchantCreator({
  defaultPlataforma,
  plataformaLocked,
  onCreated,
  onCancel,
  onPendingChange
}: {
  defaultPlataforma?: Exclude<PurchaseProvider, "MANUAL">;
  plataformaLocked?: Exclude<PurchaseProvider, "MANUAL">;
  onCreated: (merchantId: string) => void;
  onCancel: () => void;
  onPendingChange?: (pending: boolean) => void;
}) {
  const permissions = useAuthStore((state) => state.permissions);
  const canCreateMerchant = permissions.includes("MAPPING_FORNECEDOR_GERENCIAR");
  const { createMerchant } = useUnifiedPurchaseMutations();
  const [plataforma, setPlataforma] = React.useState<Exclude<PurchaseProvider, "MANUAL">>(
    defaultPlataforma ?? "AMAZON"
  );
  const plataformaEfetiva = plataformaLocked ?? plataforma;
  const [nome, setNome] = React.useState("");
  const [externalMerchantId, setExternalMerchantId] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const submittingRef = React.useRef(false);

  React.useEffect(() => {
    onPendingChange?.(createMerchant.isPending);
  }, [createMerchant.isPending, onPendingChange]);

  // Perder MAPPING_FORNECEDOR_GERENCIAR não pode desmontar este formulário
  // enquanto a criação do merchant ainda está em voo — mesmo risco do C1-bis,
  // aplicado aqui. Só desmonta de fato depois que a mutação termina.
  if (!canCreateMerchant && !createMerchant.isPending) return null;

  const handleCreate = async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setError(null);
    try {
      const response = await createMerchant.mutateAsync({
        payload: {
          plataforma: plataformaEfetiva,
          nome,
          externalMerchantId: externalMerchantId || undefined
        },
        idempotencyKey: newIdempotencyKey()
      });
      const createdId = (response as { data?: { id?: string } }).data?.id;
      if (!createdId) {
        setError("Merchant criado, mas o ID não veio na resposta. Atualize manualmente.");
        return;
      }
      onCreated(createdId);
    } catch (err) {
      const { message } = readMutationError(err);
      setError(message ?? "Erro ao criar merchant. Tente novamente.");
    } finally {
      submittingRef.current = false;
    }
  };

  return (
    <Stack gap={1.5} sx={{ border: "1px solid", borderColor: "divider", borderRadius: 1, p: 2 }}>
      {error && (
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      <TextField
        select
        label="Plataforma"
        value={plataformaEfetiva}
        onChange={(event) =>
          setPlataforma(event.target.value as Exclude<PurchaseProvider, "MANUAL">)
        }
        disabled={Boolean(plataformaLocked)}
      >
        {externalPlatforms.map((p) => (
          <MenuItem key={p} value={p}>
            {p}
          </MenuItem>
        ))}
      </TextField>
      <TextField
        label="Nome do merchant"
        value={nome}
        onChange={(event) => setNome(event.target.value)}
        required
        disabled={createMerchant.isPending}
      />
      <TextField
        label="ID externo (opcional)"
        value={externalMerchantId}
        onChange={(event) => setExternalMerchantId(event.target.value)}
        disabled={createMerchant.isPending}
      />
      <Stack direction="row" gap={1}>
        <Button
          variant="contained"
          size="small"
          disabled={!nome || createMerchant.isPending}
          onClick={handleCreate}
        >
          {createMerchant.isPending ? (
            <>
              <CircularProgress size={14} sx={{ mr: 1 }} />
              Criando...
            </>
          ) : (
            "Criar merchant"
          )}
        </Button>
        <Button size="small" onClick={onCancel} disabled={createMerchant.isPending}>
          Cancelar
        </Button>
      </Stack>
    </Stack>
  );
}
