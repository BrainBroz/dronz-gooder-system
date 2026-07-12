import React from "react";
import { Box, Button, MenuItem, Stack, TextField, Typography } from "@mui/material";
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
import type { Product } from "../types/catalog";
import { useCategories, useProducts } from "../hooks/useCatalog";
import { formatSalePrice } from "../utils/formatting";

const productSchema = z.object({
  codigo: z.coerce.number().int().min(1, "Código obrigatório"),
  nome: z.string().min(1, "Nome obrigatório"),
  slug: z.string().min(1, "Slug obrigatório"),
  categoriaId: z.string().min(1, "Selecione uma categoria"),
  descricao: z.string().optional(),
  precoVenda: z.coerce.number().min(0, "Preço inválido"),
  markup: z.coerce.number().min(25, "Markup mínimo de 25%"),
  peso: z.coerce.number().min(0).optional()
});

const productDefaultValues = {
  codigo: 301,
  nome: "",
  slug: "",
  categoriaId: "",
  descricao: "",
  precoVenda: 0,
  markup: 25,
  peso: 0
};

function ProductsForm() {
  const { categories } = useCategories();
  const activeStoreId = useAuthStore((s) => s.activeStoreId);
  const client = useQueryClient();
  const [editing, setEditing] = React.useState<Product | null>(null);
  const form = useForm({
    resolver: zodResolver(productSchema),
    defaultValues: productDefaultValues
  });
  const invalidate = () =>
    client.invalidateQueries({
      queryKey: catalogQueryKeys.products(activeStoreId)
    });
  const [wasEditing, setWasEditing] = React.useState(false);
  const saveMutation = useMutation({
    mutationFn: async (values: z.infer<typeof productSchema>) => {
      setWasEditing(!!editing);
      if (editing) {
        const updatePayload = {
          nome: values.nome,
          slug: values.slug,
          categoriaId: values.categoriaId,
          descricao: values.descricao,
          precoVenda: values.precoVenda,
          markup: values.markup,
          peso: values.peso
        };
        return api.patch(`/products/${editing.id}`, updatePayload, {
          headers: { ...authHeader(), "x-store-id": activeStoreId }
        });
      }
      return api.post("/products", values, {
        headers: { ...authHeader(), "x-store-id": activeStoreId }
      });
    },
    onSuccess: async () => {
      await invalidate();
      setEditing(null);
      form.reset(productDefaultValues);
    }
  });
  const toggleMutation = useMutation({
    mutationFn: (product: Product) =>
      api.patch(
        `/products/${product.id}/status`,
        {},
        { headers: { ...authHeader(), "x-store-id": activeStoreId } }
      ),
    onSuccess: invalidate
  });
  const save = form.handleSubmit((values) => saveMutation.mutateAsync(values));
  const { errors } = form.formState;

  return (
    <>
      <Box sx={{ width: "100%", maxWidth: 360 }}>
        <ContentCard>
          <form onSubmit={save} noValidate>
            <Stack gap={2}>
              <Controller
                name="codigo"
                control={form.control}
                render={({ field }) => (
                  <TextField
                    {...field}
                    label="Código"
                    type="number"
                    disabled={!!editing}
                    helperText={
                      editing
                        ? "O código não pode ser alterado"
                        : errors.codigo?.message
                    }
                    error={!!errors.codigo}
                  />
                )}
              />
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
                name="categoriaId"
                control={form.control}
                render={({ field }) => (
                  <TextField
                    {...field}
                    select
                    label="Categoria"
                    error={!!errors.categoriaId}
                    helperText={errors.categoriaId?.message}
                  >
                    {categories.map((category) => (
                      <MenuItem key={category.id} value={category.id}>
                        {category.nome}
                      </MenuItem>
                    ))}
                  </TextField>
                )}
              />
              <Controller
                name="precoVenda"
                control={form.control}
                render={({ field }) => (
                  <TextField
                    {...field}
                    label="Preço de venda"
                    type="number"
                    error={!!errors.precoVenda}
                    helperText={errors.precoVenda?.message}
                  />
                )}
              />
              <Controller
                name="markup"
                control={form.control}
                render={({ field }) => (
                  <TextField
                    {...field}
                    label="Markup"
                    type="number"
                    error={!!errors.markup}
                    helperText={errors.markup?.message}
                  />
                )}
              />
              <Button
                type="submit"
                variant="contained"
                disabled={saveMutation.isPending}
              >
                {editing ? "Salvar" : "Criar"}
              </Button>
              {editing && (
                <Button
                  onClick={() => {
                    setEditing(null);
                    form.reset(productDefaultValues);
                  }}
                >
                  Cancelar edição
                </Button>
              )}
              <MutationStatus
                mutation={saveMutation}
                successMessage={
                  wasEditing
                    ? "Produto salvo com sucesso."
                    : "Produto criado com sucesso."
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
    </>
  );
}

export function ProductsPage() {
  const { categoriesError, categoriesLoading } = useCategories();
  const { products, productsError, productsLoading } = useProducts();
  const loading = categoriesLoading || productsLoading;
  const error =
    categoriesError || productsError ? "Falha ao carregar dados" : null;
  const activeStoreId = useAuthStore((s) => s.activeStoreId);

  return (
    <PageContainer>
      <Stack gap={{ xs: 2.5, md: 3.5 }}>
        <PageHeader title="Produtos" />
        {loading && <Typography>Carregando...</Typography>}
        {error && <Typography color="error.main">{error}</Typography>}
        <Stack direction="row" gap={2} flexWrap="wrap">
          <ProductsForm key={activeStoreId} />
          {products.map((product) => (
            <Box
              key={product.id}
              sx={{
                width: "100%",
                maxWidth: 320,
                opacity: product.ativo ? 1 : 0.6
              }}
            >
              <ContentCard>
                <Typography>{product.nome}</Typography>
                <Typography variant="body2" color="text.secondary">
                  Código {product.codigo}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {formatSalePrice(product.precoVenda)}
                </Typography>
              </ContentCard>
            </Box>
          ))}
        </Stack>
        {!loading && !products.length && (
          <Typography>Nenhum produto.</Typography>
        )}
      </Stack>
    </PageContainer>
  );
}
