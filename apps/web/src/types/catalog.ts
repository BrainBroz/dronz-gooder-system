export type Category = {
  id: string;
  nome: string;
  slug: string;
  descricao?: string | null;
  ordem: number;
  ativo: boolean;
};
export type Product = {
  id: string;
  codigo: number;
  nome: string;
  slug: string;
  descricao?: string | null;
  precoVenda: string;
  markup: string;
  ativo: boolean;
  categoria: Category;
};
