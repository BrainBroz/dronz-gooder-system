import type { Mala, Viagem } from "@prisma/client";
import { AppError } from "../../lib/app-error";

export function assertParaguayTransition(trip: Viagem, bag: Mala) {
  if (!trip.checkpointsObrigatorios.includes("PARAGUAI"))
    throw new AppError(409, "checkpoint_not_applicable");
  if (trip.status !== "IN_TRANSIT" || bag.status !== "CHECKED_IN")
    throw new AppError(409, "invalid_transition");
}

export function assertBrazilTransition(trip: Viagem, bag: Mala, paraguayConfirmed: boolean) {
  if (trip.status !== "ARRIVED_BRAZIL" || !trip.chegadaRealEm)
    throw new AppError(409, "brazil_arrival_required");
  if (!(["ARRIVED_BRAZIL", "RECEIVED"] as const).includes(bag.status as "ARRIVED_BRAZIL" | "RECEIVED"))
    throw new AppError(409, "invalid_transition");
  if (trip.checkpointsObrigatorios.includes("PARAGUAI") && !paraguayConfirmed)
    throw new AppError(409, "checkpoint_required");
}
