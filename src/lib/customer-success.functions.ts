import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { csUpdateSchema } from "./customer-success";
import { csAnalyze, csDetail, csOverview, csUpdate } from "./customer-success.server";

export const getCsOverview = createServerFn({ method: "GET" }).handler(() => csOverview());
export const getCsDetail = createServerFn({ method: "GET" }).inputValidator(i => z.object({ clientId: z.string().uuid() }).strict().parse(i)).handler(({ data }) => csDetail(data.clientId));
export const updateCs = createServerFn({ method: "POST" }).inputValidator(i => csUpdateSchema.parse(i)).handler(({ data }) => csUpdate(data));
export const analyzeCs = createServerFn({ method: "POST" }).inputValidator(i => z.object({ clientId: z.string().uuid(), eventId: z.string().uuid() }).strict().parse(i)).handler(({ data }) => csAnalyze(data.clientId, data.eventId));