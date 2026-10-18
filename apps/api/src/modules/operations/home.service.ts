import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import type { AuthIdentity } from "../../middlewares/auth";
import { overview as purchasesOverview } from "../unified-purchases/unified-purchases.service";
import { closurePendencies } from "../positions/positions.service";
import { overview as operationsOverview } from "./operations.service";
import { thursdayMorningWindow } from "../../lib/time-window";

type HomeItem = {
  codigo: string;
  titulo: string;
  quantidade: number;
  definicao: string;
};
type HomeSection = {
  codigo: string;
  titulo: string;
  rota: string;
  itens: HomeItem[];
};

// F-6/F-12 (BE-HOME): pendências calculadas no backend, só das áreas que o usuário pode ver, com
// instante de referência e definição de cada contador. Não é um segundo ledger.
export async function home(identity: AuthIdentity, lojaId: string) {
  const permissions = identity.permissoes.map((permission) => permission.code);
  const has = (...codes: string[]) =>
    permissions.includes("SYSTEM_ADMIN") ||
    codes.some((code) => permissions.includes(code));
  const referenciaEm = new Date();
  const secoes: HomeSection[] = [];

  if (has("COMPRAS_IMPORTADAS_VISUALIZAR")) {
    const purchases = await purchasesOverview(identity);
    secoes.push({
      codigo: "COMPRAS",
      titulo: "Compras (staging global)",
      rota: "/compras",
      itens: [
        {
          codigo: "CONFLITOS",
          titulo: "Conflitos abertos",
          quantidade: purchases.conflicts,
          definicao: "Conflitos de compra importada com status ABERTO."
        },
        {
          codigo: "SEM_MAPPING",
          titulo: "Itens sem mapping de produto",
          quantidade: purchases.mappingsPending,
          definicao: "Itens importados sem mapping ativo para produto interno."
        },
        {
          codigo: "SEM_LOJA",
          titulo: "Itens com saldo sem loja",
          quantidade: purchases.unassigned + purchases.partiallyAssigned,
          definicao:
            "Itens com quantidade elegível ainda não atribuída integralmente a Dronz ou Gooder."
        },
        {
          codigo: "AGUARDANDO_MATERIALIZACAO",
          titulo: "Atribuições aguardando materialização",
          quantidade: purchases.awaitingMaterialization,
          definicao:
            "Itens atribuídos cuja quantidade ainda não virou pedido operacional."
        }
      ]
    });
  }

  const ops = await operationsOverview(lojaId, permissions);
  const operacao: HomeItem[] = [];
  if (ops.totals.miamiPending !== undefined) {
    operacao.push({
      codigo: "MIAMI_PENDENTE",
      titulo: "Itens aguardando recebimento",
      quantidade: ops.totals.miamiPending,
      definicao:
        "Itens de pedidos confirmados com quantidade ainda não recebida na posição de destino."
    });
    operacao.push({
      codigo: "MIAMI_DIVERGENTE",
      titulo: "Recebimentos com divergência",
      quantidade: ops.totals.miamiDivergent ?? 0,
      definicao:
        "Recebimentos em posição registrados com divergência diferente de CORRETO."
    });
  }
  if (ops.totals.paraguayPending !== undefined)
    operacao.push({
      codigo: "PARAGUAI_PENDENTE",
      titulo: "Malas sem checkpoint Paraguai",
      quantidade: ops.totals.paraguayPending,
      definicao: "Malas de rota com Paraguai sem checkpoint vigente."
    });
  if (ops.totals.brazilPending !== undefined)
    operacao.push({
      codigo: "BRASIL_PENDENTE",
      titulo: "Malas chegadas sem checkpoint Brasil",
      quantidade: ops.totals.brazilPending,
      definicao: "Malas de viagens chegadas ao Brasil sem checkpoint vigente."
    });
  if (ops.totals.receivingPending !== undefined)
    operacao.push({
      codigo: "RECEBIMENTO_PENDENTE",
      titulo: "Malas aguardando conferência",
      quantidade: ops.totals.receivingPending,
      definicao: "Malas com checkpoint Brasil e sem recebimento aberto."
    });
  if (ops.totals.definitivePending !== undefined)
    operacao.push({
      codigo: "ENTRADA_PENDENTE",
      titulo: "Recebimentos com unidades aptas a incorporar",
      quantidade: ops.totals.definitivePending,
      definicao:
        "Recebimentos com quantidade apta ainda não incorporada ao estoque (X-07)."
    });
  if (operacao.length)
    secoes.push({
      codigo: "OPERACAO",
      titulo: "Recebimento e checkpoints",
      rota: "/operacao",
      itens: operacao
    });

  const [bagsPlanning, bagsClosed, reservations] = await Promise.all([
    prisma.mala.count({
      where: { lojaId, status: "PLANNING", alocacoes: { some: {} } }
    }),
    prisma.mala.count({ where: { lojaId, status: "CLOSED" } }),
    prisma.alocacaoMala.count({ where: { lojaId, status: "RESERVADA" } })
  ]);
  const logistica: HomeItem[] = [
    {
      codigo: "MALAS_EM_PREPARO",
      titulo: "Malas/caixas em preparação",
      quantidade: bagsPlanning,
      definicao: "Volumes em PLANNING com pelo menos uma reserva."
    },
    {
      codigo: "AGUARDANDO_ENTREGA",
      titulo: "Volumes fechados aguardando entrega",
      quantidade: bagsClosed,
      definicao:
        "Volumes CLOSED ainda sem handoff ao viajante ou transportadora."
    },
    {
      codigo: "RESERVAS_ABERTAS",
      titulo: "Unidades reservadas",
      quantidade: reservations,
      definicao: "Linhas de reserva em volumes ainda não fechados (F-8)."
    }
  ];
  // PD-08: envio planejado para quinta de manhã que não saiu até 12:00 no fuso da origem (só alerta).
  const thursdayTrips = await prisma.viagem.findMany({
    where: {
      lojaId,
      periodoEnvio: "MANHA",
      status: {
        in: ["PLANNED", "OPEN_FOR_ALLOCATION", "CLOSED_FOR_ALLOCATION"]
      },
      partidaEm: {
        gte: new Date(referenciaEm.getTime() - 14 * 86_400_000),
        lte: referenciaEm
      }
    },
    select: {
      partidaEm: true,
      malas: {
        take: 1,
        select: {
          posicao: { select: { local: { select: { timezone: true } } } }
        }
      }
    }
  });
  logistica.push({
    codigo: "ENVIO_QUINTA_ATRASADO",
    titulo: "Envios de quinta de manhã ainda não saíram",
    quantidade: thursdayTrips.filter((trip) => {
      const window = thursdayMorningWindow(
        trip.partidaEm,
        trip.malas[0]?.posicao.local.timezone ?? "America/New_York"
      );
      return window && referenciaEm > window.fim;
    }).length,
    definicao:
      "Viagens com envio na quinta de manhã (08:00–12:00 no fuso da posição de origem, PD-08) ainda não em trânsito após o fim da janela. Alerta, sem bloqueio."
  });
  if (has("LOGISTICA_POSICOES_GERENCIAR")) {
    const temporary = await prisma.posicaoOperacional.findMany({
      where: { tipo: "TEMPORARIA", status: "ATIVA" },
      select: { id: true }
    });
    const closable = (
      await Promise.all(
        temporary.map(
          async (position) =>
            (await closurePendencies(prisma, position.id)).length === 0
        )
      )
    ).filter(Boolean).length;
    logistica.push({
      codigo: "POSICOES_ENCERRAVEIS",
      titulo: "Posições temporárias prontas para encerrar",
      quantidade: closable,
      definicao:
        "Posições temporárias ativas sem itens a receber, malas abertas ou reservas (D-10)."
    });
  }
  secoes.push({
    codigo: "LOGISTICA",
    titulo: "Logística",
    rota: "/logistica",
    itens: logistica
  });

  if (has("CORRECAO_PATRIMONIAL_APROVAR"))
    secoes.push({
      codigo: "CORRECOES",
      titulo: "Correções patrimoniais",
      rota: "/",
      itens: [
        {
          codigo: "AGUARDANDO_APROVACAO",
          titulo: "Compensações aguardando aval",
          quantidade: await prisma.solicitacaoCorrecao.count({
            where: { lojaId, status: "PENDENTE" }
          }),
          definicao:
            "Solicitações de compensação de estoque propostas e ainda não decididas (D-17)."
        }
      ]
    });

  if (has("FINANCEIRO_VISUALIZAR")) {
    const orders = await prisma.pedidoCompra.findMany({
      where: { lojaId, status: { notIn: ["DRAFT", "CANCELLED"] } },
      select: {
        total: true,
        pagamentos: { select: { valor: true, status: true, estornoDeId: true } }
      }
    });
    // Mesma regra da obrigação (B16): reembolso não reabre a dívida; conta só aplicação bruta.
    const unpaid = orders.filter((order) => {
      const paid = order.pagamentos
        .filter(
          (payment) => !payment.estornoDeId && payment.status !== "CANCELLED"
        )
        .reduce(
          (sum, payment) => sum.plus(payment.valor),
          new Prisma.Decimal(0)
        );
      return paid.lessThan(order.total);
    }).length;
    secoes.push({
      codigo: "FINANCEIRO",
      titulo: "Financeiro",
      rota: "/financeiro",
      itens: [
        {
          codigo: "PEDIDOS_A_PAGAR",
          titulo: "Pedidos com pagamento pendente",
          quantidade: unpaid,
          definicao:
            "Pedidos não cancelados cujo total aplicado (sem descontar reembolsos) é menor que o total."
        }
      ]
    });
  }

  return { lojaId, referenciaEm, secoes };
}
