import React from "react";
import { Box, Button, Stack, TextField, Typography } from "@mui/material";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ContentCard } from "../components/ui/ContentCard";
import { PageContainer } from "../components/ui/PageContainer";
import { PageHeader } from "../components/ui/PageHeader";
import { MutationStatus } from "../components/ui/MutationStatus";
import { api } from "../api/client";
import { authHeader, useAuthStore } from "../stores/auth";
import { catalogQueryKeys } from "../queryKeys";
import type { Category } from "../types/catalog";
import { useCategories } from "../hooks/useCatalog";

const categorySchema = z.object({
  nome: z.string().min(1, "Nome obrigatório"),
  slug: z.string().min(1, "Slug obrigatório"),
  descricao: z.string().optional(),
  ordem: z.coerce.number().int().default(0),
  ativo: z.boolean().optional()
});

const categoryDefaultValues = {
  nome: "",
  slug: "",
  descricao: "",
  ordem: 0,
  ativo: true
};

export function CategoriesPage() {
  const {
    categories,
    categoriesError,
    categoriesLoading: loading
  } = useCategories();
  const error = categoriesError ? "Falha ao carregar dados" : null;
  const activeStoreId = useAuthStore((s) => s.activeStoreId);
  const client = useQueryClient();
  const [editing, setEditing] = React.useState<Category | null>(null);
  const form = useForm({
    resolver: zodResolver(categorySchema),
    defaultValues: categoryDefaultValues
  });
  const [resetForStoreId, setResetForStoreId] =
    React.useState(activeStoreId);
  const invalidate = () =>
    Promise.all([
      client.invalidateQueries({
        queryKey: catalogQueryKeys.categories(activeStoreId)
      }),
      client.invalidateQueries({
        queryKey: catalogQueryKeys.products(activeStoreId)
      })
    ]);
  // Captura se a submissão era uma edição no momento do envio: `editing` já
  // é limpo dentro de onSuccess, então não pode ser lido no render seguinte
  // para escolher a mensagem de sucesso correta.
  const [wasEditing, setWasEditing] = React.useState(false);
  const saveMutation = useMutation({
    mutationFn: async (values: z.infer<typeof categorySchema>) => {
      setWasEditing(!!editing);
      return editing
        ? api.patch(`/categories/${editing.id}`, values, {
            headers: { ...authHeader(), "x-store-id": activeStoreId }
          })
        : api.post("/categories", values, {
            headers: { ...authHeader(), "x-store-id": activeStoreId }
          });
    },
    onSuccess: async () => {
      await invalidate();
      setEditing(null);
      form.reset(categoryDefaultValues);
    }
  });
  const toggleMutation = useMutation({
    mutationFn: (category: Category) =>
      api.patch(
        `/categories/${category.id}/status`,
        {},
        { headers: { ...authHeader(), "x-store-id": activeStoreId } }
      ),
    onSuccess: invalidate
  });
  const removeMutation = useMutation({
    mutationFn: (category: Category) =>
      api.delete(`/categories/${category.id}`, {
        headers: { ...authHeader(), "x-store-id": activeStoreId }
      }),
    onSuccess: invalidate
  });
  // Descarta edição e feedback de mutação em andamento ao trocar de loja
  // (evita PATCH cross-tenant com dados de outra loja ainda preenchidos).
  if (activeStoreId !== resetForStoreId) {
    setResetForStoreId(activeStoreId);
    setEditing(null);
    form.reset(categoryDefaultValues);
    saveMutation.reset();
    toggleMutation.reset();
    removeMutation.reset();
  }
  const save = form.handleSubmit((values) => saveMutation.mutateAsync(values));
  const rowBusy = toggleMutation.isPending || removeMutation.isPending;
  const { errors } = form.formState;
  return (
    <PageContainer>
      <Stack gap={{ xs: 2.5, md: 3.5 }}>
        <PageHeader title="Categorias" />
        {loading && <Typography>Carregando...</Typography>}
        {error && <Typography color="error.main">{error}</Typography>}
        <Stack direction="row" gap={2} flexWrap="wrap">
          <Box sx={{ width: "100%", maxWidth: 340 }}>
            <ContentCard>
              <form onSubmit={save} noValidate>
                <Stack gap={2}>
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
                    name="slug"
                    control={form.control}
                    render={({ field }) => (
                      <TextField
                        {...field}
                        label="Slug"
                        error={!!errors.slug}
                        helperText={errors.slug?.message}
                      />
                    )}
                  />
                  <Controller
                    name="descricao"
                    control={form.control}
                    render={({ field }) => (
                      <TextField {...field} label="Descrição" />
                    )}
                  />
                  <Controller
                    name="ordem"
                    control={form.control}
                    render={({ field }) => (
                      <TextField {...field} label="Ordem" type="number" />
                    )}
                  />
                  <Button
                    type="submit"
                    variant="contained"
                    disabled={saveMutation.isPending}
                  >
                    {editing ? "Salvar" : "Criar"}
                  </Button>
                  <MutationStatus
                    mutation={saveMutation}
                    successMessage={
                      wasEditing
                        ? "Categoria salva com sucesso."
                        : "Categoria criada com sucesso."
                    }
                  />
                </Stack>
              </form>
            </ContentCard>
          </Box>
          {categories.map((category) => (
            <Box
              key={category.id}
              sx={{
                width: "100%",
                maxWidth: 300,
                opacity: category.ativo ? 1 : 0.6
              }}
            >
              <ContentCard>
                <Typography>{category.nome}</Typography>
                <Typography variant="body2" color="text.secondary">
                  {category.slug}
                </Typography>
                <Stack direction="row" gap={1} mt={2}>
                  <Button
                    onClick={() => {
                      setEditing(category);
                      form.reset({
                        nome: category.nome,
                        slug: category.slug,
                        descricao: category.descricao ?? "",
                        ordem: category.ordem,
                        ativo: category.ativo
                      });
                    }}
                  >
                    Editar
                  </Button>
                  <Button
                    disabled={rowBusy}
                    onClick={() => toggleMutation.mutate(category)}
                  >
                    {category.ativo ? "Desativar" : "Ativar"}
                  </Button>
                  <Button
                    color="error"
                    disabled={rowBusy}
                    onClick={() => removeMutation.mutate(category)}
                  >
                    Excluir
                  </Button>
                </Stack>
              </ContentCard>
            </Box>
          ))}
        </Stack>
        <MutationStatus
          mutation={toggleMutation}
          successMessage="Status atualizado."
        />
        <MutationStatus
          mutation={removeMutation}
          successMessage="Categoria excluída."
        />
        {!loading && !categories.length && (
          <Typography>Nenhuma categoria.</Typography>
        )}
      </Stack>
    </PageContainer>
  );
}
