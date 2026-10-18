// Quanto de um item ainda é esperado em cada posição (D-15/PD-04). Fonte única para disponibilidade,
// encerramento de posição e recebimento:
// - conteúdo declarado em pacote vai para o destino efetivo do pacote (do pacote, senão do pedido) e só é
//   baixado por recebimento que cite aquele pacote;
// - o restante (não declarado em pacote algum) segue o destino do pedido e é baixado por recebimento
//   sem pacote;
// - recebimento antigo sem pacote (anterior ao vínculo) abate o esperado da posição onde foi registrado,
//   e o pendente nunca passa do que falta receber do item: nenhum vínculo histórico é inventado.
export type ItemForExpectation = {
  id: string;
  quantidade: number;
  pedido: {
    destinoPosicaoId: string | null;
    compraImportada: {
      enviosExternos: {
        pacotes: {
          id: string;
          externalPackageId?: string;
          destinoPosicaoId: string | null;
          itens: { pedidoCompraItemId: string; quantidade: number }[];
        }[];
      }[];
    } | null;
  };
  recebimentosMiami: {
    pacoteExternoId: string | null;
    posicaoId: string;
    quantidadeRecebida: number;
    atribuicaoPacoteConhecida: boolean;
  }[];
};

export const expectationSelect = {
  id: true,
  quantidade: true,
  pedido: {
    select: {
      destinoPosicaoId: true,
      compraImportada: {
        select: {
          enviosExternos: {
            select: {
              pacotes: {
                select: {
                  id: true,
                  externalPackageId: true,
                  destinoPosicaoId: true,
                  itens: {
                    select: { pedidoCompraItemId: true, quantidade: true }
                  }
                }
              }
            }
          }
        }
      }
    }
  },
  recebimentosMiami: {
    select: {
      pacoteExternoId: true,
      posicaoId: true,
      quantidadeRecebida: true,
      atribuicaoPacoteConhecida: true
    }
  }
} as const;

export function packagedLines(item: ItemForExpectation) {
  return (item.pedido.compraImportada?.enviosExternos ?? []).flatMap((envio) =>
    envio.pacotes.flatMap((pkg) =>
      pkg.itens
        .filter((line) => line.pedidoCompraItemId === item.id)
        .map((line) => ({
          pacoteId: pkg.id,
          pacote: pkg.externalPackageId ?? pkg.id,
          destino: pkg.destinoPosicaoId ?? item.pedido.destinoPosicaoId,
          quantidade: line.quantidade
        }))
    )
  );
}

export function receivedByPackage(item: ItemForExpectation) {
  const map = new Map<string | null, number>();
  for (const receipt of item.recebimentosMiami)
    map.set(
      receipt.pacoteExternoId,
      (map.get(receipt.pacoteExternoId) ?? 0) + receipt.quantidadeRecebida
    );
  return map;
}

// Saldo recebível sem citar pacote: unidades não declaradas em pacote menos os recebimentos registrados
// explicitamente como "fora de pacote". Recebimento antigo (atribuição desconhecida) não consome esse
// saldo: só conta no limite total do item.
export function unpackagedRemaining(item: ItemForExpectation) {
  const packaged = packagedLines(item).reduce(
    (sum, line) => sum + line.quantidade,
    0
  );
  const explicitUnpackaged = item.recebimentosMiami
    .filter((r) => r.pacoteExternoId === null && r.atribuicaoPacoteConhecida)
    .reduce((sum, r) => sum + r.quantidadeRecebida, 0);
  return Math.min(
    itemRemaining(item),
    Math.max(0, item.quantidade - packaged - explicitUnpackaged)
  );
}

// O que ainda falta receber do item, em qualquer lugar.
export function itemRemaining(item: ItemForExpectation) {
  return Math.max(
    0,
    item.quantidade -
      item.recebimentosMiami.reduce((sum, r) => sum + r.quantidadeRecebida, 0)
  );
}

export function pendingAt(item: ItemForExpectation, posicaoId: string) {
  const received = receivedByPackage(item);
  const lines = packagedLines(item);
  let expected = 0;
  for (const line of lines)
    if (line.destino === posicaoId)
      expected += Math.max(
        0,
        line.quantidade - (received.get(line.pacoteId) ?? 0)
      );
  if (item.pedido.destinoPosicaoId === posicaoId)
    expected += Math.max(
      0,
      item.quantidade - lines.reduce((sum, line) => sum + line.quantidade, 0)
    );
  const legacyHere = item.recebimentosMiami
    .filter((r) => r.pacoteExternoId === null && r.posicaoId === posicaoId)
    .reduce((sum, r) => sum + r.quantidadeRecebida, 0);
  return Math.min(itemRemaining(item), Math.max(0, expected - legacyHere));
}

// Pacote destinado explicitamente à posição sem nenhum conteúdo declarado, com item ainda em aberto:
// não se sabe o que ele traz, então a posição não pode ser dada como sem pendência.
export function undeclaredRedirect(
  item: ItemForExpectation,
  posicaoId: string
) {
  const received = item.recebimentosMiami.reduce(
    (sum, r) => sum + r.quantidadeRecebida,
    0
  );
  if (received >= item.quantidade) return false;
  return (item.pedido.compraImportada?.enviosExternos ?? []).some((envio) =>
    envio.pacotes.some(
      (pkg) => pkg.destinoPosicaoId === posicaoId && pkg.itens.length === 0
    )
  );
}

// Resumo para a tela de recebimento: cada pacote com conteúdo declarado e o saldo fora de pacote.
export function receivableSummary(item: ItemForExpectation) {
  const received = receivedByPackage(item);
  return {
    pacotes: packagedLines(item).map((line) => ({
      pacoteId: line.pacoteId,
      pacote: line.pacote,
      destinoPosicaoId: line.destino,
      quantidade: line.quantidade,
      saldo: Math.min(
        itemRemaining(item),
        Math.max(0, line.quantidade - (received.get(line.pacoteId) ?? 0))
      )
    })),
    saldoSemPacote: unpackagedRemaining(item)
  };
}
