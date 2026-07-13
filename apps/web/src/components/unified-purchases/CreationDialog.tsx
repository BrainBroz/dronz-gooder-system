import React from "react";
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  MenuItem,
  Stack,
  TextField
} from "@mui/material";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import { MutationStatus } from "../ui/MutationStatus";
import {
  newIdempotencyKey,
  useUnifiedPurchaseMutations
} from "../../hooks/useUnifiedPurchases";
import { catalogQueryKeys } from "../../queryKeys";
import { authHeader, useAuthStore } from "../../stores/auth";
import type { Product } from "../../types/catalog";
import type { PurchaseProvider } from "../../types/unified-purchases";

const providers = [
  "AMAZON",
  "EBAY",
  "WALMART",
  "BEST_BUY",
  "APPLE",
  "OUTRA",
  "MANUAL"
] as const satisfies readonly PurchaseProvider[];
const externalProviders = [
  "AMAZON",
  "EBAY",
  "WALMART",
  "BEST_BUY",
  "APPLE",
  "OUTRA"
] as const;
export type CreationMode = "account" | "merchant" | "import" | "manual" | null;
const accountSchema = z.object({
  plataforma: z.enum(providers),
  identificadorExterno: z.string().min(1),
  nomeExibicao: z.string().min(1)
});
const merchantSchema = z.object({
  plataforma: z.enum(providers),
  externalMerchantId: z.string(),
  nome: z.string().min(1)
});
const purchaseSchema = z.object({
  plataforma: z.enum(externalProviders),
  contaExternaId: z.string().min(1),
  merchantExternoId: z.string(),
  externalOrderId: z.string().min(1),
  referencia: z.string().min(1),
  dataPedido: z.string().min(1),
  moeda: z.string().length(3),
  titulo: z.string().min(1),
  externalLineId: z.string(),
  quantidade: z.coerce.number().int().positive(),
  precoUnitario: z.coerce.number().nonnegative()
});
const manualSchema = z.object({
  referencia: z.string().min(1),
  lojaId: z.string().min(1),
  merchantExternoId: z.string().min(1),
  produtoId: z.string().min(1),
  dataPedido: z.string().min(1),
  titulo: z.string().min(1),
  quantidade: z.coerce.number().int().positive(),
  precoUnitario: z.coerce.number().nonnegative()
});

