import * as React from "react";
import { Alert, Button, CircularProgress, Stack, TextField } from "@mui/material";
import {
  useUnifiedPurchaseMutations,
  newIdempotencyKey
} from "../../hooks/useUnifiedPurchases";
import { useAuthStore } from "../../stores/auth";
import { readMutationError } from "./types";
import type { PurchaseProvider } from "../../types/unified-purchases";

export function ContextualAccountCreator({
  plataformaLocked,
  onCreated,
  onCancel,
  onPendingChange
}: {
  plataformaLocked: Exclude<PurchaseProvider, "MANUAL">;
  onCreated: (accountId: string) => void;
  onCancel: () => void;
  onPendingChange?: (pending: boolean) => void;
}) {
  const permissions = useAuthStore((state) => state.permissions);
  const canCreateAccount = permissions.includes("CONTA_EXTERNA_GERENCIAR");
  const { createAccount } = useUnifiedPurchaseMutations();
  const [nome, setNome] = React.useState("");
  const [externalAccountId, setExternalAccountId] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const submittingRef = React.useRef(false);

  React.useEffect(() => {
    onPendingChange?.(createAccount.isPending);
  }, [createAccount.isPending, onPendingChange]);

  if (!canCreateAccount && !createAccount.isPending) return null;

  const handleCreate = async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setError(null);
    try {
      const response = await createAccount.mutateAsync({
        payload: {
          plataforma: plataformaLocked,
          origemIntegracao: "API",
          nome,
          externalAccountId: externalAccountId || undefined
        },
        idempotencyKey: newIdempotencyKey()
      });
      const createdId = (response as { data?: { id?: string } }).data?.id;
      if (!createdId) {
        setError("Conta criada, mas o ID não veio na resposta. Atualize manualmente.");
        return;
      }
      onCreated(createdId);
    } catch (err) {
      const { message } = readMutationError(err);
      setError(message ?? "Erro ao criar conta. Tente novamente.");
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
        label="Plataforma"
        value={plataformaLocked}
        disabled
        size="small"
      />
      <TextField
        label="Nome da conta"
        value={nome}
        onChange={(event) => setNome(event.target.value)}
        required
      />
      <TextField
        label="ID externo (opcional)"
        value={externalAccountId}
        onChange={(event) => setExternalAccountId(event.target.value)}
      />
      <Stack direction="row" gap={1}>
        <Button
          variant="contained"
          size="small"
          disabled={!nome || createAccount.isPending}
          onClick={handleCreate}
        >
          {createAccount.isPending ? (
            <>
              <CircularProgress size={14} sx={{ mr: 1 }} />
              Criando...
            </>
          ) : (
            "Criar conta"
          )}
        </Button>
        <Button size="small" onClick={onCancel} disabled={createAccount.isPending}>
          Cancelar
        </Button>
      </Stack>
    </Stack>
  );
}
