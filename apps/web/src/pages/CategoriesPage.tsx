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

function CategoriesForm() {
  const activeStoreId = useAuthStore((s) => s.activeStoreId);
  const client = useQueryClient();
  const [editing, setEditing] = React.useState<Category | null>(null);
  const form = useForm({
    resolver: zodResolver(categorySchema),
    defaultValues: categoryDefaultValues
  });
  const invalidate = () =>
    Promise.all([
      client.invalidateQueries({
        queryKey: catalogQueryKeys.categories(activeStoreId)
      }),
      client.invalidateQueries({
        queryKey: catalogQueryKeys.products(activeStoreId)
      })
    ]);
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
  const save = form.handleSubmit((values) => saveMutation.mutateAsync(values));
  const { errors } = form.formState;

  return (
    <>
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
      <MutationStatus
        mutation={toggleMutation}
        successMessage="Status atualizado."
      />
      <MutationStatus
        mutation={removeMutation}
        successMessage="Categoria excluída."
      />
    </>
  );
}

export function CategoriesPage() {
  const {
    categories,
    categoriesError,
    categoriesLoading: loading
  } = useCategories();
  const error = categoriesError ? "Falha ao carregar dados" : null;
  const activeStoreId = useAuthStore((s) => s.activeStoreId);

  return (
    <PageContainer>
      <Stack gap={{ xs: 2.5, md: 3.5 }}>
        <PageHeader title="Categorias" />
        {loading && <Typography>Carregando...</Typography>}
        {error && <Typography color="error.main">{error}</Typography>}
        <Stack direction="row" gap={2} flexWrap="wrap">
          <CategoriesForm key={activeStoreId} />
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
              </ContentCard>
            </Box>
          ))}
        </Stack>
        {!loading && !categories.length && (
          <Typography>Nenhuma categoria.</Typography>
        )}
      </Stack>
    </PageContainer>
  );
}