export function CreationDialog({
  mode,
  onClose
}: {
  mode: CreationMode;
  onClose: () => void;
}) {
  const stores = useAuthStore((state) => state.stores);
  const mutations = useUnifiedPurchaseMutations();
  const [createdId, setCreatedId] = React.useState<string | null>(null);
  const account = useForm({
    resolver: zodResolver(accountSchema),
    defaultValues: {
      plataforma: "AMAZON" as PurchaseProvider,
      identificadorExterno: "",
      nomeExibicao: ""
    }
  });
  const merchant = useForm({
    resolver: zodResolver(merchantSchema),
    defaultValues: {
      plataforma: "AMAZON" as PurchaseProvider,
      externalMerchantId: "",
      nome: ""
    }
  });
  const imported = useForm({
    resolver: zodResolver(purchaseSchema),
    defaultValues: {
      plataforma: "AMAZON" as Exclude<PurchaseProvider, "MANUAL">,
      contaExternaId: "",
      merchantExternoId: "",
      externalOrderId: "",
      referencia: "",
      dataPedido: new Date().toISOString().slice(0, 10),
      moeda: "USD",
      titulo: "",
      externalLineId: "",
      quantidade: 1,
      precoUnitario: 0
    }
  });
  const manual = useForm({
    resolver: zodResolver(manualSchema),
    defaultValues: {
      referencia: "",
      lojaId: stores[0]?.id ?? "",
      merchantExternoId: "",
      produtoId: "",
      dataPedido: new Date().toISOString().slice(0, 10),
      titulo: "",
      quantidade: 1,
      precoUnitario: 0
    }
  });
  const selectedManualStore = useWatch({
    control: manual.control,
    name: "lojaId"
  });
  const products = useQuery<Product[]>({
    queryKey: catalogQueryKeys.products(selectedManualStore || null),
    enabled: mode === "manual" && Boolean(selectedManualStore),
    queryFn: async () =>
      (
        await api.get("/products", {
          headers: { ...authHeader(), "x-store-id": selectedManualStore }
        })
      ).data.items
  });
  const complete = (response: { data?: { id?: string } }) =>
    setCreatedId(response.data?.id ?? null);
  const pending =
    mutations.createAccount.isPending ||
    mutations.createMerchant.isPending ||
    mutations.importPurchase.isPending ||
    mutations.createManualPurchase.isPending;

  return (
    <Dialog
      open={mode !== null}
      onClose={pending ? undefined : onClose}
      fullWidth
      maxWidth="md"
    >
      <DialogTitle>
        {mode === "account" && "Cadastrar conta externa"}
        {mode === "merchant" && "Cadastrar merchant externo"}
        {mode === "import" && "Registrar compra externa"}
        {mode === "manual" && "Criar compra manual"}
      </DialogTitle>
      <DialogContent>
        <Stack gap={2} mt={1}>
          {(mode === "import" || mode === "manual") && (
            <Alert severity="info">
              A API ainda não oferece listagem de contas ou merchants. Informe
              IDs previamente cadastrados; a interface não cria opções
              fictícias.
            </Alert>
          )}
          {mode === "account" && (
            <form
              id="creation-form"
              onSubmit={account.handleSubmit(async (values) =>
                complete(
                  await mutations.createAccount.mutateAsync({
                    payload: { ...values, origemIntegracao: "API" },
                    idempotencyKey: newIdempotencyKey()
                  })
                )
              )}
            >
              <Stack gap={2}>
                <Controller
                  name="plataforma"
                  control={account.control}
                  render={({ field }) => (
                    <TextField {...field} select label="Plataforma">
                      {providers
                        .filter((p) => p !== "MANUAL")
                        .map((p) => (
                          <MenuItem key={p} value={p}>
                            {p}
                          </MenuItem>
                        ))}
                    </TextField>
                  )}
                />
                <Controller
                  name="identificadorExterno"
                  control={account.control}
                  render={({ field }) => (
                    <TextField {...field} label="Identificador externo" />
                  )}
                />
                <Controller
                  name="nomeExibicao"
                  control={account.control}
                  render={({ field }) => (
                    <TextField {...field} label="Nome de exibição" />
                  )}
                />
                <MutationStatus
                  mutation={mutations.createAccount}
                  successMessage="Conta cadastrada."
                />
              </Stack>
            </form>
          )}
          {mode === "merchant" && (
            <form
              id="creation-form"
              onSubmit={merchant.handleSubmit(async (values) =>
                complete(
                  await mutations.createMerchant.mutateAsync({
                    payload: {
                      ...values,
                      externalMerchantId: values.externalMerchantId || undefined
                    },
                    idempotencyKey: newIdempotencyKey()
                  })
                )
              )}
            >
              <Stack gap={2}>
                <Controller
                  name="plataforma"
                  control={merchant.control}
                  render={({ field }) => (
                    <TextField {...field} select label="Plataforma">
                      {providers
                        .filter((p) => p !== "MANUAL")
                        .map((p) => (
                          <MenuItem key={p} value={p}>
                            {p}
                          </MenuItem>
                        ))}
                    </TextField>
                  )}
                />
                <Controller
                  name="externalMerchantId"
                  control={merchant.control}
                  render={({ field }) => (
                    <TextField {...field} label="ID externo (opcional)" />
                  )}
                />
                <Controller
                  name="nome"
                  control={merchant.control}
                  render={({ field }) => (
                    <TextField {...field} label="Nome do merchant" />
                  )}
                />
                <MutationStatus
                  mutation={mutations.createMerchant}
                  successMessage="Merchant cadastrado."
                />
              </Stack>
            </form>
          )}
          {mode === "import" && (
            <form
              id="creation-form"
              onSubmit={imported.handleSubmit(async (values) =>
                complete(
                  await mutations.importPurchase.mutateAsync({
                    idempotencyKey: newIdempotencyKey(),
                    payload: {
                      plataforma: values.plataforma,
                      contaExternaId: values.contaExternaId,
                      merchantExternoId: values.merchantExternoId || undefined,
                      externalOrderId: values.externalOrderId,
                      referencia: values.referencia,
                      dataPedido: new Date(
                        `${values.dataPedido}T12:00:00.000Z`
                      ).toISOString(),
                      moeda: values.moeda,
                      origem: "API",
                      itens: [
                        {
                          externalLineId: values.externalLineId || undefined,
                          titulo: values.titulo,
                          quantidade: values.quantidade,
                          precoUnitario: values.precoUnitario,
                          moeda: values.moeda
                        }
                      ]
                    }
                  })
                )
              )}
            >
              <Grid container spacing={2}>
                {(
                  [
                    "plataforma",
                    "contaExternaId",
                    "merchantExternoId",
                    "externalOrderId",
                    "referencia",
                    "dataPedido",
                    "moeda",
                    "titulo",
                    "externalLineId",
                    "quantidade",
                    "precoUnitario"
                  ] as const
                ).map((name) => (
                  <Grid key={name} size={{ xs: 12, sm: 6 }}>
                    <Controller
                      name={name}
                      control={imported.control}
                      render={({ field }) =>
                        name === "plataforma" ? (
                          <TextField
                            {...field}
                            fullWidth
                            select
                            label="Plataforma"
                          >
                            {providers
                              .filter((p) => p !== "MANUAL")
                              .map((p) => (
                                <MenuItem key={p} value={p}>
                                  {p}
                                </MenuItem>
                              ))}
                          </TextField>
                        ) : (
                          <TextField
                            {...field}
                            fullWidth
                            type={
                              name === "dataPedido"
                                ? "date"
                                : name === "quantidade" ||
                                    name === "precoUnitario"
                                  ? "number"
                                  : "text"
                            }
                            label={
                              {
                                contaExternaId: "ID da conta",
                                merchantExternoId: "ID do merchant (opcional)",
                                externalOrderId: "Número externo",
                                referencia: "Referência",
                                dataPedido: "Data",
                                moeda: "Moeda",
                                titulo: "Item",
                                externalLineId:
                                  "ID externo da linha (opcional)",
                                quantidade: "Quantidade",
                                precoUnitario: "Preço unitário"
                              }[name]
                            }
                            InputLabelProps={
                              name === "dataPedido"
                                ? { shrink: true }
                                : undefined
                            }
                          />
                        )
                      }
                    />
                  </Grid>
                ))}
              </Grid>
              <MutationStatus
                mutation={mutations.importPurchase}
                successMessage="Compra registrada."
              />
            </form>
          )}
          {mode === "manual" && (
            <form
              id="creation-form"
              onSubmit={manual.handleSubmit(async (values) =>
                complete(
                  await mutations.createManualPurchase.mutateAsync({
                    storeId: values.lojaId,
                    idempotencyKey: newIdempotencyKey(),
                    payload: {
                      referencia: values.referencia,
                      lojaId: values.lojaId,
                      merchantExternoId: values.merchantExternoId,
                      dataPedido: new Date(
                        `${values.dataPedido}T12:00:00.000Z`
                      ).toISOString(),
                      moeda: "USD",
                      itens: [
                        {
                          titulo: values.titulo,
                          quantidade: values.quantidade,
                          precoUnitario: values.precoUnitario,
                          moeda: "USD",
                          produtoId: values.produtoId
                        }
                      ]
                    }
                  })
                )
              )}
            >
              <Stack gap={2}>
                <Controller
                  name="lojaId"
                  control={manual.control}
                  render={({ field }) => (
                    <TextField {...field} select label="Loja">
                      {stores.map((store) => (
                        <MenuItem key={store.id} value={store.id}>
                          {store.nome}
                        </MenuItem>
                      ))}
                    </TextField>
                  )}
                />
                <Controller
                  name="merchantExternoId"
                  control={manual.control}
                  render={({ field }) => (
                    <TextField {...field} label="ID do merchant" />
                  )}
                />
                <Controller
                  name="produtoId"
                  control={manual.control}
                  render={({ field }) => (
                    <TextField {...field} select label="Produto">
                      {(products.data ?? []).map((product) => (
                        <MenuItem key={product.id} value={product.id}>
                          {product.codigo} — {product.nome}
                        </MenuItem>
                      ))}
                    </TextField>
                  )}
                />
                <Controller
                  name="referencia"
                  control={manual.control}
                  render={({ field }) => (
                    <TextField {...field} label="Referência" />
                  )}
                />
                <Controller
                  name="dataPedido"
                  control={manual.control}
                  render={({ field }) => (
                    <TextField
                      {...field}
                      type="date"
                      label="Data"
                      InputLabelProps={{ shrink: true }}
                    />
                  )}
                />
                <Controller
                  name="titulo"
                  control={manual.control}
                  render={({ field }) => <TextField {...field} label="Item" />}
                />
                <Stack direction="row" gap={2}>
                  <Controller
                    name="quantidade"
                    control={manual.control}
                    render={({ field }) => (
                      <TextField {...field} type="number" label="Quantidade" />
                    )}
                  />
                  <Controller
                    name="precoUnitario"
                    control={manual.control}
                    render={({ field }) => (
                      <TextField
                        {...field}
                        type="number"
                        label="Preço unitário (USD)"
                      />
                    )}
                  />
                </Stack>
                <MutationStatus
                  mutation={mutations.createManualPurchase}
                  successMessage="Compra manual criada."
                />
              </Stack>
            </form>
          )}
          {createdId && (
            <Alert severity="success">
              Registro criado. ID: <code>{createdId}</code>
            </Alert>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Fechar</Button>
        <Button
          type="submit"
          form="creation-form"
          variant="contained"
          disabled={pending}
        >
          Salvar
        </Button>
      </DialogActions>
    </Dialog>
  );
}
