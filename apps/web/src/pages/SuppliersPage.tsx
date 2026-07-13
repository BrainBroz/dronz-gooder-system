import React from "react";
import { Button, Stack, TextField, Typography } from "@mui/material";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ContentCard } from "../components/ui/ContentCard";
import { PageContainer } from "../components/ui/PageContainer";
import { PageHeader } from "../components/ui/PageHeader";
import { MutationStatus } from "../components/ui/MutationStatus";
import { api } from "../api/client";
import { authHeader, useAuthStore } from "../stores/auth";
import { purchasingQueryKeys } from "../queryKeys";
import type { Supplier } from "../types/purchasing";

function SuppliersContent() {
  const store = useAuthStore((s) => s.activeStoreId),
    client = useQueryClient();
  const q = useQuery<Supplier[]>({
    queryKey: purchasingQueryKeys.suppliers(store),
    enabled: !!store,
    queryFn: async () =>
      (
        await api.get("/suppliers", {
          headers: { ...authHeader(), "x-store-id": store }
        })
      ).data.items
  });
  const form = useForm({
    resolver: zodResolver(
      z.object({
        nome: z.string().min(1),
        moedaPadrao: z.string().regex(/^[A-Z]{3}$/)
      })
    ),
    defaultValues: { nome: "", moedaPadrao: "USD" }
  });
  const m = useMutation({
    mutationFn: (v: { nome: string; moedaPadrao: string }) =>
      api.post("/suppliers", v, {
        headers: { ...authHeader(), "x-store-id": store }
      }),
    onSuccess: async () => {
      await client.invalidateQueries({
        queryKey: purchasingQueryKeys.suppliers(store)
      });
      form.reset();
    }
  });
  const { errors } = form.formState;
  return (
    <PageContainer>
      <Stack gap={{ xs: 2.5, md: 3.5 }}>
        <PageHeader title="Fornecedores" />
        <ContentCard>
          <form onSubmit={form.handleSubmit((v) => m.mutateAsync(v))} noValidate>
            <Stack direction="row" gap={2} flexWrap="wrap">
              <Controller
                name="nome"
                control={form.control}
                render={({ field }) => (
                  <TextField
                    {...field}
                    label="Nome"
                    error={!!errors.nome}
                    helperText={errors.nome?.message}
                  />
                )}
              />
              <Controller
                name="moedaPadrao"
                control={form.control}
                render={({ field }) => (
                  <TextField
                    {...field}
                    label="Moeda"
                    error={!!errors.moedaPadrao}
                    helperText={errors.moedaPadrao?.message}
                  />
                )}
              />
              <Button type="submit" disabled={m.isPending}>
                Criar
              </Button>
            </Stack>
            <MutationStatus
              mutation={m}
              successMessage="Fornecedor criado com sucesso."
            />
          </form>
        </ContentCard>
        {q.isLoading && <Typography>Carregando...</Typography>}
        {q.isError && <Typography>Falha ao carregar dados</Typography>}
        {q.data?.map((s) => (
          <ContentCard key={s.id}>
            <Typography>{s.nome}</Typography>
            <Typography color="text.secondary" variant="body2">
              {s.ativo ? "Ativo" : "Inativo"}
            </Typography>
          </ContentCard>
        ))}
        {!q.isLoading && !q.data?.length && (
          <Typography>Nenhum fornecedor.</Typography>
        )}
      </Stack>
    </PageContainer>
  );
}

export function SuppliersPage() {
  const store = useAuthStore((state) => state.activeStoreId);
  return <SuppliersContent key={store} />;
}
